"""Pause for Shot's backdrop looks the 360 up the way the viewer draws it."""

from __future__ import annotations

import math
from pathlib import Path
import sys
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._backdrop_helpers import view_backdrop

DEG = math.pi / 180


def three_lookup(tilt: float, turn: float, roll: float) -> np.ndarray:
    """three r180 WebGLBackground: backgroundRotation is
    makeRotationFromEuler(scene.backgroundRotation).transpose(), with 'ZXY'
    meaning Rz(roll) @ Rx(tilt) @ Ry(turn)."""
    a, b, c = tilt * DEG, turn * DEG, roll * DEG
    rx = np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])
    ry = np.array([[math.cos(b), 0, math.sin(b)], [0, 1, 0], [-math.sin(b), 0, math.cos(b)]])
    rz = np.array([[math.cos(c), -math.sin(c), 0], [math.sin(c), math.cos(c), 0], [0, 0, 1]])
    return (rz @ rx @ ry).T


def coded_panorama(h: int = 512) -> np.ndarray:
    """Each pixel holds its own (u, v) so a lookup tells where it read."""
    w = h * 2
    u = (np.arange(w) + 0.5) / w
    v = 1 - (np.arange(h) + 0.5) / h
    gu, gv = np.meshgrid(u, v)
    return np.stack([gu, gv, np.zeros_like(gu)], -1)


class BackdropViewTests(unittest.TestCase):
    def check(self, tilt, turn, roll):
        pano = coded_panorama()
        sky = {"tilt": tilt, "turn": turn, "roll": roll, "fov": 40}
        camera = {"quaternion": {"x": 0, "y": 0, "z": 0, "w": 1}, "fov": 40}
        out = view_backdrop(pano, camera, sky, 9, 9)
        d = three_lookup(tilt, turn, roll) @ np.array([0.0, 0.0, -1.0])
        u = math.atan2(d[2], d[0]) / (2 * math.pi) + 0.5
        v = math.asin(max(-1, min(1, d[1]))) / math.pi + 0.5
        got_u, got_v = out[4, 4, 0], out[4, 4, 1]
        self.assertAlmostEqual(min(abs(got_u - u), 1 - abs(got_u - u)), 0, delta=0.01)
        self.assertAlmostEqual(got_v, v, delta=0.01)

    def test_one_angle(self):
        self.check(0, 40, 0)
        self.check(25, 0, 0)

    def test_turn_and_tilt_together(self):
        # The negated-angle rotation only matched three while one angle was
        # set: Tilt 180 with Turn -87 showed another part of the room.
        self.check(180, -87, 0)
        self.check(30, 120, 0)

    def test_all_three(self):
        self.check(20, -60, 15)


if __name__ == "__main__":
    unittest.main()
