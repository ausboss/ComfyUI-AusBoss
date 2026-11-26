"""Krea 2 reference strength over the run.

The maths runs on small tensors with no ComfyUI. `CoreSmokeTests` samples a
tiny random Krea 2 on the CPU through core's hooks, with and without Krea 2
Outpaint Model Patch 🆎, and skips without

    AUSBOSS_COMFY_ROOT=<ComfyUI> python tests/test_reference_strength.py

A real render with Krea 2's weights needs a GPU and is not covered here.
"""

from __future__ import annotations

import os
from pathlib import Path
import sys
import types
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
COMFY_ROOT = os.environ.get("AUSBOSS_COMFY_ROOT")
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._curve_helpers import build_schedule  # noqa: E402
from nodes._krea2_helpers import (  # noqa: E402
    ReferenceStrength,
    combine_attention_mask,
    reference_key_bias,
)

FADE_OUT = "[[0, 1], [1, 0]]"


def attend(q, k, v, mask=None):
    return torch.nn.functional.scaled_dot_product_attention(q, k, v, attn_mask=mask)


class BiasMathsTests(unittest.TestCase):
    def setUp(self):
        gen = torch.Generator().manual_seed(0)
        self.q = torch.randn(2, 3, 7, 8, generator=gen)
        self.k = torch.randn(2, 3, 12, 8, generator=gen)
        self.v = torch.randn(2, 3, 12, 8, generator=gen)
        self.refs = 5

    def test_strength_multiplies_the_reference_weights_before_renormalising(self):
        scores = (self.q @ self.k.transpose(-1, -2)) / 8 ** 0.5
        weights = scores.exp()
        for strength in (0.25, 0.5, 2.0, 3.5):
            scaled = weights.clone()
            scaled[..., -self.refs:] *= strength
            expected = (scaled / scaled.sum(-1, keepdim=True)) @ self.v
            bias = reference_key_bias(12, self.refs, strength, torch.float32, torch.device("cpu"))
            self.assertEqual(tuple(bias.shape), (1, 1, 1, 12))
            torch.testing.assert_close(attend(self.q, self.k, self.v, bias), expected, rtol=1e-5, atol=1e-5)

    def test_zero_strength_is_attention_without_the_reference(self):
        bias = reference_key_bias(12, self.refs, 0.0, torch.float32, torch.device("cpu"))
        torch.testing.assert_close(attend(self.q, self.k, self.v, bias),
                                   attend(self.q, self.k[..., :-self.refs, :], self.v[..., :-self.refs, :]))

    def test_full_strength_or_no_reference_changes_nothing(self):
        self.assertIsNone(reference_key_bias(12, self.refs, 1.0, torch.float32, torch.device("cpu")))
        self.assertIsNone(reference_key_bias(12, 0, 0.5, torch.float32, torch.device("cpu")))

    def test_negative_strength_counts_as_off(self):
        torch.testing.assert_close(reference_key_bias(12, 3, -2.0, torch.float32, torch.device("cpu")),
                                   reference_key_bias(12, 3, 0.0, torch.float32, torch.device("cpu")))

    def test_the_bias_joins_a_mask_that_was_already_there(self):
        bias = reference_key_bias(12, self.refs, 0.5, torch.float32, torch.device("cpu"))
        additive = torch.randn(2, 1, 7, 12)
        torch.testing.assert_close(combine_attention_mask(additive, bias), additive + bias)
        keep = torch.ones(1, 1, 7, 12, dtype=torch.bool)
        keep[..., 0] = False
        joined = combine_attention_mask(keep, bias)
        self.assertEqual(joined.dtype, torch.float32)
        self.assertTrue((joined[..., 0] < -1e30).all())
        torch.testing.assert_close(joined[..., 1:], bias.expand(1, 1, 7, 12)[..., 1:])
        self.assertIs(combine_attention_mask(keep, None), keep)

    def test_the_patch_reads_the_current_keyframe_and_finds_the_reference_tokens(self):
        keyframes = types.SimpleNamespace(strength=0.5)
        patch = ReferenceStrength(keyframes)
        out = patch(self.q, self.k, self.v, extra_options={"reference_image_num_tokens": [2, 3]})
        torch.testing.assert_close(out["attn_mask"], reference_key_bias(12, 5, 0.5, torch.float32, torch.device("cpu")))
        keyframes.strength = 1.0
        self.assertEqual(patch(self.q, self.k, self.v, extra_options={"reference_image_num_tokens": [5]}), {})
        keyframes.strength = 0.5
        self.assertEqual(patch(self.q, self.k, self.v, extra_options={}), {})


def load_core():
    if not COMFY_ROOT:
        return "set AUSBOSS_COMFY_ROOT to a ComfyUI checkout"
    os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
    sys.path.append(COMFY_ROOT)
    sys.argv = sys.argv[:1]
    try:
        import comfy.cli_args

        comfy.cli_args.args.cpu = True
        import comfy.hooks
        import comfy.model_patcher
        import comfy.sample
        import comfy.supported_models
    except ImportError as exc:
        return f"this ComfyUI cannot be loaded ({exc})"
    if not hasattr(comfy.supported_models, "Krea2"):
        return "this ComfyUI has no Krea 2"
    return comfy


CORE = load_core()
SKIP = CORE if isinstance(CORE, str) else None


@unittest.skipIf(SKIP, SKIP or "")
class CoreSmokeTests(unittest.TestCase):
    def setUp(self):
        comfy = CORE
        self.comfy = comfy
        torch.manual_seed(0)
        config = comfy.supported_models.Krea2(dict(
            image_model="krea2", features=64, heads=4, kvheads=2, layers=2, txtdim=32,
            txtlayers=2, txtheads=2, txtkvheads=2, multiplier=2, default_ref_method="index"))
        config.set_inference_dtype(torch.float32, None)
        self.model = config.get_model({})
        for parameter in self.model.parameters():
            torch.nn.init.normal_(parameter, std=0.2)
        cpu = torch.device("cpu")
        self.patcher = comfy.model_patcher.ModelPatcher(self.model, cpu, cpu)
        gen = torch.Generator().manual_seed(1)
        self.context = torch.randn(1, 6, 64, generator=gen)
        self.reference = torch.randn(1, 16, 8, 8, generator=gen)
        self.noise = torch.randn(1, 16, 8, 8, generator=gen)

    def sample(self, model=None, curve=None, reference=True):
        from nodes._krea2_helpers import reference_strength_hooks

        positive = [[self.context, {"reference_latents": [self.reference]} if reference else {}]]
        if curve is not None:
            positive = self.comfy.hooks.set_hooks_for_conditioning(
                positive, reference_strength_hooks(build_schedule(curve)), append_hooks=True)
        return self.comfy.sample.sample(model or self.patcher, self.noise, 4, 1.0, "euler", "simple",
                                        positive, [[self.context, {}]], torch.zeros(1, 16, 8, 8),
                                        disable_pbar=True, seed=1)

    def test_the_patch_runs_in_every_block_and_moves_with_the_step(self):
        seen = []
        original = ReferenceStrength.__call__

        def spy(patch, q, k, v, pe=None, attn_mask=None, extra_options=None):
            out = original(patch, q, k, v, pe=pe, attn_mask=attn_mask, extra_options=extra_options)
            seen.append((float(extra_options["sigmas"].max()), extra_options["block_index"], patch.strength,
                         tuple(out["attn_mask"].shape) if out else None, k.shape[-2]))
            return out

        ReferenceStrength.__call__ = spy
        try:
            self.sample(curve=FADE_OUT)
        finally:
            ReferenceStrength.__call__ = original
        self.assertEqual([entry[1] for entry in seen], [0, 1] * 4)
        strengths = [entry[2] for entry in seen[::2]]
        self.assertEqual(strengths, sorted(strengths, reverse=True))
        for got, want in zip(strengths, [1.0, 0.75, 0.5, 0.25], strict=True):
            self.assertAlmostEqual(got, want, delta=0.0101)
        sigmas = [entry[0] for entry in seen[::2]]
        self.assertEqual(sigmas, sorted(sigmas, reverse=True))
        # 6 prompt + 16 canvas + 16 reference tokens; no mask at full strength.
        self.assertIsNone(seen[0][3])
        self.assertEqual(seen[2][3:], ((1, 1, 1, 38), 38))

    def test_full_strength_is_today_and_zero_is_no_reference(self):
        today = self.sample()
        self.assertTrue(torch.equal(self.sample(curve="[[0, 1], [1, 1]]"), today))
        without = self.sample(reference=False)
        self.assertFalse(torch.allclose(today, without))
        torch.testing.assert_close(self.sample(curve="[[0, 0], [1, 0]]"), without)
        faded = self.sample(curve=FADE_OUT)
        self.assertFalse(torch.allclose(faded, today))
        self.assertFalse(torch.allclose(faded, without))

    def test_the_outpaint_patch_scales_its_cached_reference_too(self):
        from nodes.node_krea2_model_patch import AusBossKrea2OutpaintModelPatch

        placed = AusBossKrea2OutpaintModelPatch().patch(self.patcher, None, kv_cache=True, placement="whole canvas")[0]
        today = self.sample(placed)
        self.assertTrue(torch.equal(self.sample(placed, curve="[[0, 1], [1, 1]]"), today))
        without = self.sample(placed, reference=False)
        self.assertFalse(torch.allclose(today, without))
        torch.testing.assert_close(self.sample(placed, curve="[[0, 0], [1, 0]]"), without, rtol=1e-4, atol=1e-4)
        self.assertFalse(torch.allclose(self.sample(placed, curve=FADE_OUT), today))


if __name__ == "__main__":
    unittest.main()
