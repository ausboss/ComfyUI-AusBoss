from __future__ import annotations

from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._math_helpers import (
    MAX_EXPRESSION_LENGTH,
    evaluate_expression,
    round_half_away_from_zero,
)


class EvaluateExpressionTests(unittest.TestCase):
    def test_arithmetic_and_precedence(self):
        self.assertEqual(evaluate_expression("1 + 2 * 3"), 7.0)
        self.assertEqual(evaluate_expression("(1 + 2) * 3"), 9.0)
        self.assertEqual(evaluate_expression("7 // 2"), 3.0)
        self.assertEqual(evaluate_expression("7 % 2"), 1.0)
        self.assertEqual(evaluate_expression("2 ** 8"), 256.0)
        self.assertEqual(evaluate_expression("-(2 + 3)"), -5.0)
        self.assertEqual(evaluate_expression("+4"), 4.0)

    def test_variables_and_defaults(self):
        values = {"a": 2.0, "b": 3.0, "c": 4.0}
        self.assertEqual(evaluate_expression("a * b + c", values), 10.0)
        # A variable the caller never supplied evaluates as 0.0.
        self.assertEqual(evaluate_expression("a + c", {"a": 1.0}), 1.0)

    def test_function_whitelist_works(self):
        self.assertEqual(evaluate_expression("min(3, 1, 2)"), 1.0)
        self.assertEqual(evaluate_expression("max(3, 1, 2)"), 3.0)
        self.assertEqual(evaluate_expression("abs(-2)"), 2.0)
        self.assertEqual(evaluate_expression("round(2.567, 2)"), 2.57)
        self.assertEqual(evaluate_expression("round(2.4)"), 2.0)
        self.assertEqual(evaluate_expression("floor(2.9)"), 2.0)
        self.assertEqual(evaluate_expression("ceil(2.1)"), 3.0)
        self.assertEqual(evaluate_expression("sqrt(16)"), 4.0)

    def test_results_are_floats_even_from_int_literals(self):
        result = evaluate_expression("1 + 2")
        self.assertIsInstance(result, float)

    def test_empty_and_blank_expressions_are_refused(self):
        for expression in ("", "   "):
            with self.assertRaisesRegex(ValueError, "empty"):
                evaluate_expression(expression)

    def test_division_by_zero_reports_clearly(self):
        for expression in ("1 / 0", "1 // 0", "1 % 0"):
            with self.assertRaisesRegex(ValueError, "divided by zero"):
                evaluate_expression(expression)

    def test_huge_powers_overflow_instead_of_hanging(self):
        # Float arithmetic turns a tower of powers into OverflowError where
        # integer power would build a number with hundreds of millions of
        # digits before anyone could stop it.
        with self.assertRaisesRegex(ValueError, "too large"):
            evaluate_expression("9 ** 9 ** 9")

    def test_negative_sqrt_and_fractional_power_are_refused(self):
        with self.assertRaisesRegex(ValueError, "sqrt|cannot take"):
            evaluate_expression("sqrt(-1)")
        with self.assertRaisesRegex(ValueError, "fractional power"):
            evaluate_expression("(-2) ** 0.5")

    def test_function_arity_is_checked(self):
        with self.assertRaisesRegex(ValueError, "min\\(\\) takes"):
            evaluate_expression("min(1)")
        with self.assertRaisesRegex(ValueError, "abs\\(\\) takes"):
            evaluate_expression("abs(1, 2)")

    def test_unparseable_expressions_name_the_problem(self):
        with self.assertRaisesRegex(ValueError, "parsed"):
            evaluate_expression("1 +")


class ExpressionSafetyTests(unittest.TestCase):
    """The expression is attacker-controlled; everything here must be refused."""

    def test_rejects_import(self):
        with self.assertRaisesRegex(ValueError, "__import__"):
            evaluate_expression("__import__('os')")
        # The full attack chain dies on whichever wall it hits first.
        with self.assertRaises(ValueError):
            evaluate_expression("__import__('os').system('true')")
        with self.assertRaisesRegex(ValueError, "a, b and c"):
            evaluate_expression("__import__")

    def test_rejects_attribute_access(self):
        with self.assertRaisesRegex(ValueError, "attribute access"):
            evaluate_expression("a.__class__")
        with self.assertRaisesRegex(ValueError, "attribute access"):
            evaluate_expression("(1).__class__.__bases__")

    def test_rejects_subscripts(self):
        with self.assertRaisesRegex(ValueError, "subscripts"):
            evaluate_expression("a[0]")

    def test_rejects_names_beyond_abc(self):
        for expression in ("d + 1", "eval", "open", "globals"):
            with self.assertRaisesRegex(ValueError, "a, b and c"):
                evaluate_expression(expression)

    def test_rejects_functions_outside_the_whitelist(self):
        with self.assertRaisesRegex(ValueError, "does not allow the function"):
            evaluate_expression("pow(2, 3)")

    def test_rejects_non_numeric_literals(self):
        with self.assertRaisesRegex(ValueError, "only numbers"):
            evaluate_expression("'x' * 3")
        with self.assertRaisesRegex(ValueError, "only numbers"):
            evaluate_expression("True + 1")

    def test_rejects_non_arithmetic_syntax(self):
        for expression in (
            "(lambda: 1)()",
            "[i for i in (1, 2)]",
            "1 if a else 2",
            "a < b",
            "a and b",
            "f'{a}'",
            "min(*a)",
            "{1: 2}",
        ):
            with self.assertRaises(ValueError, msg=expression):
                evaluate_expression(expression)

    def test_rejects_keyword_arguments(self):
        with self.assertRaisesRegex(ValueError, "keyword"):
            evaluate_expression("round(1.5, ndigits=1)")

    def test_rejects_oversized_expressions(self):
        expression = "1" + " + 1" * (MAX_EXPRESSION_LENGTH // 3)
        with self.assertRaisesRegex(ValueError, "limited to"):
            evaluate_expression(expression)

    def test_deep_nesting_is_an_error_not_a_crash(self):
        depth = 4000
        expression = "(" * 0 + "-" * depth + "1"
        if len(expression) > MAX_EXPRESSION_LENGTH:
            expression = "-" * (MAX_EXPRESSION_LENGTH - 1) + "1"
        with self.assertRaisesRegex(ValueError, "nested too deeply|limited to"):
            evaluate_expression(expression)


class RoundHalfAwayTests(unittest.TestCase):
    def test_halves_round_away_from_zero(self):
        self.assertEqual(round_half_away_from_zero(2.5), 3)
        self.assertEqual(round_half_away_from_zero(-2.5), -3)

    def test_ordinary_values_round_to_nearest(self):
        self.assertEqual(round_half_away_from_zero(2.4), 2)
        self.assertEqual(round_half_away_from_zero(2.6), 3)
        self.assertEqual(round_half_away_from_zero(-0.4), 0)
        self.assertEqual(round_half_away_from_zero(-0.5), -1)


if __name__ == "__main__":
    unittest.main()
