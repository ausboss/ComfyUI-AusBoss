"""Show Text (AusBoss) — displays whatever STRING is wired in, right on the node.

Backend half of a two-part pattern: run() returns a "ui" payload that
ComfyUI pushes to the browser, and js/show_text/index.js writes it into a
read-only widget. Use this file plus that JS file as the template for any
future node that needs to display results on the canvas.
"""


class AusBossShowText:
    DESCRIPTION = (
        "Displays incoming text directly on the node after each run, and "
        "passes it through unchanged so it can sit in the middle of a "
        "pipeline. Wire any STRING output in (prompts, file paths, info "
        "strings) to see the value without digging through the console."
    )
    CATEGORY = "🧰 AusBoss/📝 Text"
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": (
                    "STRING",
                    {
                        "forceInput": True,
                        "tooltip": "Any STRING output. Its value shows on the node after the run.",
                    },
                ),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = ("The same text, passed through unchanged.",)
    FUNCTION = "run"

    def run(self, text):
        # "ui" values must be lists — ComfyUI serializes them to the browser
        # and hands them to the node's onExecuted() in the frontend JS.
        return {"ui": {"text": [text]}, "result": (text,)}


NODE_CLASS_MAPPINGS = {"AusBossShowText": AusBossShowText}
NODE_DISPLAY_NAME_MAPPINGS = {"AusBossShowText": "Show Text (AusBoss)"}
