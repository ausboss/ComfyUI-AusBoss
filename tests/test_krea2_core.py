"""CPU probes for reference attention, without importing model runtime code."""
from __future__ import annotations

import ast
import hashlib
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

import torch
from einops import rearrange

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
tree = ast.parse((ROOT / "nodes/_krea2_core.py").read_text())
core = types.ModuleType("nodes._krea2_core")
core.__dict__.update(torch=torch, F=torch.nn.functional, rearrange=rearrange, hashlib=hashlib)
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef)], type_ignores=[]),
             "reference helpers", "exec"), core.__dict__)


class CacheTests(unittest.TestCase):
    def setUp(self):
        class StubModel:
            def __init__(self):
                self.model = types.SimpleNamespace(extra_conds=lambda **kw: {}, extra_conds_shapes=lambda **kw: {})
                self.dit = types.SimpleNamespace(forward=lambda *a, **kw: "original")
                self.patches, self.callbacks = {}, {}

            def clone(self): return StubModel()
            def get_model_object(self, name): return self.dit
            def add_object_patch(self, name, value): self.patches[name] = value
            def add_callback(self, name, value): self.callbacks[name] = value

        comfy = types.ModuleType("comfy")
        comfy.conds = types.ModuleType("comfy.conds")
        comfy.patcher_extension = types.ModuleType("comfy.patcher_extension")
        comfy.patcher_extension.CallbacksMP = types.SimpleNamespace(ON_PRE_RUN="pre", ON_CLEANUP="cleanup")
        self.modules = patch.dict(sys.modules, {"comfy": comfy, "comfy.conds": comfy.conds,
            "comfy.patcher_extension": comfy.patcher_extension, "nodes._krea2_core": core})
        self.modules.start()
        from nodes.node_krea2_model_patch import AusBossKrea2OutpaintModelPatch
        import nodes
        self.package = patch.object(nodes, "_krea2_core", core, create=True)
        self.package.start()
        self.calls = []

        def precompute(dit, x, t, refs, opts, **kw):
            result = object()
            self.calls.append(result)
            return result

        self.precompute = patch.object(core, "_precompute_ref_kv", precompute)
        self.compute = patch.object(core, "_forward_with_cached_refs", lambda dit, x, t, c, kv, opts: kv)
        self.precompute.start()
        self.compute.start()
        self.model = AusBossKrea2OutpaintModelPatch().patch(StubModel(), None)[0]
        self.ref = torch.arange(64, dtype=torch.float32).reshape(1, 16, 2, 2)

    def tearDown(self):
        self.compute.stop()
        self.precompute.stop()
        self.package.stop()
        self.modules.stop()

    def run_forward(self, size=4, ref=None):
        return self.model.patches["diffusion_model.forward"](
            torch.zeros(1, 16, size, size), torch.ones(1), None,
            ref_latents=[self.ref if ref is None else ref])

    def test_same_reference_and_canvas_reuse_the_cache(self):
        self.assertIs(self.run_forward(), self.run_forward())
        self.assertEqual(len(self.calls), 1)

    def test_canvas_size_changes_invalidate_the_cache_at_the_same_sigma(self):
        self.assertIsNot(self.run_forward(), self.run_forward(size=8))

    def test_reordered_reference_pixels_do_not_collide(self):
        self.assertIsNot(self.run_forward(), self.run_forward(ref=self.ref.flip(-1)))

    def test_in_place_reference_changes_invalidate_the_cache(self):
        before = self.run_forward()
        self.ref.copy_(self.ref.flip(-1))
        self.assertIsNot(before, self.run_forward())

    def test_inference_reference_changes_invalidate_the_cache(self):
        with torch.inference_mode():
            ref = self.ref.clone()
            before = self.run_forward(ref=ref)
            ref.copy_(ref.flip(-1))
            self.assertIsNot(before, self.run_forward(ref=ref))

    def test_sampler_boundaries_clear_the_cache_even_at_the_same_sigma(self):
        for boundary in ("pre", "cleanup"):
            before = self.run_forward()
            self.assertIn(boundary, self.model.callbacks)
            self.model.callbacks[boundary](self.model)
            self.assertIsNot(before, self.run_forward())


class AttentionTests(unittest.TestCase):
    def test_attention_patches_run_in_order_and_keep_their_metadata(self):
        seen = []
        options = {"block_index": 2, "block_type": "single", "total_blocks": 3, "img_slice": [1, 2]}

        def input_patch(q, k, v, pe, attn_mask, extra_options):
            seen.append(("input", extra_options.copy()))
            return {"q": q + 2, "v": v + 3, "pe": "rotary", "attn_mask": "mask"}

        def rope(q, k, freqs):
            self.assertEqual(freqs, "rotary")
            return q + 4, k

        def attention(q, k, v, heads, **kwargs):
            seen.append(("attention", kwargs["mask"]))
            self.assertTrue(torch.equal(q, torch.full_like(q, 7)))
            self.assertEqual(k.shape[2], 3)
            self.assertTrue(torch.equal(v[:, :, :2], torch.full_like(v[:, :, :2], 4)))
            return torch.zeros(1, 2, 3)

        def output_patch(out, extra_options):
            seen.append(("output", extra_options.copy()))
            return out + 10

        options["patches"] = {"attn1_patch": [input_patch], "attn1_output_patch": [output_patch]}
        attn = types.SimpleNamespace(wq=lambda x: x, wk=lambda x: x, wv=lambda x: x,
            gate=torch.zeros_like, qknorm=lambda q, k: (q, k), heads=1, kvheads=1, wo=lambda x: x)
        with patch.dict(core.__dict__, optimized_attention_masked=attention, apply_rope=rope):
            out = core._attn_kv(attn, torch.ones(1, 2, 3), None,
                kv_cache=(torch.zeros(1, 1, 1, 3), torch.zeros(1, 1, 1, 3)), transformer_options=options)
        self.assertEqual([item[0] for item in seen], ["input", "attention", "output"])
        self.assertEqual(seen[0][1], options)
        self.assertEqual(seen[2][1], options)
        self.assertTrue(torch.equal(out, torch.full_like(out, 5)))


if __name__ == "__main__":
    unittest.main()
