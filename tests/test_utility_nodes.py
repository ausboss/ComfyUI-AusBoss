from __future__ import annotations

from pathlib import Path
import io
import sys
import unittest
from contextlib import redirect_stdout

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes.node_free_memory import AusBossFreeMemory
from nodes.node_literals import AusBossFloat, AusBossInteger, AusBossText
from nodes.node_math import AusBossMathExpression
from nodes.node_show_text import AusBossShowText


class LiteralNodeTests(unittest.TestCase):
    def test_text_passes_through_verbatim(self):
        text = "two\nlines, exactly as typed  "
        self.assertEqual(AusBossText().emit(text), (text,))

    def test_integer_and_float_pass_through(self):
        self.assertEqual(AusBossInteger().emit(-42), (-42,))
        self.assertEqual(AusBossFloat().emit(0.125), (0.125,))


class ShowTextNodeTests(unittest.TestCase):
    def test_ui_payload_carries_the_text_and_the_result_is_untouched(self):
        result = AusBossShowText().show("hello")
        self.assertEqual(result["ui"], {"text": ["hello"]})
        self.assertEqual(result["result"], ("hello",))

    def test_it_is_an_output_node(self):
        # OUTPUT_NODE is what lets the node run with nothing downstream.
        self.assertTrue(AusBossShowText.OUTPUT_NODE)

    def test_non_string_input_is_displayed_but_passed_through_unchanged(self):
        result = AusBossShowText().show(7)
        self.assertEqual(result["ui"], {"text": ["7"]})
        self.assertEqual(result["result"], (7,))


class MathExpressionNodeTests(unittest.TestCase):
    def test_returns_float_and_rounded_int(self):
        value, whole = AusBossMathExpression().calculate("a * 2 + 0.5", a=2.0)
        self.assertEqual(value, 4.5)
        self.assertEqual(whole, 5)
        self.assertIsInstance(whole, int)

    def test_unwired_variables_default_to_zero(self):
        value, whole = AusBossMathExpression().calculate("a + b + c")
        self.assertEqual((value, whole), (0.0, 0))


class FreeMemoryNodeTests(unittest.TestCase):
    def test_passthrough_returns_the_same_object(self):
        sentinel = object()
        with redirect_stdout(io.StringIO()) as captured:
            result = AusBossFreeMemory().free_memory(sentinel)
        self.assertIs(result[0], sentinel)
        self.assertIn("[AusBoss] Free Memory:", captured.getvalue())

    def test_wildcard_types_reach_the_schema(self):
        schema = AusBossFreeMemory.INPUT_TYPES()
        self.assertEqual(str(schema["required"]["value"][0]), "*")
        self.assertEqual(str(AusBossFreeMemory.RETURN_TYPES[0]), "*")


if __name__ == "__main__":
    unittest.main()
