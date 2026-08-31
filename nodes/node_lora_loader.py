"""LoRA Loader 🆎."""

from __future__ import annotations

from ._lora_helpers import (
    apply_lora_stack,
    collect_trigger_words,
    parse_lora_stack,
    register_lora_routes,
    stack_fingerprint,
)


class AusBossLoraLoader:
    CATEGORY = "🆎 AusBoss/Loaders"
    DESCRIPTION = (
        "Applies a stack of LoRAs to a model and CLIP from one compact node. "
        "Each row has an enable toggle, a searchable LoRA picker, "
        "drag-to-scrub model/CLIP strengths, and a center-zero strength bar "
        "behind its name; trigger words from all enabled rows are joined "
        "into one string output. The bar's ▤ button saves and applies named "
        "templates of the whole stack, and a gear-menu action absorbs every "
        "LoRA loader wired into the model chain - upstream and downstream - "
        "into this stack and bypasses the originals. Moved LoRA files "
        "resolve by name at run time; a missing one warns and skips instead "
        "of failing the whole run."
    )
    SEARCH_ALIASES = [
        "lora", "lora stack", "lora loader", "trigger words",
        "strength bars", "import loras", "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL", {"tooltip": "The diffusion model the LoRA stack patches."}),
                "loras": (
                    "STRING",
                    {
                        "default": "[]",
                        "multiline": True,
                        "tooltip": (
                            "Serialized LoRA stack managed by the node's row "
                            "editor; edit the rows, not this value."
                        ),
                    },
                ),
            },
            "optional": {
                "clip": ("CLIP", {"tooltip": "Optional CLIP to patch; without it, CLIP strengths are ignored."}),
                "trigger_separator": (
                    "STRING",
                    {
                        "default": ", ",
                        "tooltip": (
                            "Joins the enabled rows' trigger words into the "
                            "triggers output. Set from the node's gear "
                            "menu; hidden on the canvas."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    # "triggers", not "trigger_words": output links ride slot indices, so the
    # label is free to be short - and the narrow name is what leaves room for
    # the control cluster floating in the slot band on the frontend.
    RETURN_NAMES = ("model", "clip", "triggers")
    OUTPUT_TOOLTIPS = (
        "The model with every enabled LoRA applied in row order.",
        "The CLIP with every enabled LoRA applied in row order.",
        "Comma-joined trigger words from enabled rows, deduplicated.",
    )
    FUNCTION = "load_loras"

    def load_loras(self, model, loras: str, clip=None, trigger_separator=", "):
        rows = parse_lora_stack(loras)
        model, clip = apply_lora_stack(model, clip, rows)
        return model, clip, collect_trigger_words(rows, str(trigger_separator))

    @classmethod
    def VALIDATE_INPUTS(cls, loras, **_values):
        # Structural validation only. A row whose FILE is gone must not block
        # the queue: apply_lora_stack resolves moved files by basename, and a
        # genuinely missing one warns and skips so the rest of the run stands.
        try:
            parse_lora_stack(loras)
        except ValueError as exc:
            return f"LoRA Loader: {exc}"
        return True

    @classmethod
    def IS_CHANGED(cls, loras, **_values):
        try:
            return stack_fingerprint(parse_lora_stack(loras))
        except ValueError:
            return loras


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_LoraLoader": AusBossLoraLoader}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_LoraLoader": "LoRA Loader 🆎"}

register_lora_routes()

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
