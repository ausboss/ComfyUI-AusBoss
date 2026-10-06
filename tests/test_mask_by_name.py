"""Mask by Name: what it does with what SAM 3 finds, and what it says when it
finds nothing. ComfyUI's own detector is stood in for by a fake, so these run
without ComfyUI and without a model."""

from __future__ import annotations

from pathlib import Path
import sys
import types
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import node_mask_by_name  # noqa: E402
from nodes._mask_by_name_helpers import (  # noqa: E402
    IF_NOTHING,
    NEEDS_SAM3,
    NO_NAME,
    SEVERAL,
    SURENESS,
    clean_name,
    cut_out,
    nothing_message,
    pick,
    search_text,
    split_by_frame,
    tint_preview,
)

H, W = 40, 60


def blob(top, left, height, width):
    mask = torch.zeros(H, W)
    mask[top:top + height, left:left + width] = 1.0
    return mask


SMALL = blob(2, 2, 6, 6)
BIG = blob(10, 20, 20, 30)


class FakeDetect:
    """Stands in for ComfyUI's SAM3_Detect: returns whatever `found` holds,
    one list of masks per picture, the way the real node does."""

    found: list = []
    calls: list = []

    @classmethod
    def execute(cls, model, image, conditioning=None, threshold=0.5, refine_iterations=2, individual_masks=False):
        cls.calls.append({"conditioning": conditioning, "threshold": threshold, "passes": refine_iterations, "individual": individual_masks})
        frames = cls.found
        stacks = [torch.stack(masks) if masks else torch.zeros(0, H, W) for masks in frames]
        boxes = [[{"x": 0, "y": 0, "width": 1, "height": 1, "score": 0.9 - 0.25 * k} for k, _ in enumerate(masks)] for masks in frames]
        return types.SimpleNamespace(result=(torch.cat(stacks, dim=0), boxes))


class FakeEncode:
    def encode(self, clip, text):
        return ([["conditioning for", clip, text]],)


def use_fake_core(testcase, found):
    FakeDetect.found = found
    FakeDetect.calls = []
    real = node_mask_by_name._core_nodes
    node_mask_by_name._core_nodes = lambda: {"SAM3_Detect": FakeDetect, "CLIPTextEncode": FakeEncode}
    testcase.addCleanup(setattr, node_mask_by_name, "_core_nodes", real)


def run(image=None, **overrides):
    values = {"name": "the dog", "several": SEVERAL[0], "grow": 0, "soften": 0.0, "if_nothing": IF_NOTHING[0], "preview": False, "threshold": 0.5}
    values.update(overrides)
    node = node_mask_by_name.AusBossMaskByName()
    picture = torch.rand(1, H, W, 3) if image is None else image
    return node.find(picture, "sam3 model", "sam3 clip", **values)


class HelperTests(unittest.TestCase):
    def test_the_name_is_tidied(self):
        self.assertEqual(clean_name("  the   red\n jacket "), "the red jacket")
        self.assertEqual(clean_name(None), "")
        self.assertEqual(len(clean_name("x" * 900)), 200)

    def test_every_name_asks_sam3_for_several_matches(self):
        # ComfyUI's SAM 3 text reader returns one match per name unless the
        # name ends in ":N"; without it only one of two scarves comes back.
        self.assertEqual(search_text("the scarves"), "the scarves:16")
        self.assertEqual(search_text(" the hat ,  the bag "), "the hat:16, the bag:16")
        self.assertEqual(search_text("the dog:2, the cat"), "the dog:2, the cat:16")
        self.assertEqual(search_text("(the dog)"), "the dog:16")
        self.assertEqual(search_text("the dog:"), "the dog:16")
        self.assertEqual(search_text("the dog", 4), "the dog:4")
        self.assertEqual(search_text(" , "), "")

    def test_the_default_sureness_is_above_comfyuis(self):
        self.assertEqual(SURENESS, 0.7)
        spec = node_mask_by_name.AusBossMaskByName.INPUT_TYPES()["optional"]["threshold"][1]
        self.assertEqual(spec["default"], SURENESS)

    def test_the_messages_are_plain_and_ascii(self):
        text = nothing_message("the hat")
        self.assertIn('nothing called "the hat" was found', text)
        self.assertIn("Sureness", text)
        for message in (text, NO_NAME, NEEDS_SAM3):
            message.encode("ascii")  # raised into consoles that may be cp1252

    def test_the_stack_is_cut_back_into_pictures(self):
        stack = torch.stack([SMALL, BIG, SMALL])
        first, second, third = split_by_frame(stack, [2, 0, 1])
        self.assertEqual([int(first.shape[0]), int(second.shape[0]), int(third.shape[0])], [2, 0, 1])
        self.assertTrue(torch.equal(third[0], SMALL))
        with self.assertRaises(ValueError):
            split_by_frame(stack, [1, 1])
        with self.assertRaises(ValueError):
            split_by_frame(torch.zeros(H, W), [1])

    def test_all_of_them_joins_and_the_biggest_keeps_one(self):
        both = torch.stack([SMALL, BIG])
        self.assertTrue(torch.equal(pick(both, "all of them"), torch.maximum(SMALL, BIG)))
        self.assertTrue(torch.equal(pick(both, "the biggest"), BIG))
        self.assertTrue(torch.equal(pick(torch.stack([BIG, SMALL]), "the biggest"), BIG))
        self.assertTrue(torch.equal(pick(SMALL.unsqueeze(0), "the biggest"), SMALL))
        nothing = pick(torch.zeros(0, H, W), "all of them")
        self.assertEqual(tuple(nothing.shape), (H, W))
        self.assertEqual(float(nothing.sum()), 0.0)

    def test_the_cut_out_carries_the_mask_as_its_see_through_channel(self):
        image = torch.rand(2, H, W, 3)
        cut = cut_out(image, torch.stack([SMALL, BIG]))
        self.assertEqual(tuple(cut.shape), (2, H, W, 4))
        self.assertTrue(torch.equal(cut[..., :3], image))
        self.assertTrue(torch.equal(cut[1, ..., 3], BIG))
        # One mask for several pictures is used for each.
        self.assertTrue(torch.equal(cut_out(image, BIG.unsqueeze(0))[1, ..., 3], BIG))
        # A picture that already has a see-through channel keeps only its colour.
        self.assertEqual(tuple(cut_out(torch.rand(1, H, W, 4), BIG.unsqueeze(0)).shape), (1, H, W, 4))

    def test_the_preview_tints_only_what_was_found(self):
        image = torch.full((2, H, W, 3), 0.5)
        shown = tint_preview(image, torch.stack([BIG, SMALL]))
        self.assertEqual(tuple(shown.shape), (1, H, W, 3), "the first picture only")
        self.assertTrue(torch.allclose(shown[0, 0, 0], torch.tensor([0.5, 0.5, 0.5])), "far from the thing: untouched")
        inside = shown[0, 20, 35]
        self.assertGreater(float(inside[1]), 0.6)
        self.assertLess(float(inside[0]), 0.3)
        self.assertTrue(torch.allclose(shown[0, 10, 35], torch.tensor([0.47, 1.0, 0.94])), "its edge is outlined")
        untouched = tint_preview(image, torch.zeros(1, H, W))
        self.assertTrue(torch.allclose(untouched, image[:1]))


class NodeTests(unittest.TestCase):
    def test_it_asks_comfyui_for_every_match_and_returns_mask_cut_out_and_count(self):
        use_fake_core(self, [[SMALL, BIG]])
        out = run(threshold=0.3)
        mask, cut, found = out["result"]
        self.assertEqual(found, 2)
        self.assertTrue(torch.equal(mask[0], torch.maximum(SMALL, BIG)))
        self.assertEqual(tuple(cut.shape), (1, H, W, 4))
        self.assertEqual(out["ui"], {"ausboss_mask_by_name": [{"found": 2, "name": "the dog", "sure": [0.9, 0.65]}]})
        call = FakeDetect.calls[0]
        self.assertEqual(call["conditioning"], [["conditioning for", "sam3 clip", "the dog:16"]])
        self.assertEqual((call["threshold"], call["passes"], call["individual"]), (0.3, 2, True))

    def test_the_biggest_keeps_one_thing(self):
        use_fake_core(self, [[SMALL, BIG]])
        mask, _cut, found = run(several="the biggest")["result"]
        self.assertTrue(torch.equal(mask[0], BIG))
        self.assertEqual(found, 2, "the count is what matched, not what was kept")

    def test_nothing_found_stops_the_run_with_a_plain_message(self):
        use_fake_core(self, [[]])
        with self.assertRaises(RuntimeError) as stopped:
            run(name="  the   hat ")
        self.assertEqual(str(stopped.exception), nothing_message("the hat"))

    def test_nothing_found_can_pass_an_empty_mask_on_instead(self):
        use_fake_core(self, [[]])
        out = run(if_nothing="empty mask")
        mask, cut, found = out["result"]
        self.assertEqual((found, float(mask.sum()), tuple(mask.shape)), (0, 0.0, (1, H, W)))
        self.assertEqual(float(cut[..., 3].sum()), 0.0)
        self.assertEqual(out["ui"]["ausboss_mask_by_name"], [{"found": 0, "name": "the dog", "sure": []}])

    def test_a_batch_stops_only_when_no_picture_has_it(self):
        use_fake_core(self, [[], [BIG]])
        mask, _cut, found = run(image=torch.rand(2, H, W, 3))["result"]
        self.assertEqual(tuple(mask.shape), (2, H, W))
        self.assertEqual((found, float(mask[0].sum())), (0, 0.0))
        self.assertTrue(torch.equal(mask[1], BIG))
        use_fake_core(self, [[], []])
        with self.assertRaises(RuntimeError):
            run(image=torch.rand(2, H, W, 3))

    def test_an_empty_name_is_asked_for_before_any_search(self):
        use_fake_core(self, [[BIG]])
        with self.assertRaises(ValueError) as asked:
            run(name="   ")
        self.assertEqual(str(asked.exception), NO_NAME)
        self.assertEqual(FakeDetect.calls, [])

    def test_grow_reaches_past_the_edge_and_soften_blurs_it(self):
        use_fake_core(self, [[BIG]])
        grown = run(grow=3)["result"][0][0]
        self.assertEqual(float(grown[8, 30]), 1.0, "two pixels above the thing is now inside")
        self.assertEqual(float(grown[5, 30]), 0.0)
        soft = run(soften=3.0)["result"][0][0]
        self.assertTrue(0.05 < float(soft[10, 35]) < 0.95, "the edge is no longer hard")
        exact = run()["result"][0][0]
        self.assertTrue(torch.equal(exact, BIG), "0 and 0 keep the outline SAM 3 found")

    def test_without_comfyuis_sam3_it_says_what_it_needs(self):
        real = node_mask_by_name._core_nodes
        node_mask_by_name._core_nodes = lambda: {}
        self.addCleanup(setattr, node_mask_by_name, "_core_nodes", real)
        with self.assertRaises(RuntimeError) as needs:
            run()
        self.assertEqual(str(needs.exception), NEEDS_SAM3)

    def test_a_model_that_is_not_sam3_gets_wiring_advice_not_a_stack_trace(self):
        class Broken(FakeDetect):
            @classmethod
            def execute(cls, **_kwargs):
                raise AttributeError("'Flux' object has no attribute 'forward_segment'")

        real = node_mask_by_name._core_nodes
        node_mask_by_name._core_nodes = lambda: {"SAM3_Detect": Broken, "CLIPTextEncode": FakeEncode}
        self.addCleanup(setattr, node_mask_by_name, "_core_nodes", real)
        with self.assertRaises(RuntimeError) as advice:
            run()
        self.assertIn("Load Checkpoint that loads the SAM 3 file", str(advice.exception))
        self.assertIn("forward_segment", str(advice.exception))

    def test_a_stop_by_the_user_and_a_full_gpu_are_passed_on_as_they_are(self):
        class InterruptProcessingException(Exception):
            pass

        for error in (InterruptProcessingException(), RuntimeError("CUDA out of memory")):
            class Raises(FakeDetect):
                @classmethod
                def execute(cls, **_kwargs):
                    raise error

            real = node_mask_by_name._core_nodes
            node_mask_by_name._core_nodes = lambda: {"SAM3_Detect": Raises, "CLIPTextEncode": FakeEncode}
            try:
                with self.assertRaises(type(error)) as passed:
                    run()
                self.assertIs(passed.exception, error)
            finally:
                node_mask_by_name._core_nodes = real

    def test_it_is_an_output_node_so_it_can_run_on_its_own(self):
        self.assertIs(node_mask_by_name.AusBossMaskByName.OUTPUT_NODE, True)
        self.assertEqual(node_mask_by_name.AusBossMaskByName.RETURN_NAMES, ("mask", "cut_out", "found"))


if __name__ == "__main__":
    unittest.main()
