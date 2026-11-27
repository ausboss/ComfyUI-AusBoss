"""Photo Camera: the photo's camera puts the model where the crop's camera did.

A point on the model is seen by Pixal3D's crop camera at one pixel of the
crop, which is one pixel of the photo. The camera the node hands the viewer
must see that point at the same pixel of the whole photo.
"""

import math
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nodes._backdrop_helpers import euler_zxy_matrix, quaternion_matrix  # noqa: E402
from nodes._photo_camera_helpers import BACKDROP_TURN, photo_camera, subject_box  # noqa: E402


def project(camera, point, width, height):
    """three.js perspective projection of a world point, in photo pixels."""
    pos = np.array([camera["position"][k] for k in "xyz"])
    rot = quaternion_matrix([camera["quaternion"][k] for k in "xyzw"])
    v = rot.T @ (np.asarray(point, dtype=float) - pos)
    tan_v = math.tan(math.radians(camera["fov"]) / 2)
    nx = v[0] / (-v[2] * tan_v * camera["aspect"])
    ny = v[1] / (-v[2] * tan_v)
    return (nx + 1) / 2 * width, (1 - ny) / 2 * height


def crop_pixel(point, box, crop_fov):
    """Where Pixal3D's crop camera sees a point, in photo pixels."""
    x1, y1, x2, _ = box
    side = x2 - x1
    d = 0.5 / math.tan(math.radians(crop_fov) / 2)
    depth = d - point[2]
    f = 0.5 / math.tan(math.radians(crop_fov) / 2)  # crop widths per unit at depth 1
    u = 0.5 + f * point[0] / depth
    v = 0.5 - f * point[1] / depth
    return x1 + u * side, y1 + v * side


class PhotoCameraTests(unittest.TestCase):
    def test_centred_subject_looks_straight_ahead(self):
        out = photo_camera((100, 300, 700, 900), (800, 1200), 55.0)
        cam = out["camera_info"]
        self.assertAlmostEqual(cam["target"]["x"], 0.0, places=9)
        self.assertGreater(out["crop_fov"], 0)
        self.assertLess(out["crop_fov"], 55.0)
        # Centred photo on a 2048 canvas: the same place the shipped workflow uses.
        self.assertEqual(out["strip_width"], round(2048 * 55 / 360))
        self.assertEqual(out["strip_x"], round(1024 - out["strip_width"] / 2))

    def test_model_points_land_where_the_crop_put_them(self):
        width, height = 832, 1216
        # (box, fov, worst edge error, worst middle error) as shares of the width.
        # A turned camera, not a shifted sensor: the further the person stands
        # off centre and the wider the lens, the more the model's far edges move.
        cases = (
            ((200, 400, 650, 850), 40.0, 0.002, 0.002),   # centred
            ((60, 500, 560, 1000), 50.0, 0.03, 0.003),    # a fifth of the frame off centre
            ((400, 200, 780, 580), 65.0, 0.08, 0.012),    # far up in a corner, wide lens
        )
        for box, fov, edge, middle in cases:
            out = photo_camera(box, (width, height), fov)
            worst = 0.0
            for point in ((0, 0, 0), (0.3, 0.4, 0.1), (-0.4, -0.45, -0.2), (0.45, -0.3, 0.25)):
                a = np.array(project(out["camera_info"], point, width, height))
                b = np.array(crop_pixel(point, box, out["crop_fov"]))
                worst = max(worst, float(np.abs(a - b).max()))
            self.assertLess(worst, edge * width, (box, fov, worst))
            a = np.array(project(out["camera_info"], (0, 0, 0), width, height))
            b = np.array(crop_pixel((0, 0, 0), box, out["crop_fov"]))
            self.assertLess(float(np.abs(a - b).max()), middle * width, (box, fov))

    def test_strip_sits_where_the_camera_axis_meets_the_360(self):
        width, height = 832, 1216
        out = photo_camera((60, 500, 560, 1000), (width, height), 50.0)
        cam = out["camera_info"]
        ahead = quaternion_matrix([cam["quaternion"][k] for k in "xyzw"]) @ np.array([0, 0, -1.0])
        turned = euler_zxy_matrix(0, math.radians(BACKDROP_TURN), 0).T @ ahead
        u = math.atan2(turned[2], turned[0]) / (2 * math.pi) + 0.5
        v = math.asin(max(-1, min(1, turned[1]))) / math.pi + 0.5
        centre_x = out["strip_x"] + out["strip_width"] / 2
        strip_height = round(out["strip_width"] * height / width)
        centre_y = out["strip_y"] + strip_height / 2
        self.assertAlmostEqual(centre_x, u * 2048, delta=1.0)
        self.assertAlmostEqual(centre_y, (1 - v) * 1024, delta=1.0)

    def test_subject_box_is_a_padded_square(self):
        mask = np.zeros((1216, 832))
        mask[300:1000, 200:500] = 1.0
        (x1, y1, x2, y2), (w, h) = subject_box(mask, 1.1, 1024)
        self.assertEqual((w, h), (700, 1024))
        self.assertAlmostEqual(x2 - x1, y2 - y1)
        scale = 1024 / 1216
        self.assertAlmostEqual(x2 - x1, int(700 * scale * 1.1), delta=2)


if __name__ == "__main__":
    unittest.main()
