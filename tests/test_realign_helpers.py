"""Realign to Source: planted zooms and shifts must be measured and undone."""

from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

import torch
import torch.nn.functional as F

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._realign_helpers import (  # noqa: E402
    describe,
    measure,
    phase_correlate,
    warp_to_source,
)
from nodes.node_realign_to_source import (  # noqa: E402
    NODE_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS,
)

KEY = "AUSBOSS_NODES_RealignToSource"


def scene(height: int, width: int, seed: int = 0) -> torch.Tensor:
    """A made-up picture with edges everywhere: boxes, discs and thin posts."""
    gen = torch.Generator().manual_seed(seed)
    yy, xx = torch.meshgrid(torch.arange(height).float(), torch.arange(width).float(), indexing="ij")
    tint = torch.rand(3, generator=gen)
    fx, fy, phase = (30 + 30 * torch.rand(3, generator=gen)).tolist()
    image = (0.3 + 0.15 * torch.sin(xx / fx + phase)[..., None] * tint
             + 0.1 * torch.cos(yy / fy - phase)[..., None])
    image = image.expand(height, width, 3).clone()
    for _ in range(90):
        kind = int(torch.randint(0, 3, (1,), generator=gen))
        colour = torch.rand(3, generator=gen)
        cx = float(torch.rand(1, generator=gen)) * width
        cy = float(torch.rand(1, generator=gen)) * height
        size = 8 + float(torch.rand(1, generator=gen)) * min(height, width) / 7
        if kind == 0:
            mask = ((xx - cx).abs() < size) & ((yy - cy).abs() < 0.6 * size)
        elif kind == 1:
            mask = (xx - cx) ** 2 + (yy - cy) ** 2 < size ** 2
        elif float(torch.rand(1, generator=gen)) < 0.5:
            mask = ((yy - cy).abs() < 2.0) & ((xx - cx).abs() < 3 * size)
        else:
            mask = ((xx - cx).abs() < 2.0) & ((yy - cy).abs() < 3 * size)
        image[mask] = colour
    return image.clamp(0.0, 1.0)


def drift(zoom_x=0.0, zoom_y=0.0, shift_x=0.0, shift_y=0.0, anchor=(0.5, 0.5),
          rotate_deg=0.0, size=(640, 800)) -> torch.Tensor:
    """Source px -> edit px, zooming about an anchor (fractions of the frame)."""
    width, height = size
    ax, ay = anchor[0] * (width - 1), anchor[1] * (height - 1)
    c, s = math.cos(math.radians(rotate_deg)), math.sin(math.radians(rotate_deg))
    linear = torch.tensor([[c, -s], [s, c]], dtype=torch.float64) @ torch.diag(
        torch.tensor([1 + zoom_x, 1 + zoom_y], dtype=torch.float64))
    anchor_t = torch.tensor([ax, ay], dtype=torch.float64)
    m = torch.eye(3, dtype=torch.float64)
    m[:2, :2] = linear
    m[:2, 2] = anchor_t - linear @ anchor_t + torch.tensor([shift_x, shift_y], dtype=torch.float64)
    return m


def make_edit(source: torch.Tensor, matrix: torch.Tensor, out_h: int | None = None,
              out_w: int | None = None) -> torch.Tensor:
    """What an edit model would hand back: content at q = M p, at any size."""
    height, width = source.shape[:2]
    out_h, out_w = out_h or height, out_w or width
    ys, xs = torch.meshgrid(torch.arange(out_h, dtype=torch.float64),
                            torch.arange(out_w, dtype=torch.float64), indexing="ij")
    qx = (xs + 0.5) * width / out_w - 0.5
    qy = (ys + 0.5) * height / out_h - 0.5
    inv = torch.linalg.inv(matrix)
    homo = torch.stack([qx, qy, torch.ones_like(qx)], dim=-1) @ inv.t()
    grid = torch.stack([2 * (homo[..., 0] + 0.5) / width - 1, 2 * (homo[..., 1] + 0.5) / height - 1],
                       dim=-1).float()[None]
    out = F.grid_sample(source.permute(2, 0, 1)[None], grid, mode="bilinear",
                        padding_mode="border", align_corners=False)
    return out[0].permute(1, 2, 0)


def restyle(image: torch.Tensor, seed: int = 3) -> torch.Tensor:
    """A crude repaint: swapped channels, posterised, softened, grainy."""
    gen = torch.Generator().manual_seed(seed)
    x = image[..., [2, 0, 1]]
    x = torch.round(x * 4.0) / 4.0
    x = F.avg_pool2d(x.permute(2, 0, 1)[None], 5, stride=1, padding=2, count_include_pad=False)[0].permute(1, 2, 0)
    return (0.75 * x + 0.12 + 0.04 * torch.randn(x.shape, generator=gen)).clamp(0.0, 1.0)


def corner_error(found: torch.Tensor, truth: torch.Tensor, width: int, height: int) -> float:
    worst = 0.0
    for x, y in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
        p = torch.tensor([x, y, 1.0], dtype=torch.float64)
        worst = max(worst, float(torch.linalg.norm((found.double() @ p - truth @ p)[:2])))
    return worst


class PhaseCorrelationTests(unittest.TestCase):
    def test_recovers_whole_and_sub_pixel_shifts(self):
        base = scene(160, 160, seed=5).mean(dim=-1)
        for dx, dy in ((3.0, -5.0), (0.25, 0.5), (-7.4, 2.6)):
            moved = make_edit(base[..., None].expand(-1, -1, 3), drift(shift_x=dx, shift_y=dy, size=(160, 160)))
            shift, peak = phase_correlate(base[None, 16:144, 16:144], moved.mean(dim=-1)[None, 16:144, 16:144])
            self.assertAlmostEqual(float(shift[0, 0]), dx, delta=0.2)
            self.assertAlmostEqual(float(shift[0, 1]), dy, delta=0.2)
            self.assertGreater(float(peak[0]), 0.3)


class MeasureTests(unittest.TestCase):
    width, height = 640, 800

    @classmethod
    def setUpClass(cls):
        cls.source = scene(cls.height, cls.width, seed=11)

    def check(self, truth, edit, mode="zoom + shift", tolerance=0.6):
        result = measure(self.source, edit, mode)
        self.assertTrue(result.reliable, result.reason)
        err = corner_error(result.matrix, truth, self.width, self.height)
        self.assertLess(err, tolerance, f"corner error {err:.2f} px")
        return result

    def test_an_unchanged_picture_measures_as_no_drift(self):
        result = self.check(torch.eye(3, dtype=torch.float64), self.source.clone(), tolerance=0.05)
        self.assertLess(abs(result.zoom_x) + abs(result.zoom_y), 0.001)
        self.assertLess(result.worst_corner, 0.2)

    def test_a_qwen_style_vertical_zoom_and_shift(self):
        truth = drift(zoom_x=0.004, zoom_y=0.041, shift_x=3.3, shift_y=6.0, anchor=(0.5, 0.35),
                      size=(self.width, self.height))
        result = self.check(truth, make_edit(self.source, truth), tolerance=0.1)
        self.assertAlmostEqual(result.zoom_y, 0.041, delta=0.0003)
        self.assertAlmostEqual(result.zoom_x, 0.004, delta=0.0003)

    def test_a_twelve_percent_zoom_is_still_in_range(self):
        truth = drift(zoom_y=0.12, zoom_x=0.02, anchor=(0.5, 0.2), size=(self.width, self.height))
        self.check(truth, make_edit(self.source, truth), tolerance=0.2)

    def test_a_restyled_edit_still_lines_up(self):
        truth = drift(zoom_x=0.006, zoom_y=0.05, shift_x=-4.0, shift_y=9.0, anchor=(0.4, 0.6),
                      size=(self.width, self.height))
        self.check(truth, restyle(make_edit(self.source, truth)), tolerance=0.5)

    def test_an_edit_at_another_resolution(self):
        truth = drift(zoom_y=0.03, shift_x=2.0, size=(self.width, self.height))
        edit = make_edit(self.source, truth, out_h=704, out_w=576)
        self.check(truth, edit, tolerance=0.2)

    def test_affine_follows_a_slight_rotation(self):
        truth = drift(rotate_deg=0.6, zoom_y=0.02, size=(self.width, self.height))
        self.check(truth, make_edit(self.source, truth), mode="affine", tolerance=0.3)

    def test_unrelated_pictures_are_not_trusted(self):
        other = scene(self.height, self.width, seed=99)
        result = measure(self.source, other)
        self.assertFalse(result.reliable)
        self.assertIn("agree", result.reason)

    def test_a_zoom_past_the_limit_is_not_trusted(self):
        truth = drift(zoom_x=0.08, zoom_y=0.08, size=(self.width, self.height))
        result = measure(self.source, make_edit(self.source, truth), max_zoom=0.05)
        self.assertFalse(result.reliable)
        self.assertIn("limit", result.reason)

    def test_a_tiny_picture_is_not_measured(self):
        result = measure(self.source, self.source[:48, :48])
        self.assertFalse(result.reliable)
        self.assertIn("too small", result.reason)


class WarpTests(unittest.TestCase):
    def test_the_warp_undoes_the_drift_and_marks_the_lost_strip(self):
        width, height = 480, 600
        source = scene(height, width, seed=21)
        truth = drift(zoom_y=0.06, shift_y=10.0, size=(width, height))
        edit = make_edit(source, truth)
        out, empty = warp_to_source(edit, truth, width, height, "gray")
        # The content the edit pushed out of view: rows whose q falls outside.
        ys = torch.arange(height, dtype=torch.float64)
        qy = truth[1, 1] * ys + truth[1, 2]
        lost_rows = ((qy < -0.5) | (qy > height - 0.5)).double().mean()
        self.assertAlmostEqual(float(empty.mean()), float(lost_rows), delta=0.01)
        keep = empty == 0
        inner = keep.clone()
        inner[:12] = False
        inner[-12:] = False
        diff = (out - source).abs().mean(dim=-1)[inner].mean()
        self.assertLess(float(diff), 0.03)
        self.assertTrue(torch.allclose(out[empty > 0], torch.full_like(out[empty > 0], 0.5)))

    def test_fills(self):
        width, height = 200, 240
        source = scene(height, width, seed=4)
        truth = drift(zoom_x=0.1, zoom_y=0.1, size=(width, height))
        edit = make_edit(source, truth)
        _, empty = warp_to_source(edit, truth, width, height, "edge")
        self.assertGreater(float(empty.mean()), 0.05)
        out, _ = warp_to_source(edit, truth, width, height, "source", source)
        self.assertTrue(torch.allclose(out[empty > 0], source[empty > 0]))
        with self.assertRaises(ValueError):
            warp_to_source(edit, truth, width, height, "source")
        with self.assertRaises(ValueError):
            warp_to_source(edit, truth, width, height, "black")

    def test_the_pixels_beside_the_strip_do_not_darken(self):
        # A flat picture zoomed in: whatever fills the strip, the content
        # right beside it keeps its colour instead of blending in black.
        width, height = 160, 200
        flat = torch.full((height, width, 3), 0.8)
        truth = drift(zoom_x=0.08, zoom_y=0.08, size=(width, height))
        for fill in ("edge", "gray", "source"):
            out, empty = warp_to_source(flat, truth, width, height, fill, flat)
            content = out[empty == 0]
            self.assertLess(float((content - 0.8).abs().max()), 1e-4, fill)

    def test_describe_says_what_happened(self):
        source = scene(400, 320, seed=8)
        truth = drift(zoom_y=0.04, size=(320, 400))
        result = measure(source, make_edit(source, truth))
        line = describe(result, 0.021, True)
        self.assertTrue(line.startswith("realigned: zoom x"))
        zoom_y = float(line.split("y ")[1].split("%")[0])
        self.assertAlmostEqual(zoom_y, 4.0, delta=0.15)
        self.assertIn("empty strip 2.1%", line)
        unrelated = measure(source, scene(400, 320, seed=77))
        self.assertTrue(describe(unrelated, 0.0, False).startswith("left as is:"))


class NodeTests(unittest.TestCase):
    def make_node(self):
        return NODE_CLASS_MAPPINGS[KEY]()

    def test_the_public_face(self):
        cls = NODE_CLASS_MAPPINGS[KEY]
        name = NODE_DISPLAY_NAME_MAPPINGS[KEY]
        self.assertEqual(name, "Realign to Source (EXPERIMENTAL 🧪) 🆎")
        self.assertEqual(cls.CATEGORY, "🆎 AusBoss/Image")
        self.assertIn("EXPERIMENTAL", cls.DESCRIPTION)
        self.assertIn("ausboss", cls.SEARCH_ALIASES)
        inputs = cls.INPUT_TYPES()
        self.assertEqual(list(inputs["required"]), ["edited", "source", "fit", "empty_fill", "max_zoom"])
        self.assertNotIn("optional", inputs)
        for spec in inputs["required"].values():
            self.assertTrue(spec[1].get("tooltip"))
        self.assertEqual(cls.RETURN_TYPES, ("IMAGE", "MASK", "STRING"))
        self.assertEqual(cls.RETURN_NAMES, ("image", "empty_mask", "report"))
        self.assertEqual(len(cls.OUTPUT_TOOLTIPS), 3)

    def test_a_batch_of_rgba_edits_against_one_source(self):
        node = self.make_node()
        width, height = 320, 400
        source = scene(height, width, seed=31)
        truths = [drift(zoom_y=0.05, size=(width, height)), drift(zoom_y=0.02, shift_x=4.0, size=(width, height))]
        edits = torch.stack([make_edit(source, m, 416, 336) for m in truths])
        rgba = torch.cat([edits, torch.ones(2, 416, 336, 1)], dim=-1)
        image, mask, report = node.realign(rgba, source[None], "zoom + shift", "edge", 20.0)
        self.assertEqual(tuple(image.shape), (2, height, width, 3))
        self.assertEqual(tuple(mask.shape), (2, height, width))
        self.assertEqual(image.dtype, rgba.dtype)
        lines = report.splitlines()
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("frame 1: realigned:"))
        self.assertTrue(lines[1].startswith("frame 2: realigned:"))
        self.assertGreater(float(mask[0].mean()), float(mask[1].mean()))

    def test_one_source_per_edited_frame(self):
        node = self.make_node()
        width, height = 256, 320
        sources = torch.stack([scene(height, width, seed=51), scene(height, width, seed=52)])
        truth = drift(zoom_y=0.04, size=(width, height))
        edits = torch.stack([make_edit(sources[0], truth), make_edit(sources[1], truth)])
        image, _, report = node.realign(edits, sources, "zoom + shift", "gray", 20.0)
        self.assertEqual(tuple(image.shape), (2, height, width, 3))
        for line in report.splitlines():
            zoom_y = float(line.split("y ")[1].split("%")[0])
            self.assertAlmostEqual(zoom_y, 4.0, delta=0.15)

    def test_a_frame_it_cannot_measure_is_only_scaled(self):
        node = self.make_node()
        source = scene(300, 240, seed=41)
        other = scene(360, 360, seed=42)
        image, mask, report = node.realign(other[None], source[None], "zoom + shift", "gray", 20.0)
        self.assertTrue(report.startswith("left as is:"))
        self.assertIn("another shape", report)
        self.assertEqual(float(mask.sum()), 0.0)
        self.assertEqual(tuple(image.shape), (1, 300, 240, 3))

    def test_mismatched_batches_are_refused(self):
        node = self.make_node()
        source = scene(64 * 3, 64 * 3, seed=1)
        with self.assertRaises(ValueError):
            node.realign(torch.stack([source] * 3), torch.stack([source] * 2), "zoom + shift", "edge", 20.0)


if __name__ == "__main__":
    unittest.main()
