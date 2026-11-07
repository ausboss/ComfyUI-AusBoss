"""Offline tests for Camera Move: keys, pose, depth packing and the warp."""

from __future__ import annotations

import json
import math
import sys
import tempfile
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._camera_move_helpers import (
    DEFAULT_CAMERA,
    LIMITS,
    camera_at,
    default_camera_text,
    frame_moments,
    pack_depth,
    parse_camera,
    past_lora_range,
    pose,
    range_report,
    rotation,
    scene_frame_indices,
    scene_size,
    unpack_depth,
)

try:
    import numpy as np
    import torch
except ImportError:  # pragma: no cover - the warp tests need ComfyUI's Python
    np = torch = None


def _apply(R, v):
    return [sum(R[r][c] * v[c] for c in range(3)) for r in range(3)]


def _apply_t(R, v):
    return [sum(R[c][r] * v[c] for c in range(3)) for r in range(3)]


class ParseCameraTests(unittest.TestCase):
    def test_default_text_reads_back_as_the_default(self):
        parsed = parse_camera(default_camera_text())
        self.assertFalse(parsed["fallback"])
        self.assertEqual([k["t"] for k in parsed["keys"]], [0.0, 1.0])
        self.assertEqual(parsed["keys"][1]["az"], DEFAULT_CAMERA["keys"][1]["az"])
        self.assertIsNone(parsed["pivot"])

    def test_unreadable_text_falls_back_to_the_default_move(self):
        for text in ("", "not json", "[]", '{"keys": []}', '{"keys": "x"}', None, 12):
            parsed = parse_camera(text)
            self.assertTrue(parsed["fallback"], text)
            self.assertEqual(len(parsed["keys"]), 2)

    def test_keys_are_clamped_sorted_and_merged(self):
        text = json.dumps({"keys": [
            {"t": 0.9, "az": 500, "el": -99, "back": 9},
            {"t": 0.1, "az": "12", "px": -5},
            {"t": 0.905, "az": 20},
            {"t": 7, "el": float("nan")},
        ]})
        keys = parse_camera(text)["keys"]
        self.assertEqual([round(k["t"], 3) for k in keys], [0.1, 0.905, 1.0])
        self.assertEqual(keys[0]["az"], 12.0)
        self.assertEqual(keys[0]["px"], LIMITS["px"][0])
        # The later key at the same moment wins.
        self.assertEqual(keys[1]["az"], 20.0)
        self.assertEqual(keys[2]["el"], 0.0)
        for key in keys:
            for name, (low, high) in LIMITS.items():
                self.assertTrue(low <= key[name] <= high)

    def test_pivot_is_kept_inside_the_picture(self):
        parsed = parse_camera({"keys": [{"t": 0}], "pivot": {"u": 1.4, "v": -1, "t": 0.5}})
        self.assertEqual(parsed["pivot"], {"u": 1.0, "v": 0.0, "t": 0.5})
        self.assertIsNone(parse_camera({"keys": [{"t": 0}], "pivot": {"u": 0.2}})["pivot"])


class CameraAtTests(unittest.TestCase):
    keys = [{"t": 0.0, "az": 0, "el": 0, "back": 0, "px": 0, "py": 0},
            {"t": 0.5, "az": 40, "el": 10, "back": 1, "px": 0, "py": 0},
            {"t": 1.0, "az": 40, "el": 10, "back": 1, "px": 0.5, "py": 0}]

    def test_holds_before_the_first_and_after_the_last_key(self):
        self.assertEqual(camera_at(self.keys, -1)["az"], 0)
        self.assertEqual(camera_at(self.keys, 2)["px"], 0.5)

    def test_eases_between_keys(self):
        self.assertAlmostEqual(camera_at(self.keys, 0.25)["az"], 20.0)
        self.assertAlmostEqual(camera_at(self.keys, 0.125)["az"], 40 * (0.25 ** 2 * 2.5))
        self.assertEqual(camera_at(self.keys, 0.5)["az"], 40)

    def test_one_key_holds_still(self):
        self.assertEqual(camera_at(self.keys[1:2], 0.0)["back"], 1)

    def test_frame_moments_run_from_start_to_end(self):
        self.assertEqual(frame_moments(1), [0.0])
        self.assertEqual(frame_moments(3), [0.0, 0.5, 1.0])


class PoseTests(unittest.TestCase):
    pivot = [0.3, -0.2, 2.0]

    def test_rotation_is_a_rotation(self):
        R = rotation(33, -17)
        for r in range(3):
            for c in range(3):
                dot = sum(R[k][r] * R[k][c] for k in range(3))
                self.assertAlmostEqual(dot, 1.0 if r == c else 0.0)

    def test_turning_right_moves_the_camera_right(self):
        _, C = pose({"az": 30, "el": 0, "back": 0, "px": 0, "py": 0}, [0, 0, 2])
        self.assertGreater(C[0], 0)
        _, C = pose({"az": 0, "el": 20, "back": 0, "px": 0, "py": 0}, [0, 0, 2])
        self.assertLess(C[1], 0)  # y is down: rising is negative y

    def test_home_is_the_original_camera(self):
        R, C = pose({"az": 0, "el": 0, "back": 0, "px": 0, "py": 0}, self.pivot)
        self.assertEqual([[round(x, 9) for x in row] for row in R], [[1, 0, 0], [0, 1, 0], [0, 0, 1]])
        for x in C:
            self.assertAlmostEqual(x, 0.0)

    def test_the_pivot_stays_where_it_was_on_screen(self):
        d = math.sqrt(sum(x * x for x in self.pivot))
        for cam in ({"az": 40, "el": 15, "back": 0.5}, {"az": -70, "el": -25, "back": -0.4}):
            cam = {**cam, "px": 0, "py": 0}
            R, C = pose(cam, self.pivot)
            seen = _apply_t(R, [self.pivot[i] - C[i] for i in range(3)])
            # Where the original camera saw it, pushed back along the view by back * d.
            self.assertAlmostEqual(seen[0], self.pivot[0])
            self.assertAlmostEqual(seen[1], self.pivot[1])
            self.assertAlmostEqual(seen[2], self.pivot[2] + cam["back"] * d)

    def test_pan_slides_the_camera_in_its_own_frame(self):
        d = math.sqrt(sum(x * x for x in self.pivot))
        R, C0 = pose({"az": 25, "el": 5, "back": 0, "px": 0, "py": 0}, self.pivot)
        _, C1 = pose({"az": 25, "el": 5, "back": 0, "px": 0.5, "py": 0}, self.pivot)
        moved = _apply_t(R, [C1[i] - C0[i] for i in range(3)])
        self.assertAlmostEqual(moved[0], 0.5 * d)
        self.assertAlmostEqual(moved[1], 0.0)
        self.assertAlmostEqual(moved[2], 0.0)

    def test_lora_range(self):
        self.assertFalse(past_lora_range({"az": 45, "el": 30}))
        self.assertTrue(past_lora_range({"az": -46, "el": 0}))
        self.assertTrue(past_lora_range({"az": 0, "el": -21}))
        self.assertEqual(range_report(CameraAtTests.keys), "")
        report = range_report([{"t": 0.5, "az": 60, "el": 0}])
        self.assertIn("past the LoRA's range", report)
        report.encode("ascii")


class SceneTests(unittest.TestCase):
    def test_frames_for_the_face(self):
        self.assertEqual(scene_frame_indices(0), [])
        self.assertEqual(scene_frame_indices(5), [0, 1, 2, 3, 4])
        picks = scene_frame_indices(121)
        self.assertEqual((picks[0], picks[-1], len(picks)), (0, 120, 61))
        self.assertEqual(picks[:3], [0, 2, 4])

    def test_scene_size_keeps_the_shape(self):
        self.assertEqual(scene_size(832, 480), (416, 240))
        self.assertEqual(scene_size(300, 200), (300, 200))

    @unittest.skipIf(np is None, "needs numpy")
    def test_depth_packing_round_trips(self):
        rng = np.random.default_rng(1)
        z = rng.uniform(0.4, 60.0, (24, 32))
        valid = rng.uniform(size=z.shape) > 0.2
        packed = pack_depth(z, valid, float(z[valid].min()), float(z[valid].max()))
        self.assertEqual(packed.dtype, np.uint8)
        back, ok = unpack_depth(packed, float(z[valid].min()), float(z[valid].max()), 999.0)
        self.assertTrue((ok == valid).all())
        self.assertLess(float(np.abs(back[valid] / z[valid] - 1).max()), 1e-4)
        self.assertTrue((back[~valid] == 999.0).all())


def _wall_and_box(frames=3, H=48, W=64):
    """A wall 4 m away with a box 2 m away in the middle, as MoGe would hand it over."""
    f = 60.0
    K = torch.tensor([[f, 0, W / 2], [0, f, H / 2], [0, 0, 1.0]])
    vv, uu = torch.meshgrid(torch.arange(H) + 0.5, torch.arange(W) + 0.5, indexing="ij")
    z = torch.full((H, W), 4.0)
    z[H // 3: 2 * H // 3, W // 3: 2 * W // 3] = 2.0
    pts = torch.stack([(uu - W / 2) / f * z, (vv - H / 2) / f * z, z], -1)
    image = torch.zeros(H, W, 3)
    image[..., 0] = uu / W
    image[..., 1] = vv / H
    image[..., 2] = 0.2
    return {
        "points": pts[None].expand(frames, H, W, 3).clone(),
        "intrinsics": K[None].expand(frames, 3, 3).clone(),
        "image": image[None].expand(frames, H, W, 3).clone(),
        "mask": torch.ones(frames, H, W, dtype=torch.bool),
    }


@unittest.skipIf(torch is None, "needs torch")
class WarpTests(unittest.TestCase):
    def setUp(self):
        from nodes._camera_move_helpers import auto_pivot, prepare_geometry, resolve_pivot, warp_frame

        self.prepare, self.auto, self.resolve, self.warp = prepare_geometry, auto_pivot, resolve_pivot, warp_frame
        self.scene = prepare_geometry(_wall_and_box())

    def test_home_gives_back_the_clip(self):
        home = {"az": 0, "el": 0, "back": 0, "px": 0, "py": 0}
        frame, hole = self.warp(self.scene, 0, home, self.auto(self.scene), torch.device("cpu"))
        self.assertEqual(int(hole.sum()), 0)
        self.assertLess(float((frame - self.scene["image"][0]).abs().max()), 1e-4)

    def test_a_turn_opens_pink_holes_beside_the_box(self):
        cam = {"az": 25, "el": 0, "back": 0, "px": 0, "py": 0}
        frame, hole = self.warp(self.scene, 0, cam, self.auto(self.scene), torch.device("cpu"))
        self.assertGreater(int(hole.sum()), 10)
        pink = frame[hole]
        self.assertTrue(torch.allclose(pink, torch.tensor([1.0, 0.0, 1.0]).expand_as(pink)))

    def test_auto_pivot_is_the_box(self):
        self.assertAlmostEqual(self.auto(self.scene)[2], 2.0, places=4)

    def test_a_tapped_pivot_is_the_spot_tapped(self):
        on_wall = self.resolve(self.scene, {"u": 0.05, "v": 0.05, "t": 0.0})
        self.assertAlmostEqual(on_wall[2], 4.0, places=4)
        self.assertLess(on_wall[0], 0)
        self.assertLess(on_wall[1], 0)

    def test_needs_the_lens(self):
        with self.assertRaises(ValueError):
            self.prepare({"image": torch.zeros(1, 4, 4, 3), "depth": torch.ones(1, 4, 4)})


@unittest.skipIf(torch is None, "needs torch")
class NodeTests(unittest.TestCase):
    def test_run_returns_guide_holes_and_the_scene(self):
        temp = tempfile.mkdtemp()
        stub = types.ModuleType("folder_paths")
        stub.get_temp_directory = lambda: temp

        def get_save_image_path(prefix, folder, w, h):
            return folder, prefix, 1, "", prefix

        stub.get_save_image_path = get_save_image_path
        sys.modules["folder_paths"] = stub
        import nodes.node_camera_move as node_module
        from nodes.node_camera_move import UI_KEY, AusBossCameraMove

        node_module._device = lambda: torch.device("cpu")

        out = AusBossCameraMove().run(_wall_and_box(frames=4), default_camera_text())
        guide, holes = out["result"]
        self.assertEqual(tuple(guide.shape), (4, 48, 64, 3))
        self.assertEqual(tuple(holes.shape), (4, 48, 64))
        self.assertEqual(float(holes[0].sum()), 0.0)  # the first key is your own shot
        self.assertGreater(float(holes[-1].sum()), 0.0)
        info = out["ui"][UI_KEY][0]
        self.assertEqual((info["w"], info["h"], info["count"]), (64, 48, 4))
        self.assertEqual(len(info["frames"]), 4)
        for frame in info["frames"]:
            self.assertTrue((Path(temp) / frame["color"]["filename"]).is_file())
            self.assertTrue((Path(temp) / frame["depth"]["filename"]).is_file())
        json.dumps(info)


if __name__ == "__main__":
    unittest.main()
