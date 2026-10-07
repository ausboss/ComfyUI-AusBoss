from __future__ import annotations

from pathlib import Path
import importlib.util
import unittest

ROOT = Path(__file__).resolve().parent.parent
# Loaded by path: the planner is plain arithmetic and needs nothing the pack imports.
_spec = importlib.util.spec_from_file_location("ausboss_tile_helpers", ROOT / "nodes" / "_tile_helpers.py")
tiles = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tiles)

CAP = 2.0 * tiles.TILE_SLACK * tiles.SNAP_SLACK * 1e6


def megapixels(size) -> float:
    return size[0] * size[1] / 1e6


class SizeTests(unittest.TestCase):
    def test_megapixel_size_matches_the_image_resize_rule(self):
        # 736 x 1308 to 8 MP on a 32 px grid: scale each side, round half up, snap to the nearest multiple
        self.assertEqual(tiles.megapixel_size(736, 1308, 8.0, 32), (2112, 3776))
        self.assertEqual(tiles.megapixel_size(376, 500, 2.0, 32), (1216, 1632))
        self.assertEqual(tiles.megapixel_size(1080, 1440, 2.0, 1), (1225, 1633))

    def test_a_snapped_side_never_collapses(self):
        self.assertEqual(tiles.snap_to_multiple(3, 32), 32)
        self.assertEqual(tiles.snap_to_multiple(48, 32), 64)


class PlanTests(unittest.TestCase):
    def test_up_to_one_tile_the_picture_stays_whole(self):
        plan = tiles.plan_tiles(736, 1308, 2.0)
        self.assertEqual(plan["redraw"], plan["result"])
        self.assertEqual(plan["boxes"], [(0, 0, 1056, 1888)])
        self.assertFalse(plan["enlarged"])
        self.assertEqual(plan["overlap"], (0, 0))

    def test_a_small_picture_is_redrawn_at_one_tile_and_enlarged(self):
        plan = tiles.plan_tiles(293, 512, 8.0)
        self.assertEqual(plan["result"], (2144, 3744))
        self.assertEqual(len(plan["boxes"]), 1)
        self.assertTrue(plan["enlarged"])
        self.assertAlmostEqual(megapixels(plan["redraw"]), 2.0, delta=0.08)

    def test_growth_limit_sets_the_redraw_size(self):
        # 0.31 MP times 8 is 2.46 MP: more than one tile, less than the 4 MP asked for
        plan = tiles.plan_tiles(455, 675, 4.0)
        self.assertTrue(plan["enlarged"])
        self.assertAlmostEqual(megapixels(plan["redraw"]), 8 * 455 * 675 / 1e6, delta=0.08)
        self.assertEqual(len(plan["boxes"]), 2)

    def test_a_redraw_close_to_the_size_asked_is_done_at_that_size(self):
        # 0.96 MP times 8 is 7.7 MP: within a tenth of 8, so no second resample
        plan = tiles.plan_tiles(736, 1308, 8.0)
        self.assertFalse(plan["enlarged"])
        self.assertEqual(plan["redraw"], plan["result"])

    def test_fewest_tiles_and_the_squarest_of_those(self):
        self.assertEqual((tiles.plan_tiles(736, 1308, 4.0)["columns"], tiles.plan_tiles(736, 1308, 4.0)["rows"]), (1, 2))
        self.assertEqual((tiles.plan_tiles(736, 1308, 8.0)["columns"], tiles.plan_tiles(736, 1308, 8.0)["rows"]), (2, 2))
        wide = tiles.plan_tiles(4000, 800, 8.0)
        self.assertEqual((wide["columns"], wide["rows"]), (4, 1))
        self.assertLessEqual(max(wide["tile"]) / min(wide["tile"]), tiles.MAX_TILE_ASPECT)

    def test_tiles_cover_the_redraw_and_fit_the_model(self):
        for width, height, asked, tile_mp, overlap, multiple in (
            (736, 1308, 8.0, 2.0, 128, 32), (1080, 1440, 8.0, 2.0, 128, 32), (3000, 4000, 16.0, 2.0, 128, 32),
            (1125, 1100, 8.0, 2.0, 64, 16), (800, 600, 6.0, 1.0, 96, 8), (4000, 800, 8.0, 2.0, 128, 32),
            (640, 640, 12.0, 0.5, 48, 64), (2112, 3776, 0, 2.0, 128, 32),
        ):
            with self.subTest(size=(width, height), asked=asked, tile=tile_mp):
                plan = tiles.plan_tiles(width, height, asked, tile_mp, overlap, multiple, max_growth=64)
                redraw_width, redraw_height = plan["redraw"]
                tile_width, tile_height = plan["tile"]
                boxes = plan["boxes"]
                self.assertEqual(len(boxes), plan["columns"] * plan["rows"])
                for left, top, right, bottom in boxes:
                    self.assertEqual((right - left, bottom - top), (tile_width, tile_height))
                    self.assertTrue(0 <= left < right <= redraw_width and 0 <= top < bottom <= redraw_height)
                self.assertEqual(min(box[0] for box in boxes), 0)
                self.assertEqual(max(box[2] for box in boxes), redraw_width)
                self.assertEqual(min(box[1] for box in boxes), 0)
                self.assertEqual(max(box[3] for box in boxes), redraw_height)
                self.assertEqual(tile_width % multiple, 0)
                self.assertEqual(tile_height % multiple, 0)
                self.assertLessEqual(tile_width * tile_height, tile_mp * tiles.TILE_SLACK * tiles.SNAP_SLACK * 1e6)
                if plan["columns"] > 1:
                    self.assertGreaterEqual(plan["overlap"][0], overlap)
                if plan["rows"] > 1:
                    self.assertGreaterEqual(plan["overlap"][1], overlap)

    def test_zero_megapixels_keeps_the_picture_size(self):
        plan = tiles.plan_tiles(1000, 1500, 0)
        self.assertTrue(plan["keep_size"])
        self.assertEqual(plan["result"], (1000, 1500))
        self.assertEqual(plan["redraw"], (992, 1504))
        self.assertFalse(plan["too_close"])

    def test_a_size_close_to_the_picture_is_flagged(self):
        close = tiles.plan_tiles(1080, 1440, 2.0)
        self.assertTrue(close["too_close"])
        self.assertEqual(close["suggested_megapixels"], 4.0)
        self.assertFalse(tiles.plan_tiles(1080, 1440, 8.0)["too_close"])
        # a small picture always changes: no warning
        self.assertFalse(tiles.plan_tiles(376, 500, 0.3)["too_close"])

    def test_a_smaller_size_than_the_picture_is_a_shrink_not_a_warning(self):
        plan = tiles.plan_tiles(2304, 3456, 2.0)
        self.assertTrue(plan["shrunk"])
        self.assertFalse(plan["too_close"])
        self.assertEqual(len(plan["boxes"]), 1)
        text = tiles.describe_plan(plan)
        self.assertIn("made smaller first", text)
        self.assertNotIn("ask for", text)
        # the same size, or a little more, still gets the warning
        self.assertFalse(tiles.plan_tiles(1080, 1440, 2.0)["shrunk"])
        self.assertFalse(tiles.plan_tiles(2304, 3456, 0)["shrunk"])

    def test_limits_are_clear_errors(self):
        with self.assertRaisesRegex(ValueError, "larger than 0x0"):
            tiles.plan_tiles(0, 100, 2.0)
        with self.assertRaisesRegex(ValueError, "tile size above 0"):
            tiles.plan_tiles(100, 100, 2.0, tile_megapixels=0)
        with self.assertRaisesRegex(ValueError, "tiles"):
            tiles.plan_tiles(4000, 4000, 64.0, tile_megapixels=0.25, max_growth=64)


class ReportTests(unittest.TestCase):
    def test_report_says_what_happens(self):
        text = tiles.describe_plan(tiles.plan_tiles(736, 1308, 8.0))
        self.assertIn("736 x 1308 px (0.96 MP)", text)
        self.assertIn("4 tiles of 1120 x 1952 px", text)
        self.assertNotIn("enlarged", text)
        small = tiles.describe_plan(tiles.plan_tiles(293, 512, 8.0))
        self.assertIn("one tile", small)
        self.assertIn("then enlarged the plain way", small)
        close = tiles.describe_plan(tiles.plan_tiles(1080, 1440, 2.0))
        self.assertIn("ask for 4 MP or more", close)
        kept = tiles.describe_plan(tiles.plan_tiles(2112, 3776, 0))
        self.assertIn("keeps its size", kept)

    def test_report_is_plain_ascii(self):
        for plan in (tiles.plan_tiles(736, 1308, 8.0), tiles.plan_tiles(293, 512, 8.0), tiles.plan_tiles(1080, 1440, 2.0)):
            tiles.describe_plan(plan).encode("ascii")


if __name__ == "__main__":
    unittest.main()
