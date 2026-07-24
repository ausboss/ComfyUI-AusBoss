"""Text Box (AusBoss) — a multiline text field with a STRING output.

The simplest possible node: one widget in, one value out. Kept as the
reference example of the minimal node shape used across this pack.
"""


class AusBossTextBox:
    DESCRIPTION = (
        "A multiline text field with a STRING output. Author a prompt, "
        "caption, or any long text in one place and wire it into as many "
        "downstream nodes as you like. Drag the node's corner to give "
        "yourself more writing room."
    )
    CATEGORY = "🧰 AusBoss/📝 Text"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "tooltip": "The text to output, sent exactly as typed.",
                    },
                ),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = ("The text from the field, exactly as typed.",)
    FUNCTION = "run"

    def run(self, text):
        return (text,)


NODE_CLASS_MAPPINGS = {"AusBossTextBox": AusBossTextBox}
NODE_DISPLAY_NAME_MAPPINGS = {"AusBossTextBox": "Text Box (AusBoss)"}
