"""Pad Image 🆎."""

from __future__ import annotations

import random
import string
from pathlib import Path

from PIL import Image

from ._inpaint_crop_helpers import build_canvas_stitcher
from ._pad_helpers import PAD_MODES, pad_image

try:
    import folder_paths
except ImportError:  # Offline tests import this module without ComfyUI.
    folder_paths = None

# The on-node handle canvas draws the INPUT image under its padding handles,
# and an IMAGE wire has no file to preview — so pad() stashes a small temp
# PNG of the first input frame and announces it through the ui payload.
# Namespaced keys, not "images": the core frontend renders that key as its
# own preview widget under the node, which would double up with the panel.
_PREVIEW_MAX_EDGE = 1024


class AusBossPadImage:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Pads an image outward on any side with a solid color, an "
        "edge-color band, replicated edge pixels, or a blurred pillarbox "
        "backdrop. Also returns a mask covering exactly the new padding — "
        "a ready-made outpaint mask. The original pixels are never touched."
    )
    SEARCH_ALIASES = [
        "pad image",
        "outpaint pad",
        "letterbox",
        "pillarbox",
        "extend canvas",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": (
                    "IMAGE",
                    {"tooltip": "BHWC image or frames to pad outward."},
                ),
                "pad_left": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "Pixels added to the left edge.",
                    },
                ),
                "pad_top": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "Pixels added to the top edge.",
                    },
                ),
                "pad_right": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "Pixels added to the right edge.",
                    },
                ),
                "pad_bottom": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "Pixels added to the bottom edge.",
                    },
                ),
                "mode": (
                    list(PAD_MODES),
                    {
                        "default": "color",
                        "tooltip": (
                            "color = solid fill_color; edge = each side takes "
                            "the average color of the nearest image edge; "
                            "edge pixel = the outermost rows and columns "
                            "smear outward; pillarbox blur = the image itself, "
                            "stretched to cover the canvas, blurred and dimmed "
                            "behind the sharp original."
                        ),
                    },
                ),
                "fill_color": (
                    "STRING",
                    {
                        "default": "#808080",
                        "tooltip": (
                            "Padding color for the color mode; accepts "
                            "#RGB/#RRGGBB hex, R, G, B (0-255 or 0..1 floats), "
                            "one grayscale number, or a CSS color name. Other "
                            "modes ignore it."
                        ),
                    },
                ),
                "backdrop_blur": (
                    "FLOAT",
                    {
                        "default": 0.5,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "tooltip": (
                            "Pillarbox blur only: one knob for how strongly the "
                            "backdrop is blurred and dimmed. The blur scales "
                            "with the canvas size, so the look is resolution "
                            "independent; 0 keeps the backdrop sharp and full "
                            "brightness."
                        ),
                    },
                ),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "AUSBOSS_STITCHER")
    RETURN_NAMES = ("image", "mask", "stitcher")
    OUTPUT_TOOLTIPS = (
        "The padded image; the original region is bit-identical to the input.",
        "White over the new padding, black over the original — feed it "
        "straight to an inpainter as the outpaint mask.",
        "Hand to Stitch Inpaint 🆎 with the sampled result to keep only the "
        "new padding and restore the original pixels bit-identically.",
    )
    FUNCTION = "pad"

    def __init__(self):
        # A distinct temp prefix per node instance, so two Pad Image nodes in
        # one workflow never overwrite each other's previews.
        self._prefix = "ausboss_pad_" + "".join(random.choices(string.ascii_lowercase, k=5))

    def pad(
        self,
        image,
        pad_left,
        pad_top,
        pad_right,
        pad_bottom,
        mode,
        fill_color,
        backdrop_blur,
    ):
        padded, mask = pad_image(
            image,
            int(pad_left),
            int(pad_top),
            int(pad_right),
            int(pad_bottom),
            str(mode),
            fill_color,
            float(backdrop_blur),
        )
        # The padded canvas is the stitch base, so whatever the sampler does
        # outside the padded band is discarded and the source survives.
        result = (padded, mask, build_canvas_stitcher(padded, mask))
        preview = self._save_temp_preview(image)
        if preview is None:
            return result
        return {
            "ui": {
                "ausboss_pad_preview": [preview],
                "ausboss_pad_source": [[int(image.shape[2]), int(image.shape[1])]],
            },
            "result": result,
        }

    def _save_temp_preview(self, image):
        """Best-effort input-frame preview for the handle canvas; never raises
        (headless runs and tests have no folder_paths)."""
        if folder_paths is None:
            return None
        try:
            frame = image[0].detach().cpu().clamp(0.0, 1.0).mul(255.0).round().byte().numpy()
            if frame.shape[-1] == 1:
                frame = frame[..., 0]
            preview = Image.fromarray(frame)
            preview.thumbnail((_PREVIEW_MAX_EDGE, _PREVIEW_MAX_EDGE), Image.Resampling.LANCZOS)
            full_output_folder, filename, counter, subfolder, _prefix = (
                folder_paths.get_save_image_path(
                    self._prefix,
                    folder_paths.get_temp_directory(),
                    preview.width,
                    preview.height,
                )
            )
            file = f"{filename}_{counter:05}_.png"
            preview.save(Path(full_output_folder) / file, compress_level=4)
            return {"filename": file, "subfolder": subfolder, "type": "temp"}
        except Exception:
            return None


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_PadImage": AusBossPadImage}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_PadImage": "Pad Image 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
