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

try:
    import torch
except ImportError:  # the standard-library run has no torch
    torch = None

from nodes.node_free_memory import AusBossFreeMemory
from nodes.node_literals import AusBossFloat, AusBossInteger, AusBossText
from nodes.node_math import AusBossMathExpression
from nodes.node_run_timer import AusBossRunTimer
from nodes.node_seed import MAX_SEED, AusBossSeed
from nodes.node_show_text import AusBossShowText, as_text
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

    def test_a_number_is_shown_and_comes_out_as_that_text(self):
        # The output is STRING: a number that went out as a number would
        # break the text node it is wired to.
        result = AusBossShowText().show(7)
        self.assertEqual(result["ui"], {"text": ["7"]})
        self.assertEqual(result["result"], ("7",))

    def test_the_input_takes_any_wire(self):
        kind = AusBossShowText.INPUT_TYPES()["required"]["text"][0]
        self.assertEqual(kind, "*")
        # ComfyUI checks a link with != on the two type names.
        for other in ("STRING", "INT", "FLOAT", "BOOLEAN", "IMAGE", "LATENT"):
            self.assertFalse(other != kind)
            self.assertFalse(kind != other)
        self.assertEqual(AusBossShowText.RETURN_TYPES, ("STRING",))

    def test_every_kind_of_value_has_a_text(self):
        self.assertEqual(as_text("as typed\n  "), "as typed\n  ")
        self.assertEqual(as_text(1024), "1024")
        self.assertEqual(as_text(0.85), "0.85")
        self.assertEqual(as_text(True), "True")
        self.assertEqual(as_text(None), "None")
        self.assertEqual(as_text([1, "two", 3.5]), '[\n  1,\n  "two",\n  3.5\n]')
        self.assertEqual(as_text({"name": "caf\u00e9"}), '{\n  "name": "caf\u00e9"\n}')
        self.assertEqual(as_text((1, 2)), "[\n  1,\n  2\n]")

    def test_a_picture_or_a_latent_is_named_by_its_size(self):
        class Tensor:
            """What the node reads from a tensor: its size, its kind and, for one number, its value."""

            def __init__(self, shape, value=None):
                self.shape, self.dtype, self.value = shape, "torch.float32", value

            def item(self):
                return self.value

        self.assertEqual(as_text(Tensor((2, 64, 48, 3))), "tensor 2 x 64 x 48 x 3, float32")
        self.assertEqual(as_text(Tensor((), 7)), "7")
        latent = as_text({"samples": Tensor((1, 16, 8, 8))})
        self.assertEqual(latent, '{\n  "samples": "tensor 1 x 16 x 8 x 8, float32"\n}')

    @unittest.skipIf(torch is None, "needs torch")
    def test_a_real_tensor_reads_the_same(self):
        self.assertEqual(as_text(torch.zeros((2, 64, 48, 3))), "tensor 2 x 64 x 48 x 3, float32")
        self.assertEqual(as_text(torch.tensor(7)), "7")

    def test_a_value_json_cannot_write_still_has_a_text(self):
        class Odd:
            def __str__(self):
                return "an odd thing"

        self.assertEqual(as_text(Odd()), "an odd thing")
        self.assertEqual(as_text([Odd()]), '[\n  "an odd thing"\n]')
        loop = []
        loop.append(loop)
        self.assertIsInstance(as_text(loop), str)


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
