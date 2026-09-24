"""Seed 🆎 — one seed on its own wire, with a memory of what actually ran."""

from __future__ import annotations

MAX_SEED = 0xFFFFFFFFFFFFFFFF


class AusBossSeed:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "A seed on its own INT wire, so several samplers share one number "
        "and a shared workflow can pin the exact seed that made its example. "
        "Random, Fixed and Step work like a sampler's control after "
        "generate. Because Random replaces the value the moment a run is "
        "queued, the node reports the seed it actually ran with: the line "
        "under the box shows it, Use last run puts it back in the box and "
        "pins it, and the history menu keeps the last few so a good result "
        "is never lost to the next click."
    )
    SEARCH_ALIASES = ["seed", "random seed", "noise seed", "last seed", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "seed": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": MAX_SEED,
                        "control_after_generate": True,
                        "tooltip": (
                            "The seed sent down the wire. The control beneath "
                            "it decides what happens after each queue: fixed "
                            "keeps it, randomize picks a new one."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("seed",)
    OUTPUT_TOOLTIPS = ("The seed, unchanged — wire it to every sampler that should share it.",)
    FUNCTION = "emit"

    def emit(self, seed):
        # The ui payload is what the frontend records as "last used": the
        # value this run was queued with, even if randomize has already
        # moved the widget on to the next one.
        return {"ui": {"seed": [seed]}, "result": (seed,)}


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_Seed": AusBossSeed}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_Seed": "Seed 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
