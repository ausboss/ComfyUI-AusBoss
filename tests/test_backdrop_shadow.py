"""The ground shadow Pause for Shot draws into its backdrop."""

from __future__ import annotations

from pathlib import Path
import sys
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._backdrop_helpers import clean_ground, shadow_alpha, shadow_falloff

# A camera 3 up and 3 back, looking at the floor's middle.
CAMERA = {"position": {"x": 0, "y": 3, "z": 3}, "target": {"x": 0, "y": 0, "z": 0}, "fov": 50, "zoom": 1}
GROUND = {"y": 0, "cx": 0, "cz": 0, "rx": 1, "rz": 1}


class ShadowTests(unittest.TestCase):
    def test_falloff_is_full_in_the_middle_and_gone_at_the_edge(self):
        self.assertAlmostEqual(float(shadow_falloff(np.array(0.0))), 1.0)
        self.assertAlmostEqual(float(shadow_falloff(np.array(1.0))), 0.0)
        self.assertAlmostEqual(float(shadow_falloff(np.array(2.0))), 0.0)
        self.assertTrue(0 < float(shadow_falloff(np.array(0.5))) < 1)

    def test_shadow_is_darkest_where_the_camera_looks_at_the_patch(self):
        alpha = shadow_alpha(CAMERA, GROUND, 0.8, 64, 48)
        self.assertEqual(alpha.shape, (48, 64))
        # The target is the patch's middle, so the picture's middle is darkest.
        self.assertAlmostEqual(float(alpha[24, 32]), 0.8, delta=0.02)
        self.assertAlmostEqual(float(alpha.max()), 0.8, delta=0.01)
        # The corners look past the patch.
        self.assertEqual(float(alpha[0, 0]), 0.0)
        self.assertEqual(float(alpha[0, 63]), 0.0)

    def test_moving_the_patch_moves_the_shadow(self):
        right = shadow_alpha(CAMERA, {**GROUND, "cx": 0.6}, 1.0, 64, 48)
        cols = right.sum(0)
        self.assertGreater(int(np.argmax(cols)), 32)

    def test_nothing_from_below_the_floor_or_at_zero_strength(self):
        below = {**CAMERA, "position": {"x": 0, "y": -2, "z": 3}}
        self.assertEqual(float(shadow_alpha(below, GROUND, 1.0, 32, 24).max()), 0.0)
        self.assertEqual(float(shadow_alpha(CAMERA, GROUND, 0.0, 32, 24).max()), 0.0)
        self.assertEqual(float(shadow_alpha(CAMERA, None, 1.0, 32, 24).max()), 0.0)

    def test_ground_from_the_page_is_checked(self):
        self.assertEqual(clean_ground(GROUND), {k: float(v) for k, v in GROUND.items()})
        self.assertIsNone(clean_ground({**GROUND, "rx": 0}))
        self.assertIsNone(clean_ground({**GROUND, "y": "low"}))
        self.assertIsNone(clean_ground({**GROUND, "cz": float("nan")}))
        self.assertIsNone(clean_ground([1, 2, 3]))


if __name__ == "__main__":
    unittest.main()
