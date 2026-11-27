"""Cut Out 🆎."""

from __future__ import annotations

from ._cut_out_helpers import KEEP_CHOICES, cut_out
from ._preview_helpers import preview_payload, temp_prefix

PREVIEW_TOOLTIP = "Show the cut-out on its face, over a checkerboard. Off skips writing the preview file to ComfyUI's temp folder."


class AusBossCutOut:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Turns a picture and a mask into a cut-out with a see-through "
        "background, ready to save as a PNG or lay on a new background. "
        "Keep the white or the black part of the mask, grow or shrink it and "
        "soften its edge. Clean edges takes the old background's colour out "
        "of hair and soft edges, so the cut-out has no halo on a new "
        "background; pixels that are fully kept stay exactly as they were. "
        "Works on video frames too."
    )
    SEARCH_ALIASES = [
        "cut out", "cutout", "remove background", "transparent", "alpha", "rgba",
        "matte", "decontaminate", "edge halo", "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "The picture or video frames to cut out."}),
                "mask": ("MASK", {"tooltip": "What to keep. One mask can serve every frame of a video."}),
                "keep": (
                    list(KEEP_CHOICES),
                    {"default": "white", "tooltip": "Keep the part under the white of the mask, or under the black."},
                ),
                "grow": (
                    "INT",
                    {
                        "default": 0,
                        "min": -256,
                        "max": 256,
                        "step": 1,
                        "tooltip": "Grow the kept part by this many pixels, or shrink it with a negative number.",
                    },
                ),
                "feather": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.0,
                        "max": 256.0,
                        "step": 0.5,
                        "tooltip": "How soft the edge is, in pixels. 0 keeps the mask's own edge.",
                    },
                ),
                "clean_edges": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": "Take the old background's colour out of soft edges and hair, so the cut-out has no halo on a new background.",
                    },
                ),
                "clear_haze": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "tooltip": "Parts this see-through or more become fully clear. Raise it a little to clear a faint haze around the cut-out.",
                    },
                ),
                "solid_above": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "tooltip": "Parts at least this solid become fully solid. Lower it a little to fill thin see-through spots inside the subject.",
                    },
                ),
                "smooth_frames": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 8,
                        "step": 1,
                        "tooltip": "For a video: blend each frame's edge with this many frames before and after it, which calms a flickering edge. 0 is off.",
                    },
                ),
            },
            "optional": {
                "preview": ("BOOLEAN", {"default": True, "tooltip": PREVIEW_TOOLTIP}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "alpha")
    OUTPUT_TOOLTIPS = (
        "The cut-out with a see-through background (RGBA). Save Image keeps the transparency in a PNG.",
        "How solid each pixel of the cut-out is: white is kept, black is clear.",
    )
    FUNCTION = "cut"

    def __init__(self):
        self._prefix = temp_prefix("cut_out")

    def cut(
        self,
        image,
        mask,
        keep,
        grow,
        feather,
        clean_edges,
        clear_haze,
        solid_above,
        smooth_frames,
        preview=True,
    ):
        result, alpha = cut_out(
            image,
            mask,
            keep=str(keep),
            grow=int(grow),
            feather=float(feather),
            clean_edges=bool(clean_edges),
            clear_haze=float(clear_haze),
            solid_above=float(solid_above),
            smooth_frames=int(smooth_frames),
        )
        if not preview:
            return (result, alpha)
        return preview_payload(
            result, self._prefix, "Cut Out", (result, alpha), keep_alpha=True,
            live_sources={"image": image, "mask": mask},
        )


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_CutOut": AusBossCutOut}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_CutOut": "Cut Out 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
