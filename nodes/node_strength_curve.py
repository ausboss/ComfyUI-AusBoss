"""Strength Curve 🆎."""

from __future__ import annotations

from ._curve_helpers import DEFAULT_POINTS, SCHEDULE_LIMIT, build_schedule, parse_points
from ._execution_helpers import ignore_extra_inputs


class AusBossStrengthCurve:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "Draw how strong something should be from the start of a run to the "
        "end, and wire the curve into a node that follows it step by step: "
        "a LoRA row of LoRA Loader 🆎, or the reference of Krea 2 Encode 🆎. "
        "Fade a style LoRA out so the details come out clean, or let a "
        "reference hold the layout early and loosen up late. Drag the points "
        "on the node, or start from a preset."
    )
    SEARCH_ALIASES = [
        "strength curve",
        "strength schedule",
        "lora schedule",
        "fade lora",
        "curve",
        "schedule",
        "floats",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "points": (
                    "STRING",
                    {
                        "default": DEFAULT_POINTS,
                        "tooltip": (
                            "The curve's points as [where, value] pairs, both from "
                            "0 to 1. Drawn and edited on the node."
                        ),
                    },
                ),
                "high": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.0,
                        "max": SCHEDULE_LIMIT,
                        "step": 0.01,
                        "tooltip": "The strength at the top of the curve box. 1 is full strength.",
                    },
                ),
                "low": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": SCHEDULE_LIMIT,
                        "step": 0.01,
                        "tooltip": "The strength at the bottom of the curve box. 0 is off.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("FLOATS",)
    RETURN_NAMES = ("curve",)
    OUTPUT_TOOLTIPS = (
        "The strength over the run, as a list of numbers from start to end. "
        "Wire it into LoRA Loader 🆎's curve or Krea 2 Encode 🆎's reference_curve.",
    )
    FUNCTION = "build"

    def build(self, points, high=1.0, low=0.0):
        return (build_schedule(points, low=low, high=high),)

    @classmethod
    @ignore_extra_inputs
    def VALIDATE_INPUTS(cls, points):
        try:
            parse_points(points)
        except ValueError as exc:
            return str(exc)
        return True


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_StrengthCurve": AusBossStrengthCurve}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_StrengthCurve": "Strength Curve 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
