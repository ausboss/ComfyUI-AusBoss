from __future__ import annotations

from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._interpolate_helpers import (
    BLEND_METHOD,
    FLOW_METHOD,
    FrameJob,
    adjacent_frame_differences,
    apply_scene_cuts,
    backward_warp,
    detect_scene_cuts,
    interpolate_frames,
    is_passthrough,
    method_uses_optical_flow,
    output_frame_count,
    plan_frame_jobs,
    raft_checkpoint_path,
    weighted_blend,
)

CPU = torch.device("cpu")


def solid_batch(values: list[float]) -> torch.Tensor:
    """A BHWC batch where frame i is filled with values[i]."""
    batch = torch.zeros((len(values), 4, 4, 3), dtype=torch.float32)
    for index, value in enumerate(values):
        batch[index] = value
    return batch


class PlannerTests(unittest.TestCase):
    def test_24_to_30_positions(self):
        jobs = plan_frame_jobs(24, 24.0, 30.0)
        self.assertEqual(len(jobs), 30)
        # Every fifth output frame lands exactly on a source frame.
        for job in jobs:
            position = job.output_index * 24.0 / 30.0
            if job.output_index % 5 == 0:
                self.assertTrue(job.is_copy)
                self.assertEqual(job.src_a, round(position))
            elif job.output_index < 29:
                self.assertFalse(job.is_copy)
                self.assertEqual(job.src_a, int(position))
                self.assertEqual(job.src_b, job.src_a + 1)
                self.assertAlmostEqual(job.t, position - int(position), places=6)
        # The tail position (23.2) is past the last pair and holds frame 23.
        self.assertEqual(jobs[29], FrameJob(29, 23, 23, 0.0))

    def test_30_to_24_positions(self):
        jobs = plan_frame_jobs(30, 30.0, 24.0)
        self.assertEqual(len(jobs), 24)
        self.assertEqual(jobs[0], FrameJob(0, 0, 0, 0.0))
        self.assertEqual(jobs[1].src_a, 1)
        self.assertEqual(jobs[1].src_b, 2)
        self.assertAlmostEqual(jobs[1].t, 0.25, places=6)
        for job in jobs:
            if job.output_index % 4 == 0:
                self.assertTrue(job.is_copy)
                self.assertEqual(job.src_a, job.output_index * 5 // 4)
            else:
                self.assertFalse(job.is_copy)

    def test_single_frame_source_holds_it(self):
        jobs = plan_frame_jobs(1, 1.0, 4.0)
        self.assertEqual(len(jobs), 4)
        for job in jobs:
            self.assertEqual(job, FrameJob(job.output_index, 0, 0, 0.0))

    def test_two_frames_upsampled_holds_the_tail(self):
        jobs = plan_frame_jobs(2, 1.0, 4.0)
        self.assertEqual(len(jobs), 8)
        self.assertEqual(jobs[0], FrameJob(0, 0, 0, 0.0))
        self.assertEqual(jobs[2], FrameJob(2, 0, 1, 0.5))
        # Position 1.0 lands on the last frame; everything after holds it.
        for job in jobs[4:]:
            self.assertEqual((job.src_a, job.src_b, job.t), (1, 1, 0.0))

    def test_direct_copies_never_reach_the_interpolation_path(self):
        for jobs in (plan_frame_jobs(24, 24.0, 30.0), plan_frame_jobs(30, 30.0, 24.0)):
            for job in jobs:
                if job.t == 0.0 or job.src_a == job.src_b:
                    self.assertTrue(job.is_copy)
                else:
                    self.assertTrue(0.0 < job.t < 1.0)

    def test_output_frame_count_keeps_duration(self):
        self.assertEqual(output_frame_count(24, 24.0, 30.0), 30)
        self.assertEqual(output_frame_count(30, 30.0, 24.0), 24)
        self.assertEqual(output_frame_count(10, 24.0, 30.0), 12)
        self.assertEqual(output_frame_count(1, 30.0, 30.0), 1)

    def test_bad_inputs_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "empty IMAGE batch"):
            plan_frame_jobs(0, 24.0, 30.0)
        with self.assertRaisesRegex(ValueError, "above zero"):
            plan_frame_jobs(10, 0.0, 30.0)
        with self.assertRaisesRegex(ValueError, "above zero"):
            plan_frame_jobs(10, 24.0, -1.0)


class SceneCutTests(unittest.TestCase):
    def test_adjacent_differences_measure_mean_abs_change(self):
        frames = solid_batch([0.0, 0.1, 0.9])
        differences = adjacent_frame_differences(frames, chunk_size=1)
        self.assertEqual(len(differences), 2)
        self.assertAlmostEqual(differences[0], 0.1, places=5)
        self.assertAlmostEqual(differences[1], 0.8, places=5)

    def test_detect_scene_cuts_thresholds_and_zero_disables(self):
        differences = [0.1, 0.8, 0.2]
        self.assertEqual(detect_scene_cuts(differences, 0.35), {1})
        self.assertEqual(detect_scene_cuts(differences, 0.0), set())
        self.assertEqual(detect_scene_cuts(differences, 0.9), set())

    def test_interpolations_across_a_cut_become_holds(self):
        jobs = [
            FrameJob(0, 0, 0, 0.0),
            FrameJob(1, 0, 1, 0.5),
            FrameJob(2, 1, 2, 0.5),
            FrameJob(3, 2, 2, 0.0),
        ]
        adjusted = apply_scene_cuts(jobs, {1})
        self.assertEqual(adjusted[0], jobs[0])
        self.assertEqual(adjusted[1], jobs[1])
        self.assertEqual(adjusted[2], FrameJob(2, 1, 1, 0.0))
        self.assertEqual(adjusted[3], jobs[3])

    def test_no_cuts_returns_jobs_unchanged(self):
        jobs = [FrameJob(0, 0, 1, 0.5)]
        self.assertEqual(apply_scene_cuts(jobs, set()), jobs)


class BlendAndWarpTests(unittest.TestCase):
    def test_weighted_blend_midpoint(self):
        a = torch.zeros((1, 2, 2, 3))
        b = torch.ones((1, 2, 2, 3))
        mid = weighted_blend(a, b, torch.tensor(0.5))
        self.assertTrue(torch.allclose(mid, torch.full_like(mid, 0.5)))

    def test_weighted_blend_endpoints(self):
        a = torch.full((1, 2, 2, 3), 0.25)
        b = torch.full((1, 2, 2, 3), 0.75)
        self.assertTrue(torch.allclose(weighted_blend(a, b, torch.tensor(0.0)), a))
        self.assertTrue(torch.allclose(weighted_blend(a, b, torch.tensor(1.0)), b))

    def test_backward_warp_zero_flow_is_identity(self):
        images = torch.rand((2, 3, 6, 8))
        flow = torch.zeros((2, 2, 6, 8))
        self.assertTrue(torch.allclose(backward_warp(images, flow), images, atol=1e-5))

    def test_backward_warp_integer_shift_samples_the_neighbor(self):
        images = torch.zeros((1, 1, 1, 4))
        images[0, 0, 0] = torch.tensor([0.0, 1.0, 2.0, 3.0])
        flow = torch.zeros((1, 2, 1, 4))
        flow[:, 0] = 1.0  # sample one pixel to the right, border-padded
        warped = backward_warp(images, flow)
        expected = torch.tensor([1.0, 2.0, 3.0, 3.0])
        self.assertTrue(torch.allclose(warped[0, 0, 0], expected, atol=1e-5))


class InterpolateFramesTests(unittest.TestCase):
    def test_passthrough_early_out_returns_the_same_tensor(self):
        frames = solid_batch([0.1, 0.2])
        result, fps = interpolate_frames(frames, 24.0, 24.005, BLEND_METHOD, 0.35, 8, CPU)
        self.assertIs(result, frames)
        self.assertEqual(fps, 24.0)

    def test_blend_midpoints_and_copies(self):
        frames = solid_batch([0.0, 1.0])
        result, fps = interpolate_frames(frames, 12.0, 24.0, BLEND_METHOD, 0.0, 8, CPU)
        self.assertEqual(tuple(result.shape), (4, 4, 4, 3))
        self.assertEqual(fps, 24.0)
        self.assertTrue(torch.allclose(result[0], frames[0]))
        self.assertTrue(torch.allclose(result[1], torch.full_like(result[1], 0.5)))
        self.assertTrue(torch.allclose(result[2], frames[1]))
        self.assertTrue(torch.allclose(result[3], frames[1]))

    def test_scene_cut_holds_instead_of_morphing(self):
        # Frames 0/1 are a gentle ramp; frame 2 is a hard cut to white.
        frames = solid_batch([0.0, 0.1, 1.0])
        result, _fps = interpolate_frames(frames, 12.0, 24.0, BLEND_METHOD, 0.35, 8, CPU)
        self.assertEqual(int(result.shape[0]), 6)
        self.assertTrue(torch.allclose(result[1], torch.full_like(result[1], 0.05)))
        # The frame between 1 and 2 crosses the cut and holds frame 1.
        self.assertTrue(torch.allclose(result[3], frames[1]))
        self.assertTrue(torch.allclose(result[4], frames[2]))

    def test_threshold_zero_blends_across_the_cut(self):
        frames = solid_batch([0.0, 0.1, 1.0])
        result, _fps = interpolate_frames(frames, 12.0, 24.0, BLEND_METHOD, 0.0, 8, CPU)
        self.assertTrue(torch.allclose(result[3], torch.full_like(result[3], 0.55)))

    def test_actual_fps_reports_the_rounded_rate(self):
        frames = solid_batch([float(i) / 10.0 for i in range(10)])
        result, fps = interpolate_frames(frames, 24.0, 30.0, BLEND_METHOD, 0.0, 8, CPU)
        self.assertEqual(int(result.shape[0]), 12)
        self.assertAlmostEqual(fps, 28.8, places=5)

    def test_small_batch_size_matches_a_single_batch(self):
        frames = solid_batch([0.0, 0.25, 0.5, 0.75, 1.0])
        chunked, _ = interpolate_frames(frames, 24.0, 30.0, BLEND_METHOD, 0.0, 2, CPU)
        whole, _ = interpolate_frames(frames, 24.0, 30.0, BLEND_METHOD, 0.0, 64, CPU)
        self.assertTrue(torch.allclose(chunked, whole))

    def test_method_names_are_validated(self):
        self.assertFalse(method_uses_optical_flow(BLEND_METHOD))
        self.assertTrue(method_uses_optical_flow(FLOW_METHOD))
        with self.assertRaisesRegex(ValueError, "does not know the method"):
            method_uses_optical_flow("cubic")

    def test_bad_batches_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "BHWC"):
            interpolate_frames(torch.zeros((2, 2, 3)), 24.0, 30.0, BLEND_METHOD, 0.0, 8, CPU)
        with self.assertRaisesRegex(ValueError, "empty IMAGE batch"):
            interpolate_frames(
                torch.zeros((0, 2, 2, 3)), 24.0, 30.0, BLEND_METHOD, 0.0, 8, CPU
            )

    def test_is_passthrough_boundary(self):
        self.assertTrue(is_passthrough(24.0, 24.0))
        self.assertTrue(is_passthrough(24.0, 24.009))
        self.assertFalse(is_passthrough(24.0, 24.02))


class WeightCacheTests(unittest.TestCase):
    def test_checkpoint_path_uses_the_weights_filename_without_downloading(self):
        weights = SimpleNamespace(
            url="https://download.example/models/raft_small-01064c6d.pth"
        )
        self.assertEqual(
            raft_checkpoint_path(weights, "/tmp/torch-hub"),
            Path("/tmp/torch-hub/checkpoints/raft_small-01064c6d.pth"),
        )

    def test_checkpoint_path_rejects_a_missing_filename(self):
        with self.assertRaisesRegex(RuntimeError, "checkpoint URL"):
            raft_checkpoint_path(SimpleNamespace(url=""), "/tmp/torch-hub")


class FrameInterpolateNodeTests(unittest.TestCase):
    def test_node_returns_frames_and_fps(self):
        from nodes.node_frame_interpolate import AusBossFrameInterpolate

        frames = solid_batch([0.0, 1.0])
        images, fps = AusBossFrameInterpolate().interpolate(
            frames, 12.0, 24.0, BLEND_METHOD, 0.35, 8
        )
        self.assertEqual(int(images.shape[0]), 4)
        self.assertEqual(fps, 24.0)


if __name__ == "__main__":
    unittest.main()
