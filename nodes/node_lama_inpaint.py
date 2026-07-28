"""LaMa Inpaint (AusBoss)."""

from __future__ import annotations

from ._lama_helpers import DEFAULT_MODEL_NAME, list_lama_models, run_lama_inpaint


NODE_ID = "AUSBOSS_NODES_LaMaInpaint"


class AusBossLaMaInpaint:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Removes masked content with a TorchScript LaMa model while preserving "
        "unmasked pixels. Models are read from ComfyUI/models/lama and are never "
        "downloaded by the node."
    )
    SEARCH_ALIASES = ["lama", "inpaint", "watermark remover", "object removal", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": (
                    "IMAGE",
                    {"tooltip": "BHWC images or video frames to inpaint."},
                ),
                "mask": (
                    "MASK",
                    {
                        "tooltip": (
                            "White areas are replaced. One mask may be broadcast "
                            "across the full image batch."
                        )
                    },
                ),
                "model": (
                    list_lama_models(),
                    {
                        "default": DEFAULT_MODEL_NAME,
                        "tooltip": "TorchScript LaMa checkpoint from ComfyUI/models/lama.",
                    },
                ),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    OUTPUT_TOOLTIPS = (
        "Inpainted BHWC image batch with the original dimensions and unmasked pixels preserved.",
    )
    FUNCTION = "inpaint"

    def inpaint(self, image, mask, model):
        return (run_lama_inpaint(image, mask, model),)

    @classmethod
    def VALIDATE_INPUTS(cls, model, **_values):
        from ._lama_helpers import resolve_lama_model

        try:
            resolve_lama_model(model)
        except Exception as exc:
            return f"LaMa Inpaint: {exc}"
        return True


NODE_CLASS_MAPPINGS = {NODE_ID: AusBossLaMaInpaint}
NODE_DISPLAY_NAME_MAPPINGS = {NODE_ID: "LaMa Inpaint (AusBoss)"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
