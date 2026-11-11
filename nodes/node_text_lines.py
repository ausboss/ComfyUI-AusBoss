"""Text Lines 🆎 — run what comes after once for each line of text."""

from __future__ import annotations

from ._text_lines_helpers import SPLIT_EACH_LINE, SPLIT_MODES, split_items

MAX_LIMIT = 1000


class AusBossTextLines:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "Runs what comes after once for each line of your text. Type five "
        "prompts, one on each line, and one run makes five pictures. Empty "
        "lines are skipped, and a number or bullet at the start of a line "
        "can be taken off."
    )
    SEARCH_ALIASES = [
        "prompt list",
        "one prompt per line",
        "each line",
        "split text",
        "text to list",
        "batch prompts",
        "queue prompts",
        "ausboss",
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
                        "tooltip": "One line for each run. Type it here, or wire in text another node wrote.",
                    },
                ),
                "split": (
                    list(SPLIT_MODES),
                    {
                        "default": SPLIT_EACH_LINE,
                        "tooltip": (
                            "each line: every line is its own run. blank line: lines stay "
                            "together, and an empty line starts the next run."
                        ),
                    },
                ),
                "remove_numbering": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            'On: a number or bullet at the start is taken off, like "1.", "-" '
                            'or "[prompt 2]". Off: every line stays as written.'
                        ),
                    },
                ),
                "limit": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": MAX_LIMIT,
                        "step": 1,
                        "tooltip": "The most lines to run. 0 runs them all.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING", "INT", "INT")
    RETURN_NAMES = ("line", "number", "count")
    OUTPUT_IS_LIST = (True, True, False)
    OUTPUT_TOOLTIPS = (
        "Each line, one at a time. What comes after runs once for each.",
        "The line's place in the list, starting at 1. Add it to a seed to give each run its own.",
        "How many lines run.",
    )
    FUNCTION = "split"

    def split(self, text, split=SPLIT_EACH_LINE, remove_numbering=True, limit=0):
        items = split_items(text, split, remove_numbering, limit)
        if not items:
            raise ValueError(
                "Text Lines has no lines to run. Type at least one line, or check the node that writes its text."
            )
        return (items, list(range(1, len(items) + 1)), len(items))


NODE_CLASS_MAPPINGS = {
    "AUSBOSS_NODES_TextLines": AusBossTextLines,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "AUSBOSS_NODES_TextLines": "Text Lines 🆎",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
