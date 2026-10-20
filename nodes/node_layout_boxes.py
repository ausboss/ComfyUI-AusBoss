"""Layout Boxes 🆎 - draw boxes on a canvas and say what goes in each one.

For layout prompts: each box is a thing, or words to write in the picture,
at the place you drew it. Wire `elements` to MOSS-Image Layout Prompt.

It gives what ComfyUI's own Create Bounding Boxes gives, in the same order
and worked out the same way (preview, bboxes, elements), so it can stand in
for that node. A fourth output, `mask`, is white inside every box, to change
only those places of a picture. A box can be turned, for words at a slant:
the mask is the turned box itself. Its canvas is a panel of the pack's own
(js/layout_boxes/index.js), so it draws in the classic look as well as in
Nodes 2.0. The panel drives ordinary hidden widgets, so saving, loading,
undo and the API format all go the usual way. The work is in
_layout_boxes_helpers.py.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch

from ._layout_boxes_helpers import (
    DEFAULT_SIZE,
    DIM_MAX,
    DIM_MIN,
    DIM_STEP,
    EMPTY_LAYOUT,
    bounding_boxes,
    boxes_from_input,
    canvas_boxes,
    input_fingerprint,
    mask_rects,
    parse_layout,
    prompt_elements,
    regions_from_pixel_boxes,
    render_preview,
    turned_mask_rows,
)
from ._preview_helpers import first_frame_to_pil, temp_prefix

try:
    import folder_paths
except ImportError:  # Offline tests import this module without ComfyUI.
    folder_paths = None

# What a run tells the node's face: the canvas size, the boxes that came in
# on the wire, and the background picture to draw them on.
UI_KEY = "ausboss_layout_boxes"
# The face only needs the background at about the size it is shown.
BACKGROUND_LONG_EDGE = 1536


def _picture_tensor(picture) -> torch.Tensor:
    array = np.asarray(picture, dtype=np.float32) / 255.0
    return torch.from_numpy(array).unsqueeze(0)


def _first_picture(background):
    if background is None:
        return None
    try:
        return first_frame_to_pil(background, "Layout Boxes")
    except ValueError:
        return None


def _boxes_mask(regions, width: int, height: int, picture=None) -> torch.Tensor:
    """The `mask` output: 1 inside every box, 0 elsewhere, shape 1 x H x W.

    With a background picture it has the picture's size: the boxes sit on the
    picture as they sit on the canvas, so the mask fits the picture they were
    drawn on. Without one it has the canvas size. A turned box is white
    inside its turned rectangle."""
    if picture is not None:
        width, height = picture.width, picture.height
    mask = torch.zeros((1, height, width), dtype=torch.float32)
    for left, top, right, bottom in mask_rects(regions, width, height):
        mask[0, top:bottom, left:right] = 1.0
    for row, first, end in turned_mask_rows(regions, width, height):
        mask[0, row, first:end] = 1.0
    return mask


def _save_background(picture, prefix: str) -> dict | None:
    """The background, shrunk to what the face shows, into ComfyUI's temp
    folder. A failure only leaves the face without its picture."""
    if folder_paths is None:
        return None
    try:
        shown = picture.convert("RGB")
        scale = min(1.0, BACKGROUND_LONG_EDGE / max(shown.width, shown.height, 1))
        if scale < 1.0:
            shown = shown.resize((max(1, round(shown.width * scale)), max(1, round(shown.height * scale))))
        folder, filename, counter, subfolder, _prefix = folder_paths.get_save_image_path(
            prefix, folder_paths.get_temp_directory(), shown.width, shown.height
        )
        name = f"{filename}_{counter:05}_.jpg"
        shown.save(Path(folder) / name, quality=90)
        return {"filename": name, "subfolder": subfolder, "type": "temp"}
    except Exception as exc:  # noqa: BLE001 - the picture on the face is a convenience
        detail = str(exc).encode("ascii", "replace").decode("ascii")
        print(f"[AusBoss] Layout Boxes: background not shown on the node ({detail}).")
        return None


class AusBossLayoutBoxes:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "Draw boxes on a canvas and say what goes in each one: a thing, or words "
        "to write in the picture. Wire elements to MOSS-Image Layout Prompt. "
        "Drag on the canvas to draw a box; drag a box to move it, its corners to "
        "size it, and the round handle above it to turn it. Works in the classic "
        "look and in Nodes 2.0, and gives what "
        "ComfyUI's own Create Bounding Boxes gives, so it can take that node's "
        "place. A picture on background shows under the boxes and sets the "
        "canvas size. The mask output is white inside every box: use it to "
        "change only those places of a picture, such as the words on a sign."
    )
    SEARCH_ALIASES = [
        "bounding boxes", "create bounding boxes", "bbox", "boxes", "layout",
        "regions", "ideogram", "moss", "moss-image", "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "background": ("IMAGE", {
                    "tooltip": (
                        "A picture to draw the boxes on (optional). It shows under the "
                        "boxes, and its size becomes the canvas size."
                    ),
                }),
                "bboxes": ("BOUNDING_BOX,ARRAY,STRING", {
                    "tooltip": (
                        "Boxes to start from (optional): bounding boxes, prompt elements, "
                        "or either as JSON text. When the wire brings new boxes they fill "
                        "the canvas; changes you make on the canvas then stay until the "
                        "boxes on the wire change."
                    ),
                }),
                "width": ("INT", {
                    "default": DEFAULT_SIZE, "min": DIM_MIN, "max": DIM_MAX, "step": DIM_STEP,
                    "tooltip": "Canvas width in pixels: the width of the picture you make. Wire it from Latent Size to keep the two the same.",
                }),
                "height": ("INT", {
                    "default": DEFAULT_SIZE, "min": DIM_MIN, "max": DIM_MAX, "step": DIM_STEP,
                    "tooltip": "Canvas height in pixels: the height of the picture you make. Wire it from Latent Size to keep the two the same.",
                }),
                "layout": ("STRING", {
                    "default": EMPTY_LAYOUT, "multiline": False,
                    "tooltip": (
                        "The boxes, drawn on the node and saved here as text: where each box "
                        "is (as parts of the canvas), how far it is turned, its type, its "
                        "words and its colors."
                    ),
                }),
            },
        }

    RETURN_TYPES = ("IMAGE", "BOUNDING_BOX", "ARRAY", "MASK")
    RETURN_NAMES = ("preview", "bboxes", "elements", "mask")
    OUTPUT_TOOLTIPS = (
        "A picture of the boxes with their numbers and words, to check the layout. "
        "Wire it to Preview Image.",
        "The boxes in pixels of the canvas (x, y, width, height), for nodes that take bounding boxes. "
        "A turned box gives the straight box around it.",
        "The boxes as prompt elements: type, place, words and colors. Wire it to "
        "MOSS-Image Layout Prompt. A turned text box says its slant in its description.",
        "The boxes as a mask: white inside every box, turned boxes as they are turned. "
        "Use it to change only those places of a picture, such as the words on a sign.",
    )
    OUTPUT_NODE = True
    FUNCTION = "draw"

    def draw(self, background=None, bboxes=None, width=DEFAULT_SIZE, height=DEFAULT_SIZE, layout=EMPTY_LAYOUT):
        width, height = int(width), int(height)
        incoming = boxes_from_input(bboxes, width, height)
        drawn, applied = parse_layout(layout, width, height)
        fingerprint = input_fingerprint(bboxes) if incoming else ""
        # New boxes on the wire fill the canvas; after that the canvas (and
        # any change made there) is used until the wire brings other boxes.
        from_wire = regions_from_pixel_boxes(incoming, width, height) if incoming else []
        regions = from_wire if incoming and fingerprint != applied else drawn
        picture = _first_picture(background)
        # The canvas the boxes were drawn and turned on: the picture when there
        # is one (the face shows it at its own shape), else width x height.
        shape = (picture.width, picture.height) if picture is not None else (width, height)
        note = {"size": [width, height], "count": len(regions)}
        if incoming:
            note["incoming"] = {"fingerprint": fingerprint, "boxes": canvas_boxes(from_wire)}
        if picture is not None:
            note["picture"] = [picture.width, picture.height]
            saved = _save_background(picture, temp_prefix("layout_boxes"))
            if saved:
                note["background"] = saved
        preview = _picture_tensor(render_preview(regions, width, height, picture, shape))
        return {
            "ui": {UI_KEY: [note]},
            "result": (
                preview,
                bounding_boxes(regions, width, height, shape),
                prompt_elements(regions, shape),
                _boxes_mask(regions, width, height, picture),
            ),
        }


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_LayoutBoxes": AusBossLayoutBoxes}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_LayoutBoxes": "Layout Boxes 🆎"}
