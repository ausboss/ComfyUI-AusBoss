"""LoRA Loader (AusBoss)."""

from __future__ import annotations

from ._lora_helpers import (
    apply_lora_stack,
    collect_trigger_words,
    parse_lora_stack,
    register_lora_routes,
    resolve_lora_path,
    stack_fingerprint,
)


NODE_ID = "AUSBOSS_NODES_LoraLoader"


class AusBossLoraLoader:
    CATEGORY = "🆎 AusBoss/Loaders"
    DESCRIPTION = (
        "Applies a stack of LoRAs to a model and CLIP from one compact node. "
        "Each row has an enable toggle, a searchable LoRA picker, and "
        "drag-to-scrub model/CLIP strengths; trigger words from all enabled "
        "rows are joined into one string output."
    )
    SEARCH_ALIASES = ["lora", "lora stack", "lora loader", "trigger words", "ausboss"]

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
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("model", "clip", "trigger_words")
    OUTPUT_TOOLTIPS = (
        "The model with every enabled LoRA applied in row order.",
        "The CLIP with every enabled LoRA applied in row order.",
        "Comma-joined trigger words from enabled rows, deduplicated.",
    )
    FUNCTION = "load_loras"

    def load_loras(self, model, loras: str, clip=None):
        rows = parse_lora_stack(loras)
        model, clip = apply_lora_stack(model, clip, rows)
        return model, clip, collect_trigger_words(rows)

    @classmethod
    def VALIDATE_INPUTS(cls, loras, **_values):
        try:
            rows = parse_lora_stack(loras)
            for row in rows:
                if row["enabled"]:
                    resolve_lora_path(row["name"])
        except ValueError as exc:
            return f"LoRA Loader: {exc}"
        return True

    @classmethod
    def IS_CHANGED(cls, loras, **_values):
        try:
            return stack_fingerprint(parse_lora_stack(loras))
        except ValueError:
            return loras


NODE_CLASS_MAPPINGS = {NODE_ID: AusBossLoraLoader}
NODE_DISPLAY_NAME_MAPPINGS = {NODE_ID: "LoRA Loader (AusBoss)"}

register_lora_routes()

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
