"""Strength Curve 🆎 and the schedules it feeds.

Plain tests need no ComfyUI. The tests under `CoreHookTests` drive core's own
hook keyframes and a tiny Krea 2 model on the CPU, and skip without

    AUSBOSS_COMFY_ROOT=<ComfyUI> python tests/test_strength_curve.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import random
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
COMFY_ROOT = os.environ.get("AUSBOSS_COMFY_ROOT")
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._curve_helpers import (  # noqa: E402
    CURVE_SAMPLES,
    as_schedule,
    build_schedule,
    curve_values,
    keyframe_plan,
    noise_plan,
    parse_points,
    schedule_at,
    strength_at_noise,
)
from nodes._lora_helpers import parse_lora_stack, stack_fingerprint  # noqa: E402
from nodes.node_strength_curve import AusBossStrengthCurve  # noqa: E402

FADE_OUT = "[[0, 1], [1, 0]]"


class PointTests(unittest.TestCase):
    def test_points_are_sorted_clamped_and_reach_both_ends(self):
        self.assertEqual(parse_points("[[0.5, 2], [0.2, -1]]"), [(0.0, 0.0), (0.2, 0.0), (0.5, 1.0), (1.0, 1.0)])

    def test_objects_and_lists_both_work_and_a_repeated_place_keeps_the_last(self):
        self.assertEqual(parse_points([{"x": 0, "y": 0.5}, [0, 0.25], [1, 1]]), [(0.0, 0.25), (1.0, 1.0)])

    def test_empty_is_a_flat_line_at_one(self):
        for raw in (None, "", "[]", []):
            self.assertEqual(parse_points(raw), [(0.0, 1.0), (1.0, 1.0)])

    def test_bad_points_say_what_is_wrong(self):
        for raw, words in (("{", "not valid JSON"), ('{"a": 1}', "must be a list"),
                           ("[[0]]", "point 1"), ('[[0, "x"]]', "number"), ("[[0, NaN]]", "finite"),
                           (json.dumps([[i / 40, 0] for i in range(40)]), "at most")):
            with self.assertRaises(ValueError) as caught:
                parse_points(raw)
            self.assertIn(words, str(caught.exception))
            self.assertIn("Strength Curve", str(caught.exception))

    def test_the_curve_passes_through_every_point(self):
        points = parse_points("[[0, 1], [0.3, 0.2], [0.7, 0.9], [1, 0]]")
        for (x, y), value in zip(points, curve_values(points, [x for x, _ in points])):
            self.assertAlmostEqual(value, y, places=9)

    def test_the_curve_never_overshoots_its_points(self):
        rng = random.Random(7)
        places = [i / 1000 for i in range(1001)]
        for _ in range(300):
            points = parse_points([[rng.random(), rng.random()] for _ in range(rng.randint(2, 9))])
            values = curve_values(points, places)
            for (x0, y0), (x1, y1) in zip(points, points[1:]):
                for place, value in zip(places, values):
                    if x0 <= place <= x1:
                        self.assertGreaterEqual(value, min(y0, y1) - 1e-9)
                        self.assertLessEqual(value, max(y0, y1) + 1e-9)

    def test_a_rising_run_of_points_gives_a_rising_curve(self):
        points = parse_points("[[0, 0], [0.1, 0.05], [0.5, 0.9], [1, 1]]")
        values = curve_values(points, [i / 200 for i in range(201)])
        self.assertEqual(values, sorted(values))


class ScheduleTests(unittest.TestCase):
    def test_the_schedule_spans_bottom_to_top(self):
        values = build_schedule(FADE_OUT, low=0.25, high=1.5)
        self.assertEqual(len(values), CURVE_SAMPLES)
        self.assertAlmostEqual(values[0], 1.5)
        self.assertAlmostEqual(values[-1], 0.25)
        self.assertAlmostEqual(values[50], 0.875)

    def test_the_node_returns_the_schedule_and_validates_its_points(self):
        self.assertEqual(AusBossStrengthCurve().build(FADE_OUT, high=2.0, low=0.0)[0], build_schedule(FADE_OUT, 0.0, 2.0))
        self.assertIs(AusBossStrengthCurve.VALIDATE_INPUTS(points=FADE_OUT), True)
        self.assertIn("Strength Curve", AusBossStrengthCurve.VALIDATE_INPUTS(points="[[0"))

    def test_a_link_can_bring_a_list_or_one_number(self):
        self.assertIsNone(as_schedule(None))
        self.assertIsNone(as_schedule([]))
        self.assertEqual(as_schedule(0.5), [0.5])
        self.assertEqual(as_schedule((1, -2, 99)), [1.0, 0.0, 10.0])
        with self.assertRaises(ValueError):
            as_schedule(["a"])
        with self.assertRaises(ValueError):
            as_schedule([float("inf")])

    def test_reading_between_samples_is_straight(self):
        self.assertEqual(schedule_at([0.0, 1.0], 0.25), 0.25)
        self.assertEqual(schedule_at([0.0, 1.0, 0.0], 0.75), 0.5)
        self.assertEqual(schedule_at([0.4], 0.9), 0.4)
        self.assertEqual(schedule_at([], 0.5), 1.0)

    def test_keyframes_change_only_where_the_strength_moves(self):
        self.assertEqual(keyframe_plan(build_schedule("[[0, 1], [1, 1]]")), [(0.0, 1.0)])
        plan = keyframe_plan(build_schedule("[[0, 1], [0.5, 1], [0.5001, 0], [1, 0]]"))
        self.assertEqual(plan[0], (0.0, 1.0))
        self.assertLessEqual(len(plan), 4)
        fade = keyframe_plan(build_schedule(FADE_OUT))
        self.assertEqual(len(fade), CURVE_SAMPLES)
        self.assertEqual([p for p, _ in fade], sorted(p for p, _ in fade))

    def test_the_step_takes_the_last_keyframe_its_noise_level_has_reached(self):
        starts = noise_plan([(0.0, 1.0), (0.5, 0.5), (0.75, 0.2)], lambda percent: 1.0 - percent)
        self.assertEqual(starts, [(1.0, 1.0), (0.5, 0.5), (0.25, 0.2)])
        self.assertEqual([strength_at_noise(starts, sigma) for sigma in (1.0, 0.7, 0.5, 0.3, 0.25, 0.0)],
                         [1.0, 1.0, 0.5, 0.5, 0.2, 0.2])
        # The first step of a run always takes the first keyframe, as core's do.
        self.assertEqual(strength_at_noise(starts, 0.4, first=True), 1.0)
        self.assertEqual(strength_at_noise([], 0.4), 1.0)

    def test_a_short_list_from_another_node_is_read_smoothly(self):
        plan = dict(keyframe_plan([1.0, 0.0]))
        self.assertAlmostEqual(plan[0.5], 0.5)


class LoraRowTests(unittest.TestCase):
    def test_a_row_follows_the_curve_only_when_marked(self):
        rows = parse_lora_stack(json.dumps([
            {"id": "a", "name": "a.safetensors", "curve": True},
            {"id": "b", "name": "b.safetensors", "curve": "yes"},
            {"id": "c", "name": "c.safetensors"},
        ]))
        self.assertEqual([row["curve"] for row in rows], [True, False, False])

    def test_the_mark_changes_the_cache_key_and_old_rows_keep_theirs(self):
        plain = parse_lora_stack('[{"id": "a", "name": "a.safetensors"}]')
        marked = parse_lora_stack('[{"id": "a", "name": "a.safetensors", "curve": true}]')
        self.assertNotEqual(stack_fingerprint(plain), stack_fingerprint(marked))
        self.assertFalse(stack_fingerprint(plain).endswith("|curve"))


def load_core():
    """ComfyUI's runtime on the CPU, or a reason to skip."""
    if not COMFY_ROOT:
        return "set AUSBOSS_COMFY_ROOT to a ComfyUI checkout"
    os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
    sys.path.append(COMFY_ROOT)
    sys.argv = sys.argv[:1]
    try:
        import comfy.cli_args

        comfy.cli_args.args.cpu = True
        import torch
        import comfy.hooks
        import comfy.model_patcher
        import comfy.sample
        import comfy.supported_models
    except ImportError as exc:
        return f"this ComfyUI cannot be loaded ({exc})"
    if not hasattr(comfy.supported_models, "Krea2"):
        return "this ComfyUI has no Krea 2"
    return torch, comfy


CORE = load_core()
SKIP = CORE if isinstance(CORE, str) else None


def tiny_krea2(torch, comfy, seed=0):
    """A two-block Krea 2 with random weights, small enough to sample on a CPU."""
    torch.manual_seed(seed)
    config = comfy.supported_models.Krea2(dict(
        image_model="krea2", features=64, heads=4, kvheads=2, layers=2, txtdim=32,
        txtlayers=2, txtheads=2, txtkvheads=2, multiplier=2, default_ref_method="index"))
    config.set_inference_dtype(torch.float32, None)
    model = config.get_model({})
    for parameter in model.parameters():
        torch.nn.init.normal_(parameter, std=0.2)
    cpu = torch.device("cpu")
    return model, comfy.model_patcher.ModelPatcher(model, cpu, cpu)


class StubClip:
    """Just what LoRA Loader hands its curve rows to: a CLIP that puts hooks on its prompts."""

    def __init__(self, hooks=None):
        self.apply_hooks_to_conds = hooks
        self.patched = []
        import torch

        self.cond_stage_model = torch.nn.Module()

    def clone(self):
        return StubClip(self.apply_hooks_to_conds)

    def add_patches(self, patches, strength):
        self.patched.append((len(patches), strength))
        return []


@unittest.skipIf(SKIP, SKIP or "")
class CoreHookTests(unittest.TestCase):
    def setUp(self):
        self.torch, self.comfy = CORE
        self.model, self.patcher = tiny_krea2(self.torch, self.comfy)
        self.layer = self.model.diffusion_model.blocks[0].attn.wq
        self.base = self.layer.weight.detach().clone()
        gen = self.torch.Generator().manual_seed(3)
        self.up = self.torch.randn(64, 2, generator=gen)
        self.down = self.torch.randn(2, 64, generator=gen)
        self.lora = {"diffusion_model.blocks.0.attn.wq.lora_up.weight": self.up,
                     "diffusion_model.blocks.0.attn.wq.lora_down.weight": self.down}
        self.context = self.torch.randn(1, 6, 64, generator=gen)
        self.noise = self.torch.randn(1, 16, 8, 8, generator=gen)

    def sample(self, model, positive, negative, steps=4, cfg=2.0):
        return self.comfy.sample.sample(model, self.noise, steps, cfg, "euler", "simple", positive, negative,
                                        self.torch.zeros(1, 16, 8, 8), disable_pbar=True, seed=1)

    def lora_strength_per_step(self, model, hooks=None):
        """The LoRA's strength in the layer's output at every model call, as a multiple of the full change.

        Curve rows reach the model in core's bypass mode, so the change shows in
        what the layer returns, not in its weight.
        """
        delta = self.up @ self.down
        seen = []

        def measure(module, args, output):
            x = args[0]
            plain = self.torch.nn.functional.linear(x, self.base, module.bias)
            change = self.torch.nn.functional.linear(x, delta)
            seen.append(round(float(((output - plain) * change).sum() / (change * change).sum()), 4))

        handle = self.layer.register_forward_hook(measure)
        try:
            cond = {"hooks": hooks} if hooks is not None else {}
            self.sample(model, [[self.context, dict(cond)]], [[self.context, dict(cond)]])
        finally:
            handle.remove()
        return seen

    def stack(self, rows, curve, clip=None):
        from nodes import _lora_helpers as lora

        with patch.object(lora, "resolve_lora_path", lambda name: Path(name)), \
             patch.object(lora, "_load_lora_file", lambda path: self.lora):
            return lora.apply_lora_stack(self.patcher, clip, rows, curve=curve)

    def test_core_keyframes_follow_the_schedule_step_by_step(self):
        from nodes._curve_helpers import hook_keyframes

        keyframes = hook_keyframes(build_schedule(FADE_OUT))
        keyframes.initialize_timesteps(self.model)
        sigmas = self.comfy.samplers.calculate_sigmas(self.model.model_sampling, "simple", 4)
        options = {"sample_sigmas": sigmas}
        seen = []
        for sigma in sigmas[:-1]:
            keyframes.prepare_current_keyframe(float(sigma), options)
            seen.append(keyframes.strength)
        # Core picks the last keyframe a step has reached, so a step that lands
        # on a keyframe's edge can read the next one: within one sample (0.01).
        for got, want in zip(seen, [1.0, 0.75, 0.5, 0.25], strict=True):
            self.assertAlmostEqual(got, want, delta=0.0101)

    def test_the_lora_curve_reads_the_run_the_way_core_keyframes_do(self):
        from nodes._curve_helpers import hook_keyframes, noise_plan, strength_at_noise

        for points in (FADE_OUT, "[[0, 1], [0.25, 0.92], [0.75, 0.08], [1, 0]]", "[[0, 0], [0.5, 1], [1, 0.2]]"):
            for steps in (4, 8, 13):
                schedule = build_schedule(points)
                keyframes = hook_keyframes(schedule)
                keyframes.initialize_timesteps(self.model)
                starts = noise_plan(keyframe_plan(schedule), self.model.model_sampling.percent_to_sigma)
                sigmas = self.comfy.samplers.calculate_sigmas(self.model.model_sampling, "simple", steps)
                options = {"sample_sigmas": sigmas}
                for index, sigma in enumerate(sigmas[:-1]):
                    keyframes.prepare_current_keyframe(float(sigma), options)
                    self.assertEqual(strength_at_noise(starts, float(sigma), first=index == 0), keyframes.strength,
                                     f"{points}, {steps} steps, step {index}")

    def test_a_curve_row_moves_with_the_step_and_leaves_the_weights_as_they_were(self):
        rows = parse_lora_stack(json.dumps([{"id": "a", "name": "a.safetensors", "strength": 0.8,
                                             "strength_clip": 0, "curve": True}]))
        model, _ = self.stack(rows, build_schedule(FADE_OUT))
        self.assertEqual(self.lora_strength_per_step(model), [0.8, 0.6, 0.4, 0.2])
        self.assertTrue(self.torch.equal(self.layer.weight, self.base))
        self.assertEqual(self.lora_strength_per_step(self.patcher), [0.0] * 4, "the model it came from is untouched")

    def test_the_curve_needs_no_clip_and_works_with_prompts_from_any_clip(self):
        rows = parse_lora_stack(json.dumps([{"id": "a", "name": "a.safetensors", "strength": 1.0,
                                             "strength_clip": 1.0, "curve": True}]))
        model, clip = self.stack(rows, build_schedule(FADE_OUT), clip=None)
        self.assertIsNone(clip)
        self.assertEqual(self.lora_strength_per_step(model), [1.0, 0.75, 0.5, 0.25])

    def test_the_stack_follows_marked_rows_and_patches_the_rest_as_before(self):
        rows = parse_lora_stack(json.dumps([{"id": "a", "name": "a.safetensors", "strength": 0.5,
                                             "strength_clip": 0, "curve": True}]))
        model, clip = self.stack(rows, build_schedule(FADE_OUT), clip=StubClip())
        self.assertIsNone(clip.apply_hooks_to_conds, "nothing rides on the prompts")
        self.assertEqual(self.lora_strength_per_step(model), [0.5, 0.375, 0.25, 0.125])
        flat_model, _ = self.stack(rows, build_schedule("[[0, 1], [1, 1]]", high=0.5), clip=StubClip())
        self.assertEqual(self.lora_strength_per_step(flat_model), [0.25] * 4)
        unmarked = parse_lora_stack(json.dumps([{"id": "a", "name": "a.safetensors", "strength": 0.5,
                                                 "strength_clip": 0}]))
        steady, _ = self.stack(unmarked, build_schedule(FADE_OUT), clip=StubClip())
        self.assertEqual(self.lora_strength_per_step(steady), [0.5] * 4, "an unmarked row stays steady")

    def test_a_lora_that_matches_nothing_is_reported(self):
        from nodes import _lora_helpers as lora

        rows = parse_lora_stack(json.dumps([{"id": "a", "name": "a.safetensors", "strength": 0.5,
                                             "strength_clip": 0, "curve": True}]))
        warned = []
        with patch.object(lora, "resolve_lora_path", lambda name: Path(name)), \
             patch.object(lora, "_load_lora_file", lambda path: {"nothing.lora_up.weight": self.up,
                                                                 "nothing.lora_down.weight": self.down}), \
             patch.object(lora, "read_safetensors_metadata", lambda path: {}), \
             patch.object(lora, "_warn_no_effect", lambda name, family: warned.append(name)):
            lora.apply_lora_stack(self.patcher, StubClip(), rows, curve=build_schedule(FADE_OUT))
        self.assertEqual(warned, ["a.safetensors"])


if __name__ == "__main__":
    unittest.main()
