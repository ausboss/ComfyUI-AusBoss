"""Show Text 🆎."""

from __future__ import annotations

import json

from ._memory_helpers import WILDCARD


def _by_size(value) -> str | None:
    """A picture, mask or latent as its size, or None for anything else."""
    shape = getattr(value, "shape", None)
    if shape is None:
        return None
    try:
        sizes = [int(side) for side in shape]
    except (TypeError, ValueError):
        return None
    if not sizes:
        # A single number held in a tensor reads as that number.
        try:
            return str(value.item())
        except Exception:  # noqa: BLE001 - any odd object falls back to its own text
            return None
    kind = str(getattr(value, "dtype", "")).replace("torch.", "")
    return "tensor " + " x ".join(str(side) for side in sizes) + (f", {kind}" if kind else "")


def as_text(value) -> str:
    """What the panel shows, and the output carries, for a value.

    Text stays as it is. A number or a switch becomes its digits or its
    word. A list or a dict becomes JSON. A picture, a mask or a latent is
    named by its size, since its numbers would fill the panel.
    """
    if isinstance(value, str):
        return value
    if value is None or isinstance(value, (bool, int, float)):
        return str(value)
    sized = _by_size(value)
    if sized is not None:
        return sized
    if isinstance(value, (dict, list, tuple)):
        try:
            return json.dumps(value, indent=2, ensure_ascii=False, default=lambda inner: _by_size(inner) or str(inner))
        except (TypeError, ValueError):
            pass
    return str(value)


class AusBossShowText:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "Shows what arrives on a wire, on the node itself: a prompt, an LLM "
        "reply, a file name, a number. Text passes through unchanged, so "
        "the node can sit in the middle of a wire. A number or any other "
        "value comes out as the text that is shown. The text can be "
        "selected and copied."
    )
    SEARCH_ALIASES = [
        "show text", "display text", "preview text", "print string",
        "preview any", "show any", "show number", "to string", "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": (
                    WILDCARD,
                    {
                        "forceInput": True,
                        "tooltip": "What to show. Text, a number, or any other wire.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = ("The text that is shown. Text that came in passes through unchanged.",)
    FUNCTION = "show"
    OUTPUT_NODE = True

    def show(self, text):
        # The ui payload is what the frontend panel renders (delivered to
        # onExecuted). The output is the same text: a string that came in
        # is passed on untouched, anything else as what the panel shows, so
        # the STRING output never carries a value that is not text.
        shown = as_text(text)
        return {"ui": {"text": [shown]}, "result": (shown,)}


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_ShowText": AusBossShowText}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_ShowText": "Show Text 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
