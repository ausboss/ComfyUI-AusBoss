"""Stable V1 widget definitions shared by the two transform nodes."""

from __future__ import annotations

from ._transform_engine import TransformSpec


ASPECT_RATIOS = ["free", "source", "1:1", "9:16", "16:9", "2:3", "3:2", "3:4", "4:3", "9:21", "21:9"]


def transform_inputs() -> dict[str, tuple]:
    return {
        "rotation_degrees": (
            "FLOAT",
            {
                "default": 0.0,
                "min": -180.0,
                "max": 180.0,
                "step": 0.1,
                "tooltip": "Clockwise rotation applied before crop and padding.",
            },
        ),
        "crop_aspect_ratio": (
            ASPECT_RATIOS,
            {"default": "free", "tooltip": "Locks crop handles to a ratio; free allows any rectangle."},
        ),
        "crop_x": ("INT", {"default": 0, "min": 0, "max": 65536, "step": 1}),
        "crop_y": ("INT", {"default": 0, "min": 0, "max": 65536, "step": 1}),
        "crop_width": (
            "INT",
            {"default": 0, "min": 0, "max": 65536, "step": 1, "tooltip": "0 keeps the full available width."},
        ),
        "crop_height": (
            "INT",
            {"default": 0, "min": 0, "max": 65536, "step": 1, "tooltip": "0 keeps the full available height."},
        ),
        "pad_left": ("INT", {"default": 0, "min": 0, "max": 32768, "step": 1}),
        "pad_top": ("INT", {"default": 0, "min": 0, "max": 32768, "step": 1}),
        "pad_right": ("INT", {"default": 0, "min": 0, "max": 32768, "step": 1}),
        "pad_bottom": ("INT", {"default": 0, "min": 0, "max": 32768, "step": 1}),
        "feather": (
            "INT",
            {
                "default": 0,
                "min": 0,
                "max": 4096,
                "step": 1,
                "tooltip": "Softens generated-region edges into retained source pixels.",
            },
        ),
        "canvas_multiple": (
            "INT",
            {
                "default": 1,
                "min": 1,
                "max": 4096,
                "step": 1,
                "tooltip": "Rounds output up by adding the minimum extra pixels to right and bottom.",
            },
        ),
        "fill_color": (
            "STRING",
            {
                "default": "#808080",
                "tooltip": "Color for rotation voids and padding; accepts #RRGGBB or R, G, B.",
            },
        ),
    }


def spec_from_values(**values) -> TransformSpec:
    names = TransformSpec.__dataclass_fields__.keys()
    return TransformSpec(**{name: values[name] for name in names if name in values}).normalized()

