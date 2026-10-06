"""Mask by Name 🆎 — type what to find in a picture and get its mask."""

from __future__ import annotations

import sys

import torch

from ._mask_by_name_helpers import (
    IF_NOTHING,
    NEEDS_SAM3,
    NOT_SAM3,
    NO_NAME,
    SEVERAL,
    clean_name,
    cut_out,
    nothing_message,
    pick,
    split_by_frame,
    tint_preview,
)
from ._mask_helpers import refine_mask
from ._preview_helpers import preview_payload, temp_prefix

# What the frontend reads to show "1 found" on the node.
UI_KEY = "ausboss_mask_by_name"
# ComfyUI's own default for SAM 3 Detect: two passes over each match's edge.
REFINE_PASSES = 2


def _core_nodes() -> dict:
    """ComfyUI's own node classes, by key. Empty outside ComfyUI."""
    mappings = getattr(sys.modules.get("nodes"), "NODE_CLASS_MAPPINGS", None)
    return mappings if isinstance(mappings, dict) else {}


def _stopped_by_user(error: BaseException) -> bool:
    return type(error).__name__ == "InterruptProcessingException"


def _out_of_memory(error: BaseException) -> bool:
    return "OutOfMemory" in type(error).__name__ or "out of memory" in str(error).lower()


class AusBossMaskByName:
    CATEGORY = "🆎 AusBoss/Mask"
    DESCRIPTION = (
        'Type what to find in a picture, like "the dog" or "the jacket", and '
        "get its mask. Nothing to paint. The node shows what it found, tinted "
        "on the picture. When it finds nothing it stops the run with a plain "
        "message, so nothing after it runs on an empty mask (or it can pass "
        "an empty mask on: a setting). Find runs only this node, to check "
        "the mask first. It uses ComfyUI's own SAM 3: wire model and clip "
        "from a Load Checkpoint that loads the SAM 3 file. It also returns "
        "the thing cut out on a see-through background."
    )
    SEARCH_ALIASES = [
        "sam", "sam3", "segment", "segment anything", "detect", "find",
        "text to mask", "prompt mask", "object mask", "select by name",
        "remove background", "cut out", "auto mask", "ausboss",
    ]
    # An output node, so Find can run it on its own.
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "The picture to search."}),
                "model": (
                    "MODEL",
                    {"tooltip": "SAM 3: MODEL from a Load Checkpoint that loads the SAM 3 file."},
                ),
                "clip": (
                    "CLIP",
                    {"tooltip": "SAM 3's text reader: CLIP from the same Load Checkpoint."},
                ),
                "name": (
                    "STRING",
                    {
                        "default": "the person",
                        "multiline": False,
                        "tooltip": 'What to find. A few plain words: "the dog", "the red jacket", "the woman on the left".',
                    },
                ),
                "several": (
                    list(SEVERAL),
                    {
                        "default": SEVERAL[0],
                        "tooltip": "When more than one thing matches: mask all of them, or only the biggest.",
                    },
                ),
                "grow": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 512,
                        "step": 1,
                        "tooltip": "Pixels to grow the mask past the thing's edge. 0 keeps the exact outline.",
                    },
                ),
                "soften": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 100.0,
                        "step": 0.5,
                        "tooltip": "Soften the mask's edge by this many pixels. 0 keeps a hard edge.",
                    },
                ),
                "if_nothing": (
                    list(IF_NOTHING),
                    {
                        "default": IF_NOTHING[0],
                        "tooltip": (
                            "When nothing matches the name. Stop the run: the workflow stops here "
                            "with a message, and nothing after this node runs. Empty mask: the run "
                            "goes on with a mask of nothing."
                        ),
                    },
                ),
            },
            "optional": {
                "preview": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            "Show what was found on this node. Off skips "
                            "writing the preview file to ComfyUI's temp folder."
                        ),
                    },
                ),
                "threshold": (
                    "FLOAT",
                    {
                        "default": 0.5,
                        "min": 0.05,
                        "max": 0.95,
                        "step": 0.05,
                        "tooltip": (
                            "How sure SAM 3 must be that something matches the name. "
                            "Lower finds more, higher finds less."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("MASK", "IMAGE", "INT")
    RETURN_NAMES = ("mask", "cut_out", "found")
    OUTPUT_TOOLTIPS = (
        "White where the thing is. One mask per picture.",
        "The picture with everything but the thing see-through (RGBA).",
        "How many things matched the name in the first picture.",
    )
    FUNCTION = "find"

    def __init__(self):
        # Per instance, so two of these in one graph never overwrite each
        # other's preview file.
        self._prefix = temp_prefix("mask_by_name")

    def _detect(self, model, clip, image, name, threshold):
        """Every match in every picture: (N x H x W masks, matches per picture).

        ComfyUI's own nodes do the work: CLIP Text Encode reads the name and
        SAM 3 Detect searches. Nothing of theirs is copied here."""
        core = _core_nodes()
        detector = core.get("SAM3_Detect")
        encoder = core.get("CLIPTextEncode")
        if detector is None or encoder is None or not hasattr(detector, "execute"):
            raise RuntimeError(NEEDS_SAM3)
        try:
            conditioning = encoder().encode(clip, name)[0]
            output = detector.execute(
                model=model,
                image=image,
                conditioning=conditioning,
                threshold=float(threshold),
                refine_iterations=REFINE_PASSES,
                individual_masks=True,
            )
        except Exception as error:  # noqa: BLE001 - told apart just below
            if _stopped_by_user(error) or _out_of_memory(error):
                raise
            # A model or text reader that is not SAM 3's fails somewhere
            # inside; say what to wire instead of showing that.
            raise RuntimeError(f"{NOT_SAM3} ({type(error).__name__}: {error})") from error
        masks, boxes = output.result
        return masks, [len(frame) for frame in boxes]

    def find(self, image, model, clip, name, several, grow, soften, if_nothing, preview=True, threshold=0.5):
        text = clean_name(name)
        if not text:
            raise ValueError(NO_NAME)
        masks, counts = self._detect(model, clip, image, text, threshold)
        if not sum(counts) and str(if_nothing) != "empty mask":
            raise RuntimeError(nothing_message(text))
        per_picture = [pick(found, str(several)) for found in split_by_frame(masks, counts)]
        mask = torch.stack(per_picture).to(dtype=torch.float32)
        if int(grow) > 0 or float(soften) > 0:
            mask = refine_mask(mask, int(grow), float(soften), False)[0]
        found = int(counts[0]) if counts else 0
        result = (mask, cut_out(image, mask), found)
        note = [{"found": found, "name": text}]
        if not preview:
            return {"ui": {UI_KEY: note}, "result": result}
        payload = preview_payload(tint_preview(image, mask), self._prefix, "Mask by Name", result)
        payload.setdefault("ui", {})[UI_KEY] = note
        return payload


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_MaskByName": AusBossMaskByName}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_MaskByName": "Mask by Name 🆎"}
