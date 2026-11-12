"""Prompt Variations 🆎 — one prompt, a different mix of choices on every run."""

from __future__ import annotations

from ._prompt_variations_helpers import pick_variations


class AusBossPromptVariations:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "A prompt box that changes on every run. Write choices in curly "
        "brackets, such as a {red|blue|green} {sweater|jacket}, and the node "
        "picks one from each set. The seed decides the picks: the same seed "
        "gives the same prompt again, and a new seed on each run gives a new "
        "mix. Text without brackets comes out exactly as typed."
    )
    SEARCH_ALIASES = [
        "random prompt", "wildcard", "dynamic prompt", "variations",
        "random choice", "prompt mixer", "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "dynamicPrompts": False,
                        "tooltip": (
                            "Your prompt. Put choices in curly brackets, split "
                            "by |, such as {tank top|sweater|shirt}. One is "
                            "picked from each set."
                        ),
                    },
                ),
                "seed": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 0xFFFFFFFFFFFFFFFF,
                        "forceInput": True,
                        "tooltip": (
                            "Wire in the seed your sampler uses. A new seed "
                            "picks new choices; the same seed picks the same "
                            "ones again."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    OUTPUT_TOOLTIPS = ("The prompt with one choice picked from each set.",)
    FUNCTION = "pick"

    def pick(self, text, seed):
        prompt, _picks = pick_variations(text, seed)
        return (prompt,)


NODE_CLASS_MAPPINGS = {
    "AUSBOSS_NODES_PromptVariations": AusBossPromptVariations,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "AUSBOSS_NODES_PromptVariations": "Prompt Variations 🆎",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
