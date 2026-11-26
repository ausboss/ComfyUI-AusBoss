"""Keep Detail 🆎."""

from __future__ import annotations

from ._detail_helpers import keep_detail
from ._preview_helpers import preview_payload, temp_prefix

PREVIEW_TOOLTIP = "Show this node's result on its face. Off skips writing the preview file to ComfyUI's temp folder."


class AusBossKeepDetail:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Puts the original picture's fine detail (skin, fabric, grain) back "
        "on an edited version of it. Use it after an edit or a relight that "
        "came out too smooth. The edit keeps its shapes, light and colour; "
        "only the detail smaller than Detail size comes from the original. "
        "The two pictures must line up. Light only brings back brightness "
        "detail, so the edit's colours never shift; color + light brings the "
        "detail's colour too."
    )
    SEARCH_ALIASES = [
        "keep detail", "frequency separation", "restore texture", "skin texture",
        "detail transfer", "high pass", "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "The edited picture that lost its detail."}),
                "detail_from": (
                    "IMAGE",
                    {
                        "tooltip": "The original picture, lined up with the edit. A different size is resized to the edit's.",
                    },
                ),
                "detail_size": (
                    "FLOAT",
                    {
                        "default": 4.0,
                        "min": 1.0,
                        "max": 64.0,
                        "step": 0.5,
                        "tooltip": "Detail smaller than this many pixels comes from the original; anything bigger stays the edit's. 2-6 for skin and fabric.",
                    },
                ),
                "strength": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.0,
                        "max": 2.0,
                        "step": 0.01,
                        "tooltip": "0 leaves the edit as it is, 1 puts the original's detail on it, above 1 makes the detail stronger.",
                    },
                ),
                "color_detail": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": "Off: light only, so the edit's colours never shift. On: the detail brings its colour too, such as freckles.",
                    },
                ),
                "edge_safe": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": "On: strong edges are left alone, so no light or dark rim appears along them. Off: a plain blur, a little softer.",
                    },
                ),
            },
            "optional": {
                "mask": ("MASK", {"tooltip": "Optional. Detail goes back only where the mask is white."}),
                "preview": ("BOOLEAN", {"default": True, "tooltip": PREVIEW_TOOLTIP}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    OUTPUT_TOOLTIPS = ("The edit with the original's detail, at the edit's size.",)
    FUNCTION = "keep"

    def __init__(self):
        self._prefix = temp_prefix("keep_detail")

    def keep(self, image, detail_from, detail_size, strength, color_detail, edge_safe, mask=None, preview=True):
        result, resized = keep_detail(
            image,
            detail_from,
            detail_size=float(detail_size),
            strength=float(strength),
            color_detail=bool(color_detail),
            edge_safe=bool(edge_safe),
            mask=mask,
        )
        if resized:
            print("[AusBoss] Keep Detail: detail_from was resized to the image's size.")
        if not preview:
            return (result,)
        return preview_payload(
            result, self._prefix, "Keep Detail", (result,),
            live_sources={"image": image, "detail_from": detail_from, "mask": mask},
        )


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_KeepDetail": AusBossKeepDetail}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_KeepDetail": "Keep Detail 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
