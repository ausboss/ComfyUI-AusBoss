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
from nodes.node_run_timer import AusBossRunTimer
from nodes.node_seed import MAX_SEED, AusBossSeed
from nodes.node_show_text import AusBossShowText
from nodes.node_workflow_note import AusBossWorkflowNote


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




class SeedNodeTests(unittest.TestCase):
    def test_reports_the_seed_it_ran_with_and_passes_it_through(self):
        result = AusBossSeed().emit(976771647159643)
        self.assertEqual(result["ui"], {"seed": [976771647159643]})
        self.assertEqual(result["result"], (976771647159643,))

    def test_seed_widget_covers_the_sampler_range_and_has_a_control(self):
        spec = AusBossSeed.INPUT_TYPES()["required"]["seed"]
        self.assertEqual(spec[0], "INT")
        self.assertEqual(spec[1]["min"], 0)
        self.assertEqual(spec[1]["max"], MAX_SEED)
        self.assertEqual(spec[1]["max"], 0xFFFFFFFFFFFFFFFF)
        self.assertTrue(spec[1]["control_after_generate"])
        self.assertEqual(AusBossSeed.RETURN_TYPES, ("INT",))


class PresentationNodeTests(unittest.TestCase):
    """Workflow Note and Run Timer never execute: no outputs, not output nodes."""

    def test_workflow_note_stores_the_card_in_one_string_widget(self):
        inputs = AusBossWorkflowNote.INPUT_TYPES()
        self.assertEqual(list(inputs["required"]), ["note"])
        spec = inputs["required"]["note"]
        self.assertEqual(spec[0], "STRING")
        self.assertTrue(spec[1]["multiline"])
        self.assertEqual(spec[1]["default"], "{}")
        self.assertEqual(AusBossWorkflowNote.RETURN_TYPES, ())
        self.assertFalse(getattr(AusBossWorkflowNote, "OUTPUT_NODE", False))
        self.assertEqual(AusBossWorkflowNote().noop("{}"), ())

    def test_run_timer_has_no_wires_at_all(self):
        self.assertEqual(AusBossRunTimer.INPUT_TYPES(), {"required": {}})
        self.assertEqual(AusBossRunTimer.RETURN_TYPES, ())
        self.assertFalse(getattr(AusBossRunTimer, "OUTPUT_NODE", False))
        self.assertEqual(AusBossRunTimer().noop(), ())


if __name__ == "__main__":
    unittest.main()
