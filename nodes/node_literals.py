"""Text, Integer and Float 🆎 — one tight family of constant-value nodes.

Deliberately minimal: each is a single widget on its own wire, the utility
that used to mean installing a whole grab-bag pack for a text box.
"""

from __future__ import annotations


class AusBossText:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "A multiline text box on its own STRING wire. Feed one prompt to "
        "several encoders, or keep a caption next to the nodes that use it, "
        "without retyping it in each one. The output is exactly what you "
        "typed."
    )
    SEARCH_ALIASES = ["text box", "string", "prompt text", "multiline", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "tooltip": "The text to output, passed through exactly as typed.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = ("The text, exactly as typed.",)
    FUNCTION = "emit"

    def emit(self, text):
        return (text,)


class AusBossInteger:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "A single INT value on its own wire. Set steps, sizes or counts in "
        "one place and feed every node that needs the same number."
    )
    SEARCH_ALIASES = ["int", "integer", "number", "constant", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": (
                    "INT",
                    {
                        "default": 0,
                        "min": -2_147_483_648,
                        "max": 2_147_483_647,
                        "step": 1,
                        "tooltip": "The integer to output.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("int",)
    OUTPUT_TOOLTIPS = ("The integer, unchanged.",)
    FUNCTION = "emit"

    def emit(self, value):
        return (value,)


class AusBossFloat:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "A single FLOAT value on its own wire. Share one strength, scale or "
        "CFG across several nodes and change it in one place."
    )
    SEARCH_ALIASES = ["float", "number", "decimal", "constant", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": -1.0e15,
                        "max": 1.0e15,
                        "step": 0.001,
                        "tooltip": "The float to output.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("FLOAT",)
    RETURN_NAMES = ("float",)
    OUTPUT_TOOLTIPS = ("The float, unchanged.",)
    FUNCTION = "emit"

    def emit(self, value):
        return (value,)


NODE_CLASS_MAPPINGS = {
    "AUSBOSS_NODES_Text": AusBossText,
    "AUSBOSS_NODES_Integer": AusBossInteger,
    "AUSBOSS_NODES_Float": AusBossFloat,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "AUSBOSS_NODES_Text": "Text 🆎",
    "AUSBOSS_NODES_Integer": "Integer 🆎",
    "AUSBOSS_NODES_Float": "Float 🆎",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
