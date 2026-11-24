"""The viewer's Cut: the planes face the camera and split the model's depth
by the shares asked, and Pause for Shot's mesh keeps what lies between."""

import math
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nodes._mesh_cut_helpers import camera_view, clean_cut, cut_planes, kept_faces, model_transform  # noqa: E402

CAMERA = {"position": {"x": 0, "y": 0, "z": 5}, "target": {"x": 0, "y": 0, "z": 0}}


def slab():
    """A row of small triangles from z = -1 (far) to z = 1 (near)."""
    points, faces = [], []
    for i, z in enumerate(np.linspace(-1, 1, 21)):
        points += [(-0.1, 0, z), (0.1, 0, z), (0, 0.1, z)]
        faces.append((3 * i, 3 * i + 1, 3 * i + 2))
    return np.array(points, dtype=float), np.array(faces)


class MeshCutTests(unittest.TestCase):
    def test_nothing_cut_is_none(self):
        self.assertIsNone(clean_cut(None))
        self.assertIsNone(clean_cut({"front": 0, "back": 0}))
        self.assertIsNone(clean_cut({"front": "x", "back": True}))

    def test_cut_always_leaves_some_model(self):
        cut = clean_cut({"front": 70, "back": 70})
        self.assertEqual(cut["front"], 70)
        self.assertLessEqual(cut["front"] + cut["back"], 99)

    def test_back_half_comes_off(self):
        points, faces = slab()
        keep = kept_faces(points, faces, None, camera_view(CAMERA), {"front": 0, "back": 50})
        middles = points[faces].mean(1)[:, 2]
        self.assertTrue((middles[keep] >= -1e-9).all())
        self.assertTrue((middles[~keep] < 0).all())

    def test_planes_follow_the_viewer_turn(self):
        points, faces = slab()
        # The model spun 90 degrees about Y: its depth now runs across the view.
        turn = [{"position": {"x": 0, "y": 0, "z": 0}, "scale": {"x": 1, "y": 1, "z": 1},
                 "quaternion": {"x": 0, "y": math.sin(math.pi / 4), "z": 0, "w": math.cos(math.pi / 4)}}]
        near, far = cut_planes(points, model_transform(turn), camera_view(CAMERA), {"front": 0, "back": 50})
        # Seen from +Z the turned slab is only 0.2 deep (its triangles' width).
        self.assertAlmostEqual(far - near, 0.1, places=6)

    def test_front_cut_keeps_the_far_part(self):
        points, faces = slab()
        keep = kept_faces(points, faces, None, camera_view(CAMERA), {"front": 25, "back": 0})
        middles = points[faces].mean(1)[:, 2]
        self.assertTrue((middles[keep] <= 0.5 + 1e-9).all())
        self.assertEqual(int(keep.sum()), 16)


if __name__ == "__main__":
    unittest.main()
