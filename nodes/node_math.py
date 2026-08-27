"""Math Expression 🆎."""

from __future__ import annotations

from ._math_helpers import evaluate_expression, round_half_away_from_zero


class AusBossMathExpression:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "Evaluates one arithmetic expression over the inputs a, b and c and "
        "returns it as both FLOAT and INT — width and height math, strength "
        "ramps, frame counts. Allowed: numbers, a/b/c, + - * / // % ** and "
        "parentheses, and min, max, abs, round, floor, ceil, sqrt. The "
        "expression is parsed, never eval()'d, so a shared workflow cannot "
        "smuggle code through this node."
    )
    SEARCH_ALIASES = ["math", "expression", "calculate", "formula", "arithmetic", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "expression": (
                    "STRING",
                    {
                        "default": "a + b",
                        "tooltip": (
                            "Arithmetic over a, b and c: numbers, + - * / // % **, "
                            "parentheses, and min/max/abs/round/floor/ceil/sqrt."
                        ),
                    },
                ),
            },
            "optional": {
                "a": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": -1.0e15,
                        "max": 1.0e15,
                        "step": 0.001,
                        "tooltip": "The value of a in the expression.",
                    },
                ),
                "b": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": -1.0e15,
                        "max": 1.0e15,
                        "step": 0.001,
                        "tooltip": "The value of b in the expression.",
                    },
                ),
                "c": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": -1.0e15,
                        "max": 1.0e15,
                        "step": 0.001,
                        "tooltip": "The value of c in the expression.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("FLOAT", "INT")
    RETURN_NAMES = ("float", "int")
    OUTPUT_TOOLTIPS = (
        "The result as a float.",
        "The result rounded to the nearest whole number (halves round away from zero).",
    )
    FUNCTION = "calculate"

    def calculate(self, expression, a=0.0, b=0.0, c=0.0):
        value = evaluate_expression(expression, {"a": a, "b": b, "c": c})
        return (value, round_half_away_from_zero(value))


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_MathExpression": AusBossMathExpression}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_MathExpression": "Math Expression 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
