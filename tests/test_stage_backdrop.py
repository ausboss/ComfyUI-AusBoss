"""Your photo as the backdrop: from the photo's own camera the stage gives the
photo back, a zoom stays lined up, a floor point keeps its place from another
side, and what the photo never saw comes from the 360 or the photo's edge."""

import math
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nodes._stage_helpers import (  # noqa: E402
    SIZE_MIN, bilinear, camera_frame, dome_radius, edge_fill, project, stage_backdrop, stage_points,
)
from nodes.node_pause_shot import background_choice  # noqa: E402

PHOTO = {"position": {"x": 0, "y": 0, "z": 2}, "target": {"x": 0, "y": 0, "z": 0}, "fov": 50}
FLOOR = -0.5


def plate(h=60, w=40):
    """A picture where every pixel says where it is: red = column, green = row."""
    rows, cols = np.mgrid[0:h, 0:w]
    return np.stack([cols / (w - 1), rows / (h - 1), np.full((h, w), 0.5)], -1)


def orbit(degrees, distance=2.0, y=0.0, zoom=1.0):
    a = math.radians(degrees)
    return {"position": {"x": distance * math.sin(a), "y": y, "z": distance * math.cos(a)},
            "target": {"x": 0, "y": 0, "z": 0}, "fov": 50, "zoom": zoom}


class StageBackdropTests(unittest.TestCase):
    def test_photo_camera_gives_the_photo_back(self):
        picture = plate()
        out = stage_backdrop(picture, PHOTO, PHOTO, FLOOR, 40, 60)
        self.assertLess(np.abs(out - picture).max(), 1e-6)

    def test_zoom_stays_lined_up(self):
        picture = plate(80, 80)
        out = stage_backdrop(picture, PHOTO, orbit(0, zoom=2.0), FLOOR, 80, 80)
        # Twice the zoom shows the middle half of the photo, stretched to fill.
        self.assertAlmostEqual(out[0, 0, 0], picture[20, 20, 0], delta=0.02)
        self.assertAlmostEqual(out[-1, -1, 1], picture[59, 59, 1], delta=0.02)

    def test_floor_point_keeps_its_place_from_another_side(self):
        # A point on the floor in front of her, seen by the photo at some pixel,
        # is seen at that same pixel of the photo from a camera turned 30 degrees.
        point = np.array([0.1, FLOOR, 0.4])
        shot = orbit(30)
        frame = camera_frame(shot)
        col, row, front = project(frame, (point - frame[0])[None], 64, 64)
        self.assertTrue(front[0])
        photo, vectors, on_floor = stage_points(shot, PHOTO, FLOOR, 64, 64)
        c, r = int(round(col[0])), int(round(row[0]))
        self.assertTrue(on_floor[r, c])
        hit = vectors[r, c] + photo[0]
        self.assertLess(np.linalg.norm(hit - point), 0.05)

    def test_outside_the_photo_comes_from_the_360(self):
        picture = plate()
        pano = np.zeros((32, 64, 3))
        pano[..., 2] = 1.0  # all blue
        out = stage_backdrop(picture, PHOTO, orbit(150), FLOOR, 40, 60, panorama=pano)
        self.assertGreater(out[5, 20, 2], 0.99)  # sky behind the photo camera: the 360

    def test_no_360_fills_from_the_photo(self):
        picture = plate()
        out = stage_backdrop(picture, PHOTO, orbit(60), FLOOR, 40, 60)
        self.assertTrue(np.isfinite(out).all())
        self.assertLessEqual(out.max(), 1.0)
        self.assertGreaterEqual(out.min(), 0.0)

    def test_360_floor_without_photo(self):
        pano = np.zeros((32, 64, 3))
        pano[16:, ..., 1] = 1.0  # lower half green
        out = stage_backdrop(None, PHOTO, orbit(45, y=0.2), FLOOR, 40, 60, panorama=pano, use_photo=False)
        self.assertGreater(out[-1, 20, 1], 0.99)  # looking down: the 360's floor

    def test_needs_both_cameras(self):
        self.assertIsNone(stage_backdrop(plate(), None, PHOTO, FLOOR, 10, 10))
        self.assertIsNone(stage_backdrop(plate(), PHOTO, None, FLOOR, 10, 10))

    def test_background_choice(self):
        self.assertEqual(background_choice("photo", True), "photo")
        self.assertEqual(background_choice("photo", False), "360")
        self.assertEqual(background_choice("360", True), "360")
        self.assertEqual(background_choice("360 floor", False), "360 floor")
        self.assertEqual(background_choice("nonsense", True), "photo")

    def test_past_the_edge_fades_soft(self):
        # Just past the photo's left edge: the edge itself. Far past it: a
        # soft blur of the photo, not the edge's colour stretched out.
        picture = plate(96, 96)
        col = np.array([[-0.5, -40.0]])
        row = np.array([[48.0, 48.0]])
        sharp = bilinear(picture, col, row)
        out = edge_fill(picture, col, row, sharp)
        self.assertAlmostEqual(out[0, 0, 0], picture[48, 0, 0], delta=0.01)
        self.assertGreater(out[0, 1, 0], 0.15)  # the blur of the left half, not column 0



class DomeTests(unittest.TestCase):
    """Size: the stage as a dome around the photo's camera, Size camera
    heights to its wall (PHOTO's eye is 0.5 above FLOOR)."""

    def test_size_reads_in_camera_heights(self):
        self.assertAlmostEqual(dome_radius(8, 0.0, FLOOR), 4.0)
        self.assertAlmostEqual(dome_radius(0.2, 0.0, FLOOR), SIZE_MIN * 0.5)  # never smaller than the floor needs
        for endless in (None, 0, -3, True, "8", float("nan")):
            self.assertEqual(dome_radius(endless, 0.0, FLOOR), 0.0)
        self.assertEqual(dome_radius(8, 0.0, None), 0.0)  # no floor, no dome
        self.assertEqual(dome_radius(8, -1.0, FLOOR), 0.0)  # camera under the floor

    def test_photo_camera_gives_the_photo_back_at_any_size(self):
        picture = plate()
        for size in (2, 8, 40):
            out = stage_backdrop(picture, PHOTO, PHOTO, FLOOR, 40, 60, sky={"size": size})
            self.assertLess(np.abs(out - picture).max(), 1e-6, size)

    def test_no_size_is_the_endless_stage(self):
        picture = plate()
        endless = stage_backdrop(picture, PHOTO, orbit(40), FLOOR, 40, 60)
        for sky in ({"size": None}, {"size": 0}, {}):
            self.assertLess(np.abs(stage_backdrop(picture, PHOTO, orbit(40), FLOOR, 40, 60, sky=sky) - endless).max(), 1e-9)

    def test_above_the_floor_lands_on_the_wall(self):
        photo, vectors, on_floor = stage_points(orbit(40), PHOTO, FLOOR, 48, 48, 8)
        reach = np.linalg.norm(vectors, axis=-1)
        self.assertTrue(on_floor.any() and (~on_floor).any())
        self.assertLess(np.abs(reach[~on_floor] - 4.0).max(), 1e-6)
        self.assertTrue((reach[on_floor] <= 4.0 + 1e-6).all())

    def test_a_wall_point_keeps_its_place_from_another_side(self):
        # A point on the wall the photo looks at, behind her: from a camera turned
        # 25 degrees it is seen at its own pixel, and that pixel looks it up.
        eye = np.array([0.0, 0.0, 2.0])
        point = eye + np.array([0.15, 0.3, -1.0]) / np.linalg.norm([0.15, 0.3, -1.0]) * 4.0
        shot = orbit(25)
        frame = camera_frame(shot)
        col, row, front = project(frame, (point - frame[0])[None], 64, 64)
        self.assertTrue(front[0])
        photo, vectors, on_floor = stage_points(shot, PHOTO, FLOOR, 64, 64, 8)
        c, r = int(round(col[0])), int(round(row[0]))
        self.assertFalse(on_floor[r, c])
        self.assertLess(np.linalg.norm(vectors[r, c] + photo[0] - point), 0.1)

    def test_a_small_room_keeps_far_floor_on_the_wall(self):
        # Looking down at a shallow angle the floor runs past the wall: those
        # pixels are the wall, not floor beyond it.
        low = {"position": {"x": 0, "y": -0.3, "z": 2}, "target": {"x": 0, "y": -0.35, "z": 0}, "fov": 50}
        _, _, endless_floor = stage_points(low, PHOTO, FLOOR, 32, 32)
        _, _, room_floor = stage_points(low, PHOTO, FLOOR, 32, 32, 3)
        self.assertGreater(endless_floor.sum(), room_floor.sum())

    def test_a_camera_outside_the_dome_still_gets_a_picture(self):
        out = stage_backdrop(plate(), PHOTO, orbit(150, distance=6.0), FLOOR, 40, 60, sky={"size": 2})
        self.assertTrue(np.isfinite(out).all())


if __name__ == "__main__":
    unittest.main()
