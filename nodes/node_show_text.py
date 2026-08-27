"""Show Text 🆎."""

from __future__ import annotations


class AusBossShowText:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "Displays the STRING it receives on the node face — an LLM reply, a "
        "generated caption, a resolved filename — and passes it through "
        "unchanged, so it can sit in the middle of a wire instead of at a "
        "dead end. The shown text can be selected and copied."
    )
    SEARCH_ALIASES = ["show text", "display text", "preview text", "print string", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": (
                    "STRING",
                    {
                        "forceInput": True,
                        "tooltip": "The text to display on the node face.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = ("The input text, passed through unchanged.",)
    FUNCTION = "show"
    OUTPUT_NODE = True

    def show(self, text):
        # The ui payload is what the frontend panel renders (delivered to
        # onExecuted); the result tuple is the real output and stays the
        # original value untouched.
        shown = text if isinstance(text, str) else str(text)
        return {"ui": {"text": [shown]}, "result": (text,)}


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_ShowText": AusBossShowText}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_ShowText": "Show Text 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
