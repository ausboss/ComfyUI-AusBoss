"""Film Grain 🆎."""

from __future__ import annotations

from ._grain_helpers import add_film_grain, auto_film_grain_values
from ._grain_match_helpers import matched_film_grain_values
from ._preview_helpers import preview_payload, temp_prefix

PREVIEW_TOOLTIP = "Show this node's result on its face. Off skips writing the preview file to ComfyUI's temp folder."


class AusBossFilmGrain:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Adds film grain to a picture or a video. The grain is strongest in "
        "the midtones and gentler in deep shadows and bright highlights, as "
        "on film. Size is the grain's size in pixels, roughness makes it "
        "finer and more uneven, and color turns it from black-and-white "
        "grain to colour film's. On a video it can move from frame to "
        "frame or stay put. An optional mask adds grain only where it is "
        "white. The same seed always gives the same grain. With Auto on, it "
        "picks the amount and size for the picture; wire a picture into "
        "grain from and it copies that picture's grain instead."
    )
    SEARCH_ALIASES = ["film grain", "grain", "noise", "35mm", "film look", "analog", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "The picture or video frames to add grain to."}),
                "amount": (
                    "FLOAT",
                    {
                        "default": 0.25,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "tooltip": "How strong the grain is. 0 adds none; 0.25 is a clearly visible film look.",
                    },
                ),
                "size": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.5,
                        "max": 4.0,
                        "step": 0.1,
                        "tooltip": "How big each grain is, in pixels of this picture. Raise it for a big picture or a coarse film look.",
                    },
                ),
                "roughness": (
                    "FLOAT",
                    {
                        "default": 0.5,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "tooltip": "0 is even, soft grain. Higher mixes in finer grain that bunches up unevenly, like real film.",
                    },
                ),
                "color": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "tooltip": "0 is black-and-white grain. Higher gives each colour its own grain, like colour film.",
                    },
                ),
                "moving": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": "For a video. On: new grain on every frame, so it moves like film. Off: every frame gets the same grain.",
                    },
                ),
                "seed": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 0xFFFFFFFFFFFFFFFF,
                        "control_after_generate": False,
                        "tooltip": "Picks the grain pattern. The same seed always gives the same grain.",
                    },
                ),
            },
            "optional": {
                "mask": ("MASK", {"tooltip": "Optional. Grain goes only where the mask is white."}),
                "preview": ("BOOLEAN", {"default": True, "tooltip": PREVIEW_TOOLTIP}),
                "auto": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": "On: the node picks Amount and Size for this picture, so the grain looks the same on a small or a big one and matches the grain it already has. Amount and Size then become multipliers of its pick.",
                    },
                ),
                "auto_amount": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.0,
                        "max": 4.0,
                        "step": 0.05,
                        "tooltip": "Used while Auto is on. 1 is Auto's pick; 1.5 is half as strong again.",
                    },
                ),
                "auto_size": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.25,
                        "max": 4.0,
                        "step": 0.05,
                        "tooltip": "Used while Auto is on. 1 is Auto's pick; 2 is grain twice as big.",
                    },
                ),
                "grain_from": (
                    "IMAGE",
                    {
                        "tooltip": "Optional. A picture whose grain you like. With Auto on, the node copies its grain: how strong, how big and how colourful. Roughness stays yours.",
                    },
                ),
                "auto_color": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.0,
                        "max": 4.0,
                        "step": 0.05,
                        "tooltip": "Used while Auto copies grain from a picture. 1 is the copied colour; 0 makes it black-and-white grain.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    OUTPUT_TOOLTIPS = ("The picture or video frames with grain, at the same size.",)
    FUNCTION = "grain"

    def __init__(self):
        self._prefix = temp_prefix("film_grain")

    def grain(
        self, image, amount, size, roughness, color, moving, seed, mask=None, preview=True,
        auto=False, auto_amount=1.0, auto_size=1.0, grain_from=None, auto_color=1.0,
    ):
        sent = None
        if auto and grain_from is not None:
            # The card's notes and the live preview read the match from here.
            picked = matched_film_grain_values(
                grain_from, image, float(roughness), int(seed), float(auto_amount), float(auto_size), float(auto_color),
            )
            amount, size, color = picked["amount"], picked["size"], picked["color"]
            sent = {"ausboss_grain_match": [{key: round(float(value), 5) for key, value in picked.items()}]}
        elif auto:
            picked = auto_film_grain_values(image, float(auto_amount), float(auto_size))
            amount, size = picked["amount"], picked["size"]
            sent = {"ausboss_grain_auto": [{key: round(value, 5) for key, value in picked.items()}]}
        result = add_film_grain(image, float(amount), float(size), float(roughness), float(color), bool(moving), int(seed), mask)
        if not preview:
            return (result,)
        return preview_payload(
            result, self._prefix, "Film Grain", (result,),
            extra_ui=sent,
            live_sources={"image": image, "mask": mask},
        )


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_FilmGrain": AusBossFilmGrain}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_FilmGrain": "Film Grain 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
