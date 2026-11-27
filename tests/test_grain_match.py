"""Film Grain's grain match (nodes/_grain_match_helpers.py).

The match reads Film Grain's own grain back from a picture: each case adds
grain at known settings to a plain picture and checks the match finds them.
The stored table (nodes/_grain_match_table.py) is checked against a fresh
measure; after a change to how grain is drawn or measured, rebuild it with
ComfyUI's Python:

    python tests/test_grain_match.py --update
"""

from __future__ import annotations

from pathlib import Path
import pprint
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _grain_match_helpers as M
from nodes._grain_helpers import add_film_grain
try:
    from nodes._grain_match_table import TABLE
except ImportError:  # before the first --update
    TABLE = None
from nodes import node_film_grain as film_grain_module
from nodes.node_film_grain import AusBossFilmGrain

TABLE_FILE = ROOT / "nodes" / "_grain_match_table.py"


def scene(height: int = 384, width: int = 512) -> torch.Tensor:
    """A soft, plain picture: a gentle gradient with one darker band."""
    ys = torch.linspace(0.0, 1.0, height).view(height, 1, 1)
    xs = torch.linspace(0.0, 1.0, width).view(1, width, 1)
    tint = torch.tensor([1.0, 0.95, 0.85]).view(1, 1, 3)
    base = 0.35 + 0.3 * xs + 0.1 * ys - 0.12 * ((ys > 0.6) & (ys < 0.7)).float()
    return (base * tint).clamp(0.0, 1.0)[None]


class GrainMatchTests(unittest.TestCase):
    def test_reads_back_film_grains_own_settings(self):
        clean = scene()
        for amount, size, color in [(0.25, 1.0, 0.0), (0.4, 2.0, 0.3), (0.3, 3.0, 0.6), (0.5, 5.0, 0.5)]:
            with self.subTest(amount=amount, size=size, color=color):
                reference = add_film_grain(clean, amount, size, 0.5, color, False, 11)
                found = M.match_grain(reference, clean, 0.5, 4)
                self.assertTrue(found["found"])
                self.assertAlmostEqual(found["amount"], amount, delta=0.06)
                self.assertLess(abs(found["size"] / size - 1.0), 0.2)
                self.assertAlmostEqual(found["color"], color, delta=0.21)

    def test_a_clean_reference_adds_no_grain(self):
        found = M.match_grain(scene(), scene(), 0.5, 0)
        self.assertFalse(found["found"])
        self.assertEqual(found["amount"], 0.0)

    def test_a_grainy_target_gets_less(self):
        clean = scene()
        reference = add_film_grain(clean, 0.4, 2.0, 0.5, 0.0, False, 1)
        half_way = add_film_grain(clean, 0.25, 2.0, 0.5, 0.0, False, 2)
        self.assertLess(M.match_grain(reference, half_way, 0.5, 3)["amount"], M.match_grain(reference, clean, 0.5, 3)["amount"] - 0.05)

    def test_grain_is_matched_at_the_same_viewing_size(self):
        """A reference twice as big, shrunk to the target's size, has grain half as big."""
        big = add_film_grain(scene(768, 1024), 0.35, 4.0, 0.5, 0.0, False, 5)
        found = M.match_grain(big, scene(), 0.5, 6)
        self.assertLess(abs(found["size"] / 2.0 - 1.0), 0.25)
        scaled = M.same_viewing_size(torch.rand(1, 200, 100, 3), 400, 400)
        self.assertEqual(tuple(scaled.shape), (1, 566, 283, 3))

    def test_a_clip_is_read_from_its_first_frame(self):
        clean = scene(256, 256)
        clip = torch.cat([add_film_grain(clean, 0.4, 2.0, 0.5, 0.0, False, 1), clean.expand(3, -1, -1, -1)])
        self.assertTrue(M.match_grain(clip, clean.expand(2, -1, -1, -1), 0.5, 0)["found"])

    def test_too_small_says_so(self):
        with self.assertRaisesRegex(ValueError, "too small"):
            M.match_grain(scene(), scene(40, 40), 0.5, 0)

    def test_the_multipliers_count_from_the_match(self):
        reference = add_film_grain(scene(), 0.3, 2.0, 0.5, 0.4, False, 9)
        once = M.matched_film_grain_values(reference, scene(), 0.5, 0, 1.0, 1.0, 1.0)
        twice = M.matched_film_grain_values(reference, scene(), 0.5, 0, 2.0, 0.5, 0.5)
        self.assertAlmostEqual(twice["amount"], min(1.0, once["base_amount"] * 2.0), places=6)
        self.assertAlmostEqual(twice["size"], max(0.5, once["base_size"] * 0.5), places=6)
        self.assertAlmostEqual(twice["color"], once["base_color"] * 0.5, places=6)

    def test_the_node_matches_with_auto_on_and_sends_the_match(self):
        node = AusBossFilmGrain()
        clean = scene(128, 128)
        reference = add_film_grain(clean, 0.4, 2.0, 0.5, 0.3, False, 3)
        result = node.grain(clean, 0.25, 1.0, 0.5, 0.0, False, 0, preview=False, auto=True, grain_from=reference)
        self.assertGreater(float((result[0] - clean).std()), 0.01)
        seen = {}
        original = film_grain_module.preview_payload
        film_grain_module.preview_payload = lambda result, *args, extra_ui=None, **kwargs: seen.update(extra_ui or {}) or result
        try:
            node.grain(clean, 0.25, 1.0, 0.5, 0.0, False, 0, auto=True, grain_from=reference)
        finally:
            film_grain_module.preview_payload = original
        match = seen["ausboss_grain_match"][0]
        self.assertTrue({"base_amount", "base_size", "base_color", "found"} <= set(match))
        self.assertNotIn("ausboss_grain_auto", seen)
        # Auto off: the picture to copy from is not read.
        plain = node.grain(clean, 0.0, 1.0, 0.5, 0.0, False, 0, preview=False, auto=False, grain_from=reference)
        self.assertTrue(torch.equal(plain[0], clean))

    def test_the_stored_table_is_film_grains_own_grain(self):
        self.assertEqual(TABLE["scales"], list(M.SCALES))
        self.assertEqual(TABLE["sizes"], list(M.TABLE_SIZES))
        self.assertEqual(TABLE["colors"], list(M.TABLE_COLORS))
        # Spot checks: a fresh measure of a few entries.
        from nodes import _grain_helpers as G

        for size_at, color_at in [(0, 0), (6, 3), (18, 10), (24, 5)]:
            size, color = M.TABLE_SIZES[size_at], M.TABLE_COLORS[color_at]
            grain = G.grain_frame(M.TABLE_SEED, M.TABLE_SIDE, M.TABLE_SIDE, size, M.TABLE_ROUGHNESS, color)
            if int(grain.shape[0]) == 1:
                grain = grain.expand(3, -1, -1)
            profile = M.grain_profile((0.5 + G.FULL_STRENGTH * grain.movedim(0, -1))[None])
            for i, scale in enumerate(M.SCALES):
                self.assertAlmostEqual(TABLE["luma"][size_at][color_at][i], profile[scale][0] / G.FULL_STRENGTH, delta=1e-3)
                self.assertAlmostEqual(TABLE["chroma"][size_at][color_at][i], profile[scale][1] / G.FULL_STRENGTH, delta=1e-3)


def write_table() -> None:
    table = M.build_match_table()
    TABLE_FILE.write_text(
        '"""Film Grain\'s own grain, measured, for the grain match (nodes/_grain_match_helpers.py).\n\n'
        "Made by `python tests/test_grain_match.py --update`; do not edit by hand.\n"
        "luma[size][color][scale] and chroma[size][color][scale] are the brightness\n"
        "and colour grain at each scale per unit of amount.\n"
        '"""\n\n'
        f"TABLE = {pprint.pformat(table, width=120, compact=True)}\n",
        encoding="utf-8",
    )
    print(f"wrote {TABLE_FILE}")


if __name__ == "__main__":
    if "--update" in sys.argv:
        write_table()
    else:
        unittest.main()
