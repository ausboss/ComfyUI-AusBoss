"""Callout 🆎 - a note for the canvas: big readable text and arrows."""

from __future__ import annotations


class AusBossCallout:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "A note for the canvas. Write a line or two and the text grows to "
        "fill the note, so it reads without zooming in. An arrow emoji in "
        "the text turns into a teal arrow that sits in the line. "
        "Double-click to edit. Nothing runs: the node has no inputs or "
        "outputs."
    )
    SEARCH_ALIASES = [
        "callout",
        "note",
        "sticky note",
        "label",
        "arrow",
        "annotation",
        "comment",
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
                        "tooltip": (
                            "What the note says. A blank line starts a new "
                            "point. Put **double stars** around a word to "
                            "stress it. An arrow emoji, or -> and <-, "
                            "becomes an arrow."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "noop"

    def noop(self, text):
        # Never reached: with no outputs and OUTPUT_NODE unset the node is
        # not part of any prompt.
        return ()


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_Callout": AusBossCallout}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_Callout": "Callout 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
