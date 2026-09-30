"""Load Image + Pad 🆎."""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import torch

from ._inpaint_crop_helpers import build_canvas_stitcher
from ._krea2_helpers import build_reference_image
from ._media_helpers import (
    encode_preview,
    list_input_images,
    load_image_frames,
    resolve_input_path,
)
from ._pad_helpers import (
    PAD_MODES,
    feather_pad_mask,
    pad_image,
    plan_pad_canvas,
    resize_source,
    trim_source,
)
from ._preview_helpers import first_frame_to_pil
from ._transform_engine import stable_file_fingerprint

try:
    import folder_paths
except ImportError:  # Offline tests import this module without ComfyUI.
    folder_paths = None

# Temp subfolder for the wired source's stage preview. One file per node,
# overwritten on every run, so a queue of thousands of images leaves one
# small JPEG behind rather than thousands.
STAGE_PREVIEW_SUBFOLDER = "ausboss_load_image_pad"


def _frames_to_tensor(frames) -> torch.Tensor:
    """RGBA PIL frames (from load_image_frames) to a BHWC RGB float batch."""
    stacked = []
    for frame in frames:
        array = np.asarray(frame.convert("RGB"), dtype=np.float32) / 255.0
        stacked.append(torch.from_numpy(array.copy()))
    return torch.stack(stacked, dim=0)


def _wired_frames(image) -> torch.Tensor:
    """A wired IMAGE batch as the BHWC RGB float batch the file path yields.

    Alpha is dropped the same way a loaded file's is, and a one-channel
    batch is spread to RGB so padding and the reference see three channels.
    """
    if not isinstance(image, torch.Tensor) or image.ndim != 4 or int(image.shape[0]) < 1:
        raise ValueError("Load Image + Pad: source_image must be a BHWC IMAGE batch.")
    frames = image.detach().to("cpu", torch.float32)
    channels = int(frames.shape[-1])
    if channels == 1:
        frames = frames.expand(-1, -1, -1, 3)
    elif channels >= 3:
        frames = frames[..., :3]
    else:
        raise ValueError(f"Load Image + Pad: source_image has {channels} channels.")
    return frames.contiguous()


def _wired_mask(mask, frames: torch.Tensor) -> torch.Tensor:
    """A wired MASK as a BHW batch at the source's size and batch.

    A mask drawn at another size is stretched onto the source, and one mask
    serves a whole batch of images.
    """
    if not isinstance(mask, torch.Tensor) or mask.ndim not in (2, 3):
        raise ValueError("Load Image + Pad: source_mask must be a MASK.")
    mask = mask.detach().to("cpu", torch.float32)
    if mask.ndim == 2:
        mask = mask.unsqueeze(0)
    batch, height, width = int(frames.shape[0]), int(frames.shape[1]), int(frames.shape[2])
    if mask.shape[0] not in (1, batch):
        raise ValueError(
            f"Load Image + Pad: source_mask has {mask.shape[0]} masks for {batch} images; "
            "wire one mask, or one per image."
        )
    mask = resize_source(mask.unsqueeze(-1), width, height)[..., 0]
    return mask.clamp(0.0, 1.0).expand(batch, -1, -1).contiguous()


def _kept_bbox(mask: torch.Tensor, fallback: tuple[int, int, int, int]):
    """The rectangle around every pixel the wired mask keeps, on the canvas.

    ``mask`` is the wired mask at the source's size and ``fallback`` the
    source rectangle it sits in. A feathered edge still shows the picture,
    so it counts as kept. The cut sits at 0.95 rather than just under 1
    because a mask rarely arrives pure white: core's Load Image (as Mask)
    reads white as 254/255, and a JPEG or resized mask carries a few levels
    of noise that must not stretch the box over the whole canvas. A mask
    that keeps nothing falls back to the source rectangle.
    """
    kept = (mask < 0.95).any(dim=0)
    rows = torch.nonzero(kept.any(dim=1)).flatten()
    cols = torch.nonzero(kept.any(dim=0)).flatten()
    if rows.numel() == 0 or cols.numel() == 0:
        return fallback
    x0, y0 = fallback[0], fallback[1]
    return (
        x0 + int(cols[0]),
        y0 + int(rows[0]),
        x0 + int(cols[-1]) + 1,
        y0 + int(rows[-1]) + 1,
    )


def _with_stage_preview(frames: torch.Tensor, unique_id, result: tuple):
    """Attach a small preview of the wired source for the on-node canvas.

    The canvas cannot fetch a wired picture the way it fetches a file, so the
    run hands it the first frame and the true source size. A preview is a
    convenience, never the job: if writing it fails the outputs still return.
    """
    if folder_paths is None:
        return result
    width, height = int(frames.shape[2]), int(frames.shape[1])
    # unique_id comes from the prompt, so only filename-safe characters
    # reach the path (subgraph ids look like "12:5").
    name = re.sub(r"[^A-Za-z0-9_-]", "_", str(unique_id or "node"))[:64] + ".jpg"
    try:
        folder = Path(folder_paths.get_temp_directory()) / STAGE_PREVIEW_SUBFOLDER
        folder.mkdir(parents=True, exist_ok=True)
        pil = first_frame_to_pil(frames, "Load Image + Pad")
        (folder / name).write_bytes(encode_preview(pil, 512, 512))
    except Exception as exc:  # noqa: BLE001 - any failure here is non-fatal
        detail = str(exc).encode("ascii", "replace").decode("ascii")
        print(f"[AusBoss] Load Image + Pad: stage preview unavailable ({detail}).")
        return result
    return {
        "ui": {
            "ausboss_pad_preview": [
                {"filename": name, "subfolder": STAGE_PREVIEW_SUBFOLDER, "type": "temp"}
            ],
            "ausboss_pad_source": [[width, height]],
        },
        "result": result,
    }


# Default for source_image in VALIDATE_INPUTS. ComfyUI hands a linked input
# to validation as None (its value only exists at execution), while an
# optional input nobody wired is left out and keeps this default.
_UNWIRED = object()


class AusBossLoadImagePad:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Loads an image and pads it into an outpaint canvas in one node. "
        "Drag any edge of the canvas drawn on the node to set the per-side "
        "padding visually; the mask covers exactly the new padding, "
        "optionally feathered inward across the seam. The canvas rounds to "
        "a clean multiple without adding a strip to an edge you did not "
        "pad, and a megapixel target rescales the source first so the mask "
        "seam stays crisp."
    )
    SEARCH_ALIASES = [
        "load image",
        "outpaint canvas",
        "pad",
        "outpaint pad",
        "extend canvas",
        "megapixel",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": (
                    list_input_images(),
                    {
                        "image_upload": True,
                        "tooltip": "Choose or upload an image from ComfyUI's input folder.",
                    },
                ),
                "pad_left": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "Pixels added to the left edge (drag the canvas edge on the node).",
                    },
                ),
                "pad_top": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "Pixels added to the top edge (drag the canvas edge on the node).",
                    },
                ),
                "pad_right": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "Pixels added to the right edge (drag the canvas edge on the node).",
                    },
                ),
                "pad_bottom": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "Pixels added to the bottom edge (drag the canvas edge on the node).",
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
                            "behind the sharp original; mirror = the picture "
                            "flipped outward at every edge, so the padding "
                            "looks like more of the scene (the best margin "
                            "before an edit you realign with Realign to "
                            "Source)."
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
                            "backdrop is blurred and dimmed; 0 keeps it sharp "
                            "and full brightness."
                        ),
                    },
                ),
                "feather": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 2048,
                        "step": 1,
                        "tooltip": (
                            "Ramps the mask inward across the image edge on "
                            "each padded side so the sampler blends the seam; "
                            "0 keeps the seam hard."
                        ),
                    },
                ),
                "canvas_multiple": (
                    "INT",
                    {
                        "default": 8,
                        "min": 1,
                        "max": 4096,
                        "step": 1,
                        "tooltip": (
                            "Rounds the final canvas to this multiple. The "
                            "extra pixels join a side you padded; if you padded "
                            "neither left nor right (or neither top nor bottom), "
                            "none are added there: the source is scaled to fit "
                            "when a megapixel target is set, otherwise trimmed "
                            "by those few pixels, evenly from both edges."
                        ),
                    },
                ),
                "target_megapixels": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 64.0,
                        "step": 0.01,
                        "tooltip": (
                            "0 = off. Rescales the SOURCE so the padded canvas "
                            "lands on this many megapixels (then re-rounds to "
                            "canvas_multiple) — resizing before padding keeps "
                            "the mask seam crisp."
                        ),
                    },
                ),
            },
            # Appended as optional, so saved workflows and API prompts load
            # unchanged; the socket has no widget, so widget positions hold.
            "optional": {
                "source_image": (
                    "IMAGE",
                    {
                        "tooltip": (
                            "Optional. Wire an image here to pad it instead of "
                            "the file chosen above; the wire wins. The canvas "
                            "on the node shows the last image it padded, and "
                            "the same padding applies to every image that "
                            "arrives."
                        ),
                    },
                ),
                "source_mask": (
                    "MASK",
                    {
                        "tooltip": (
                            "Optional. For a picture that already has room for "
                            "the new part, like a canvas made in Photoshop: "
                            "white is the area to fill in. The stitcher then "
                            "knows where the rest of the picture sits."
                        ),
                    },
                ),
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    # `reference` is appended, never inserted: a workflow stores links by
    # output slot index, so putting it anywhere else would silently rewire
    # every saved graph that already reads width/height/stitcher.
    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "AUSBOSS_STITCHER", "IMAGE")
    RETURN_NAMES = ("image", "mask", "width", "height", "stitcher", "reference")
    OUTPUT_TOOLTIPS = (
        "The padded image; the original pixels are untouched (resized only "
        "when a megapixel target is set; without one, Multiple may trim a "
        "few pixels off a pair of edges you did not pad).",
        "White over the new padding, feathered inward per the feather widget "
        "— feed it straight to an inpainter as the outpaint mask.",
        "Final canvas width after multiple/megapixel rounding.",
        "Final canvas height after multiple/megapixel rounding.",
        "Hand to Stitch Inpaint 🆎 with the sampled result to keep only the "
        "new padding and restore the original pixels bit-identically. Also "
        "carries where the source sits on the canvas, which Krea 2 Outpaint "
        "Model Patch 🆎 reads to place the reference and Realign to Source 🆎 "
        "reads to cut your picture back out of an edit made on this canvas.",
        "The source alone (with a source_mask, the part the mask keeps), no "
        "padding, fitted to a small multiple of 16 — "
        "the reference image for Krea 2 Encode 🆎 and other reference "
        "conditioning. It is a quick resize, made on every run whether "
        "wired or not.",
    )
    FUNCTION = "load_pad"

    def load_pad(
        self,
        image,
        pad_left,
        pad_top,
        pad_right,
        pad_bottom,
        mode,
        fill_color,
        backdrop_blur,
        feather,
        canvas_multiple,
        target_megapixels,
        source_image=None,
        unique_id=None,
        source_mask=None,
    ):
        if source_image is not None:
            frames = _wired_frames(source_image)
        else:
            frames = _frames_to_tensor(load_image_frames(resolve_input_path(image)))
        source = frames
        wired_mask = None if source_mask is None else _wired_mask(source_mask, frames)
        plan = plan_pad_canvas(
            frames.shape[2],
            frames.shape[1],
            int(pad_left),
            int(pad_top),
            int(pad_right),
            int(pad_bottom),
            int(canvas_multiple),
            float(target_megapixels),
        )
        frames = resize_source(frames, plan["source_width"], plan["source_height"])
        frames = trim_source(
            frames, plan["trim_left"], plan["trim_top"], plan["trim_right"], plan["trim_bottom"]
        )
        if wired_mask is not None:
            # The mask follows the picture through the same resize and trim.
            wired_mask = resize_source(
                wired_mask.unsqueeze(-1), plan["source_width"], plan["source_height"]
            )
            wired_mask = trim_source(
                wired_mask, plan["trim_left"], plan["trim_top"], plan["trim_right"], plan["trim_bottom"]
            )[..., 0]
        output, mask = pad_image(
            frames,
            plan["left"],
            plan["top"],
            plan["right"],
            plan["bottom"],
            str(mode),
            fill_color,
            float(backdrop_blur),
        )
        mask = feather_pad_mask(
            mask, plan["left"], plan["top"], plan["right"], plan["bottom"], int(feather)
        )
        # Padding knows exactly where the source landed, so the bbox rides on
        # the stitcher rather than on a wire that can be left unplugged.
        bbox = (
            plan["left"],
            plan["top"],
            plan["left"] + frames.shape[2],
            plan["top"] + frames.shape[1],
        )
        reference_source = frames
        if wired_mask is not None:
            # A wired mask marks more area to fill inside the picture, so the
            # part left to keep, and the bbox around it, can be smaller than
            # the source rectangle.
            x0, y0, x1, y1 = bbox
            mask = mask.clone()
            mask[:, y0:y1, x0:x1] = torch.maximum(mask[:, y0:y1, x0:x1], wired_mask)
            bbox = _kept_bbox(wired_mask, bbox)
            x0, y0, x1, y1 = bbox
            reference_source = output[:, y0:y1, x0:x1, :]
        # The padded canvas is the stitch base, so whatever the sampler does
        # outside the feathered band is discarded and the source survives.
        stitcher = build_canvas_stitcher(output, mask, bbox=bbox, source="Load Image + Pad")
        reference = build_reference_image(reference_source)
        result = (
            output,
            mask,
            int(plan["width"]),
            int(plan["height"]),
            stitcher,
            reference,
        )
        if source_image is None:
            return result
        return _with_stage_preview(source, unique_id, result)

    @classmethod
    def VALIDATE_INPUTS(cls, image, source_image=_UNWIRED):
        # A wired source replaces the file, so the file choice may be
        # missing or stale without stopping the run.
        if source_image is None:
            return True
        try:
            resolve_input_path(image)
        except Exception as exc:
            return f"Load Image + Pad: {exc}"
        return True

    @classmethod
    def IS_CHANGED(cls, image, **values):
        try:
            path = resolve_input_path(image)
        except Exception:
            path = image or ""
        return stable_file_fingerprint(path, {"image": image, **values})


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_LoadImagePad": AusBossLoadImagePad}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_LoadImagePad": "Load Image + Pad 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
