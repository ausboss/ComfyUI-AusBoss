"""Resolution Master 🆎 — pick a canvas size by ratio chips or by stretching it.

The node face is a DOM panel (js/resolution/index.js): a ratio rail picks
the SHAPE, a live stage lets you stretch the actual rectangle, and the
size ladder offers on-grid rungs — width and height are always the
visible, derived result. This backend is deliberately small: the panel
drives ordinary hidden widgets (the pack's widgets-as-the-single-source-
of-truth rule), so save/load, undo, the API format, and headless runs all
ride LiteGraph's default path — no state blob, no queue-time patching.

Besides the two INTs it emits an empty LATENT of that size, so the node
replaces the Empty*LatentImage node that used to sit beside it. The latent
family (channel count and downsample) is a hidden combo the panel's gear
sets; the constants are architecture facts, not anyone's model card.
"""

from __future__ import annotations

try:  # Offline tests import this module without ComfyUI.
    import torch
    import comfy.model_management as model_management
except ImportError:  # pragma: no cover - exercised only outside ComfyUI
    torch = None
    model_management = None

DIM_MIN = 64
DIM_MAX = 8192

# label -> (channels, downsample). The label is the combo value, kept
# short so the gear's segmented control fits; the tooltip names families.
LATENT_FAMILIES = {
    "16ch": (16, 8),   # SD3, Flux 1, Krea 2, Qwen Image, Z-Image
    "4ch": (4, 8),     # SD 1.5, SDXL
    "128ch": (128, 16),  # Flux 2 (Klein)
}
DEFAULT_FAMILY = "16ch"


def clamp_dimension(value, fallback: int = 1024) -> int:
    """A defensive clamp; the panel already snaps, this just refuses junk."""
    try:
        number = int(round(float(value)))
    except (TypeError, ValueError, OverflowError):
        return fallback
    return max(DIM_MIN, min(DIM_MAX, number))


def latent_shape(width: int, height: int, family: str, batch_size: int) -> tuple[int, int, int, int]:
    """The zeros tensor shape an Empty*Latent node would build for this size."""
    channels, down = LATENT_FAMILIES.get(family, LATENT_FAMILIES[DEFAULT_FAMILY])
    batch = max(1, min(64, int(batch_size) if str(batch_size).lstrip("-").isdigit() else 1))
    return (batch, channels, max(1, height // down), max(1, width // down))


def empty_latent(width: int, height: int, family: str, batch_size: int):
    shape = latent_shape(width, height, family, batch_size)
    if torch is None:
        raise RuntimeError("Resolution latent output requires ComfyUI and PyTorch.")
    kwargs = {}
    if model_management is not None:
        kwargs["device"] = model_management.intermediate_device()
        dtype = getattr(model_management, "intermediate_dtype", None)
        if callable(dtype):
            kwargs["dtype"] = dtype()
    return {"samples": torch.zeros(list(shape), **kwargs)}


class AusBossResolution:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "Canvas size picker: ratio chips pick the shape, a live stage lets "
        "you drag the rectangle's edges and corner, and a size ladder offers "
        "on-grid rungs for the current ratio — snapped to VAE-friendly "
        "multiples with a ratio lock that stays exact AND on-grid. Outputs "
        "the width and height as INTs plus an empty LATENT of that size, so "
        "it feeds the sampler directly; the latent family (16ch for SD3 / "
        "Flux / Krea 2 / Qwen / Z-Image, 4ch for SD1.5 / SDXL, 128ch for "
        "Flux 2 Klein) and the batch size live behind the panel's gear."
    )
    SEARCH_ALIASES = [
        "resolution", "aspect ratio", "size", "width height", "canvas",
        "empty latent", "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": (
                    "INT",
                    {
                        "default": 1024,
                        "min": DIM_MIN,
                        "max": DIM_MAX,
                        "step": 8,
                        "tooltip": (
                            "Output width in pixels. Set from the panel; "
                            "typed values are never re-snapped."
                        ),
                    },
                ),
                "height": (
                    "INT",
                    {
                        "default": 1024,
                        "min": DIM_MIN,
                        "max": DIM_MAX,
                        "step": 8,
                        "tooltip": (
                            "Output height in pixels. Set from the panel; "
                            "typed values are never re-snapped."
                        ),
                    },
                ),
            },
            "optional": {
                "latent": (
                    list(LATENT_FAMILIES),
                    {
                        "default": DEFAULT_FAMILY,
                        "tooltip": (
                            "Latent family for the LATENT output. 16ch: SD3, "
                            "Flux 1, Krea 2, Qwen Image, Z-Image. 4ch: SD 1.5 "
                            "and SDXL. 128ch: Flux 2 (Klein). Set from the "
                            "panel's gear."
                        ),
                    },
                ),
                "batch_size": (
                    "INT",
                    {
                        "default": 1,
                        "min": 1,
                        "max": 64,
                        "tooltip": "How many latents to make. Set from the panel's gear.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("INT", "INT", "LATENT")
    RETURN_NAMES = ("width", "height", "latent")
    OUTPUT_TOOLTIPS = (
        "The picked width in pixels.",
        "The picked height in pixels.",
        "An empty latent of this size in the chosen family — wire it straight "
        "into the sampler in place of an Empty*LatentImage node.",
    )
    FUNCTION = "resolve"

    def resolve(self, width, height, latent=DEFAULT_FAMILY, batch_size=1):
        w = clamp_dimension(width)
        h = clamp_dimension(height)
        return (w, h, empty_latent(w, h, latent, batch_size))


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_Resolution": AusBossResolution}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_Resolution": "Resolution Master 🆎"}
