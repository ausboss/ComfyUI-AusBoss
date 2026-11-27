"""Stitch Inpaint 🆎 Follow changes (nodes/_follow_changes_helpers.py).

A model that redraws the whole crop draws a new thing a little past the
box; the classic paste cut it at the box's edge. Follow changes pastes the
box plus every change that touches it, after undoing a small zoom."""

from __future__ import annotations

from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

import torch
import torch.nn.functional as F

from nodes._inpaint_crop_helpers import build_crop
from nodes.node_inpaint_crop_stitch import AusBossStitchInpaint

H, W = 600, 800


def picture():
    """A textured picture: smooth gradients plus a fine grid the realign can lock onto."""
    ys = torch.linspace(0, 1, H)[:, None]
    xs = torch.linspace(0, 1, W)[None, :]
    grid = ((torch.arange(H)[:, None] // 12 + torch.arange(W)[None, :] // 12) % 2).float()
    r = 0.3 + 0.3 * xs + 0.1 * grid
    g = 0.3 + 0.3 * ys + 0.1 * grid
    b = 0.5 + 0.0 * xs + 0.1 * (1 - grid)
    return torch.stack([r.expand(H, W), g.expand(H, W), b.expand(H, W)], -1)[None].clamp(0, 1)


BOX = (300, 200, 500, 400)  # x0, y0, x1, y1


def crop():
    image = picture()
    mask = torch.zeros(1, H, W)
    x0, y0, x1, y1 = BOX
    mask[:, y0:y1, x0:x1] = 1
    _, _, stitcher = build_crop(image, mask, 1.0, 8, 8, context_pixels=96)
    return image, stitcher


def redraw(stitcher, zoom=1.0):
    """What such a model returns: the crop, a red block that reaches 40 px
    below the box, all optionally zoomed about the centre."""
    cx, cy, cw, ch = stitcher["crop_to_canvas"]
    out = stitcher["canvas"][:, cy:cy + ch, cx:cx + cw, :].clone()
    x0, y0, x1, y1 = BOX
    out[:, y0 - cy + 40:y1 - cy + 40, x0 - cx + 40:x1 - cx - 40, :] = torch.tensor([0.9, 0.1, 0.1])
    if zoom != 1.0:
        theta = torch.tensor([[[1 / zoom, 0, 0], [0, 1 / zoom, 0]]], dtype=torch.float32)
        grid = F.affine_grid(theta, (1, 3, ch, cw), align_corners=False)
        out = F.grid_sample(out.permute(0, 3, 1, 2), grid, padding_mode="border",
                            align_corners=False).permute(0, 2, 3, 1)
    return out


class FollowChangesTests(unittest.TestCase):
    def stitch(self, follow, zoom=1.0):
        image, stitcher = crop()
        result, mask = AusBossStitchInpaint().stitch(stitcher, redraw(stitcher, zoom), follow_changes=follow)
        return image, result, mask

    def test_off_cuts_the_new_thing_at_the_box(self):
        _, result, _ = self.stitch(False)
        x0, _, x1, y1 = BOX
        below = result[0, y1 + 15:y1 + 30, x0 + 60:x1 - 60]
        self.assertLess(float(below[..., 0].mean()), 0.7)

    def test_on_pastes_what_reaches_past_the_box(self):
        _, result, mask = self.stitch(True)
        x0, _, x1, y1 = BOX
        below = result[0, y1 + 15:y1 + 30, x0 + 60:x1 - 60]
        self.assertGreater(float(below[..., 0].mean()), 0.85)
        self.assertGreater(float(mask[0, y1 + 20, (x0 + x1) // 2]), 0.9)

    def test_on_leaves_the_picture_away_from_the_change(self):
        image, result, _ = self.stitch(True)
        x0, y0, x1, _ = BOX
        # Left of the box and above it the model drew nothing new.
        self.assertTrue(torch.equal(result[0, :, : x0 - 120], image[0, :, : x0 - 120]))
        self.assertTrue(torch.equal(result[0, : y0 - 120], image[0, : y0 - 120]))

    def test_on_undoes_a_small_zoom(self):
        image, off, _ = self.stitch(False, zoom=1.03)
        _, on, _ = self.stitch(True, zoom=1.03)
        x0, y0, x1, y1 = BOX
        # Inside the box, away from the red block: the grid lines up again.
        area = (slice(y0 + 5, y0 + 35), slice(x0 + 5, x1 - 5))
        miss_off = float((off[0][area] - image[0][area]).abs().mean())
        miss_on = float((on[0][area] - image[0][area]).abs().mean())
        self.assertLess(miss_on, miss_off * 0.5)

    def test_an_old_workflow_empty_value_stays_off(self):
        image, stitcher = crop()
        node = AusBossStitchInpaint()
        a, _ = node.stitch(stitcher, redraw(stitcher), follow_changes="")
        b, _ = node.stitch(stitcher, redraw(stitcher), follow_changes=False)
        self.assertTrue(torch.equal(a, b))


if __name__ == "__main__":
    unittest.main()
