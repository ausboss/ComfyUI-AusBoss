"""FlashVSR Upscale 🆎."""

from __future__ import annotations

from ._flashvsr_helpers import EXPECTED_MODEL_NAME, list_flashvsr_models, resolve_flashvsr_model, run_flashvsr


class AusBossFlashVSRUpscale:
    CATEGORY = "🆎 AusBoss/Video"
    DESCRIPTION = (
        "Makes a video larger and sharper with the FlashVSR model. Pick the "
        "model file, set how much larger, and run. It reads the clip a few "
        "frames at a time, so a long clip needs no more graphics memory than "
        "a short one, and every frame comes back. Connect the Wan 2.1 VAE "
        "for a slower, finer finish."
    )
    SEARCH_ALIASES = [
        "flashvsr",
        "video upscale",
        "upscale video",
        "video super resolution",
        "vsr",
        "sharpen video",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        models = list_flashvsr_models()
        return {
            "required": {
                "frames": (
                    "IMAGE",
                    {"tooltip": "The video frames to make larger."},
                ),
                "model": (
                    models,
                    {
                        "default": EXPECTED_MODEL_NAME if EXPECTED_MODEL_NAME in models else models[0],
                        "tooltip": "The FlashVSR model file, from ComfyUI/models/diffusion_models.",
                    },
                ),
                "scale": (
                    "FLOAT",
                    {
                        "default": 2.0,
                        "min": 1.0,
                        "max": 4.0,
                        "step": 0.25,
                        "tooltip": "How many times larger each side gets. 1 keeps the size and only sharpens.",
                    },
                ),
                "color_match": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": "Keeps each frame's colours the same as your video. Leave it on.",
                    },
                ),
            },
            "optional": {
                "vae": (
                    "VAE",
                    {
                        "tooltip": (
                            "Optional. Connect the Wan 2.1 VAE for a slower, finer finish. "
                            "Left empty, the fast decoder inside the model file is used."
                        )
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("frames",)
    OUTPUT_TOOLTIPS = ("The larger, sharper frames: as many as went in.",)
    FUNCTION = "upscale"

    def upscale(self, frames, model, scale, color_match, vae=None):
        output = run_flashvsr(resolve_flashvsr_model(model), frames, float(scale), bool(color_match), vae)
        return (output,)


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_FlashVSRUpscale": AusBossFlashVSRUpscale}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_FlashVSRUpscale": "FlashVSR Upscale 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
