"""LaMa Inpaint (AusBoss)."""

from __future__ import annotations

from ._lama_helpers import DEFAULT_MODEL_NAME, list_lama_models, run_lama_inpaint


NODE_ID = "AUSBOSS_NODES_LaMaInpaint"
LEGACY_NODE_ID = "SimpleWatermarkRemover"


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
        models = list_lama_models()
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
                    models,
                    {
                        "default": DEFAULT_MODEL_NAME if DEFAULT_MODEL_NAME in models else models[0],
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


class AusBossLegacySimpleWatermarkRemover:
    """Compatibility contract for the original published workflow."""

    CATEGORY = "🆎 AusBoss/Compatibility"
    DESCRIPTION = (
        "Compatibility alias for older workflows that stored the class type "
        "'SimpleWatermarkRemover'. Use LaMa Inpaint (AusBoss) in new workflows."
    )
    DEPRECATED = True

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
                    {"tooltip": "White areas are replaced."},
                ),
                "method": (
                    ["LAMA"],
                    {"default": "LAMA", "tooltip": "Legacy engine selector."},
                ),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    OUTPUT_TOOLTIPS = ("Inpainted BHWC image batch.",)
    FUNCTION = "inpaint"

    def inpaint(self, image, mask, method):
        if method != "LAMA":
            raise ValueError("SimpleWatermarkRemover compatibility supports only LAMA.")
        return (run_lama_inpaint(image, mask, DEFAULT_MODEL_NAME),)


NODE_CLASS_MAPPINGS = {
    NODE_ID: AusBossLaMaInpaint,
    LEGACY_NODE_ID: AusBossLegacySimpleWatermarkRemover,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    NODE_ID: "LaMa Inpaint (AusBoss)",
    LEGACY_NODE_ID: "Simple Watermark Remover (AusBoss Compatibility)",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
