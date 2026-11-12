from __future__ import annotations

from pathlib import Path
import importlib.util
import math
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
# Loaded by path: the model code is plain PyTorch and needs nothing the pack imports.
_spec = importlib.util.spec_from_file_location("ausboss_flashvsr_helpers", ROOT / "nodes" / "_flashvsr_helpers.py")
vsr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vsr)


def tiny_model(seed: int = 0):
    torch.manual_seed(seed)
    model = vsr.FlashVSRModel(
        dim=24,
        heads=2,
        ffn_dim=48,
        layers=2,
        text_dim=8,
        text_len=4,
        freq_dim=16,
        projector_hidden=(8, 12),
        decoder_widths=(8, 8, 4, 4),
    )
    for parameter in model.parameters():
        torch.nn.init.normal_(parameter, std=0.2)
    model.positive_conditioning.normal_()
    return model.eval()


class SizeTests(unittest.TestCase):
    def test_output_is_even_and_the_working_size_is_a_multiple_of_128(self):
        self.assertEqual(vsr.plan_sizes(360, 640, 2.0), (720, 1280, 768, 1280))
        self.assertEqual(vsr.plan_sizes(271, 479, 1.5), (406, 718, 512, 768))
        self.assertEqual(vsr.plan_sizes(64, 64, 2.0), (128, 128, 128, 128))

    def test_the_padded_clip_always_covers_every_frame(self):
        for count in (1, 5, 21, 22, 29, 30, 81, 200):
            groups = vsr.plan_groups(count)
            self.assertGreaterEqual(groups, 3)
            self.assertGreaterEqual(8 * groups - 3, count)
            latents = sum(n for _, n in vsr.pass_layout(groups))
            self.assertEqual(latents, 2 * groups)

    def test_passes_follow_one_another_without_a_gap(self):
        expected = 0
        for first, count in vsr.pass_layout(6):
            self.assertEqual(first, expected)
            expected += count


class BlockTests(unittest.TestCase):
    def test_blocks_round_trip(self):
        x = torch.randn(4 * 16 * 24, 6)
        back = vsr.from_blocks(vsr.to_blocks(x, 4, 16, 24), 4, 16, 24)
        self.assertTrue(torch.equal(x, back))

    def test_a_block_holds_two_frames_of_an_8_by_8_patch(self):
        frames, rows, cols = 2, 16, 16
        t, r, c = torch.meshgrid(torch.arange(frames), torch.arange(rows), torch.arange(cols), indexing="ij")
        ids = torch.stack([t, r // 8, c // 8], dim=-1).reshape(-1, 3).float()
        blocks = vsr.to_blocks(ids, frames, rows, cols)
        self.assertEqual(blocks.shape, (4, 128, 3))
        for block in blocks:
            self.assertEqual(block[:, 1:].unique(dim=0).shape[0], 1)
            self.assertEqual(sorted(block[:, 0].unique().tolist()), [0.0, 1.0])

    def test_the_neighbourhood_is_centred_and_cut_at_the_edges(self):
        mask = vsr.local_block_mask(3, 20, 11, "cpu")
        row = mask[20 + 10].view(3, 20)  # the block at row 1, column 10
        self.assertTrue(row[:, 5:16].all())
        self.assertFalse(row[:, :5].any() or row[:, 16:].any())
        self.assertEqual(int(mask[0].sum()), 3 * 6)  # the corner block: all 3 rows, columns 0-5

    def test_selection_keeps_the_asked_number_inside_the_neighbourhood(self):
        torch.manual_seed(1)
        heads, per_group = 2, 6
        local = vsr.local_block_mask(2, 3, 3, "cpu")
        q = torch.randn(2 * per_group, 128, 8)
        k = torch.randn(3 * per_group, 128, 8)
        chosen, shares = vsr.choose_key_blocks(q, k, heads, local, 2, keep=20)
        self.assertTrue((shares[chosen] > 0).all())
        self.assertTrue((shares[:, ~local.repeat(2, 3)] == 0).all())
        self.assertEqual(chosen.shape, (heads, 12, 18))
        self.assertTrue((chosen.view(heads, 2, -1).sum(-1) == 20).all())
        self.assertFalse((chosen & ~local.repeat(2, 3)).any())


class SparseAttentionTests(unittest.TestCase):
    def dense(self, q, k, v, chosen):
        heads, nq, tokens, dim = q.shape
        nk = k.shape[1]
        scores = torch.einsum("hqtd,hksd->hqtks", q, k) / math.sqrt(dim)
        scores = scores.masked_fill(~chosen[:, :, None, :, None], float("-inf"))
        weights = scores.reshape(heads, nq, tokens, nk * tokens).softmax(-1).nan_to_num(0.0)
        return weights @ v.reshape(heads, 1, nk * tokens, dim)

    def test_it_matches_plain_masked_attention(self):
        torch.manual_seed(2)
        q, k, v = torch.randn(3, 7, 128, 4), torch.randn(3, 11, 128, 4), torch.randn(3, 11, 128, 4)
        chosen = torch.rand(3, 7, 11) < 0.4
        chosen[0, 0] = False  # a row that chose nothing
        chosen[1, 2] = True  # a row that chose everything
        want = self.dense(q, k, v, chosen)
        for budget in (1, 8, 40, 100000):
            got = vsr.sparse_block_attention(q, k, v, chosen, slot_budget=budget)
            self.assertTrue(torch.allclose(got, want, atol=1e-5), budget)
        self.assertTrue((got[0, 0] == 0).all())

    def test_with_shares_a_row_is_filled_up_from_its_neighbourhood_and_never_reads_less(self):
        torch.manual_seed(4)
        q, k, v = torch.randn(2, 6, 128, 4), torch.randn(2, 9, 128, 4), torch.randn(2, 9, 128, 4)
        allowed = torch.rand(2, 6, 9) < 0.8
        allowed[..., 0] = True
        shares = torch.rand(2, 6, 9) * allowed
        chosen = (shares > 0.5) & allowed
        chosen[..., 0] = True  # every row chose something
        chosen[1, 3] = allowed[1, 3]  # the widest row: everything it may read
        widest = int(chosen.sum(-1).max())
        # one call at the widest row's width: each row reads its chosen blocks, then its best other ones
        rank = chosen.float() * 2 + shares
        top = torch.zeros_like(chosen).scatter(-1, rank.argsort(-1, descending=True)[..., :widest], True)
        want = self.dense(q, k, v, top & allowed)
        got = vsr.sparse_block_attention(q, k, v, chosen, shares, slot_budget=100000)
        self.assertTrue(torch.allclose(got, want, atol=1e-5))
        self.assertTrue(((top & allowed) | ~chosen).all())


class DecoderTests(unittest.TestCase):
    def test_frames_one_at_a_time_match_all_at_once(self):
        decoder = tiny_model().tc_decoder.double()  # double precision: random weights make large numbers
        x = torch.randn(5, 16 + 768, 4, 6, dtype=torch.float64)
        with torch.no_grad():
            whole = decoder.decode({}, x)
            memory = {}
            parts = torch.cat([decoder.decode(memory, x[i : i + 1]) for i in range(5)])
        self.assertEqual(whole.shape, (5 * 4 - 3, 3, 32, 48))
        self.assertTrue(torch.allclose(whole, parts, rtol=1e-9, atol=1e-9))


class ProjectorTests(unittest.TestCase):
    def test_one_set_of_tokens_per_four_frames(self):
        model = tiny_model()
        memory = {}
        clip = torch.rand(1, 3, 9, 32, 48) * 2 - 1
        with torch.no_grad():
            self.assertIsNone(model.lq_proj_in.push(memory, clip[:, :, :1]))
            first = model.lq_proj_in.push(memory, clip[:, :, 1:5])
            second = model.lq_proj_in.push(memory, clip[:, :, 5:9])
        self.assertEqual(first.shape, (1, 2 * 3, 24))
        self.assertEqual(second.shape, first.shape)
        self.assertFalse(torch.allclose(first, second))


class WholeClipTests(unittest.TestCase):
    def run_clip(self, count, height, width, scale, **kw):
        torch.manual_seed(3)
        frames = torch.rand(count, height, width, 3)
        return vsr.upscale_frames(tiny_model(), frames, scale, device="cpu", dtype=torch.float32, **kw), frames

    def test_every_frame_comes_back_at_the_new_size(self):
        for count, height, width, scale in ((1, 64, 64, 2.0), (23, 50, 90, 2.0), (30, 128, 128, 1.0)):
            out, _ = self.run_clip(count, height, width, scale)
            self.assertEqual(out.shape, (count, vsr._even(height * scale), vsr._even(width * scale), 3))
            self.assertTrue(torch.isfinite(out).all())
            self.assertTrue(0.0 <= float(out.min()) and float(out.max()) <= 1.0)

    def test_the_same_seed_gives_the_same_clip(self):
        a, _ = self.run_clip(9, 64, 64, 2.0, seed=5)
        b, _ = self.run_clip(9, 64, 64, 2.0, seed=5)
        c, _ = self.run_clip(9, 64, 64, 2.0, seed=6)
        self.assertTrue(torch.equal(a, b))
        self.assertFalse(torch.equal(a, c))

    def test_colour_match_brings_the_means_back_to_the_source(self):
        out, frames = self.run_clip(5, 64, 64, 2.0, color_match=True)
        self.assertLess(float((out.mean(dim=(1, 2)) - frames.mean(dim=(1, 2))).abs().max()), 0.05)

    def test_another_decoder_gets_every_latent_frame(self):
        seen = {}

        def decode(latents):
            seen["shape"] = tuple(latents.shape)
            frames = 4 * (latents.shape[2] - 1) + 1
            return torch.full((frames, latents.shape[3] * 8, latents.shape[4] * 8, 3), 0.5)

        out, _ = self.run_clip(23, 64, 64, 2.0, decode_latents=decode, color_match=False)
        self.assertEqual(seen["shape"], (1, 16, 8, 16, 16))
        self.assertEqual(out.shape, (23, 128, 128, 3))
        self.assertTrue(torch.allclose(out, torch.full_like(out, 0.5)))

    def test_a_large_picture_is_done_in_tiles_that_cover_it(self):
        self.assertEqual(vsr.plan_tiles(1152, 2048, None), [(0, 0, 1152, 2048)])
        self.assertEqual(vsr.plan_tiles(640, 1024, 640 * 1024), [(0, 0, 640, 1024)])
        for work_h, work_w, limit in ((1152, 2048, 1_300_000), (2176, 3840, 2_000_000), (768, 768, 100_000), (128, 1280, 50_000)):
            tiles = vsr.plan_tiles(work_h, work_w, limit)
            self.assertGreater(len(tiles), 1)
            cover = torch.zeros(work_h, work_w)
            for top, left, height, width in tiles:
                self.assertEqual((height % 128, width % 128, top % 16, left % 16), (0, 0, 0, 0))
                self.assertTrue(top + height <= work_h and left + width <= work_w)
                self.assertLessEqual(height * width, max(limit, 128 * 128))
                cover[top : top + height, left : left + width] += vsr.tile_weight((top, left, height, width), work_h, work_w)
            self.assertGreater(float(cover.min()), 0.5)

    def test_tiles_give_every_frame_at_the_same_size(self):
        whole, _ = self.run_clip(9, 128, 192, 2.0)
        tiled, _ = self.run_clip(9, 128, 192, 2.0, max_tile_pixels=256 * 256)
        self.assertEqual(tiled.shape, whole.shape)
        self.assertTrue(torch.isfinite(tiled).all())
        self.assertTrue(0.0 <= float(tiled.min()) and float(tiled.max()) <= 1.0)

    def test_progress_counts_the_passes(self):
        calls = []
        self.run_clip(40, 64, 64, 2.0, on_pass=lambda done, total: calls.append((done, total)))
        self.assertEqual(calls, [(1, 4), (2, 4), (3, 4), (4, 4)])


if __name__ == "__main__":
    unittest.main()
