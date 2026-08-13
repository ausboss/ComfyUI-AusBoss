from __future__ import annotations

import tempfile
import unittest
from fractions import Fraction
from pathlib import Path
import sys

import numpy as np
import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

import av

from nodes._video_load_helpers import (
    LazyAudio,
    decode_audio_range,
    decode_video_range,
    lazy_audio_range,
    memory_budget_error,
    output_size,
    trim_window,
)

FPS = 12
FRAMES = 24
WIDTH, HEIGHT = 64, 48
AUDIO_RATE = 32000


def write_test_video(path: Path, with_audio: bool) -> None:
    with av.open(str(path), "w") as container:
        video = container.add_stream("mpeg4", rate=FPS)
        video.width, video.height = WIDTH, HEIGHT
        video.pix_fmt = "yuv420p"
        audio = container.add_stream("aac", rate=AUDIO_RATE) if with_audio else None
        for index in range(FRAMES):
            level = min(255, index * 10)
            array = np.full((HEIGHT, WIDTH, 3), level, dtype=np.uint8)
            frame = av.VideoFrame.from_ndarray(array, format="rgb24")
            for packet in video.encode(frame):
                container.mux(packet)
        for packet in video.encode():
            container.mux(packet)
        if audio is not None:
            samples = AUDIO_RATE * FRAMES // FPS
            tone = (0.2 * np.sin(np.linspace(0, 880 * np.pi, samples))).astype(np.float32)
            audio_frame = av.AudioFrame.from_ndarray(tone.reshape(1, -1), format="flt", layout="mono")
            audio_frame.sample_rate = AUDIO_RATE
            audio_frame.time_base = Fraction(1, AUDIO_RATE)
            audio_frame.pts = 0
            for packet in audio.encode(audio_frame):
                container.mux(packet)
            for packet in audio.encode():
                container.mux(packet)


class VideoLoadHelperTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.video = Path(cls._tmp.name) / "clip.mp4"
        cls.silent = Path(cls._tmp.name) / "silent.mp4"
        write_test_video(cls.video, with_audio=True)
        write_test_video(cls.silent, with_audio=False)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def test_full_decode_shape_fps_and_brightness_ramp(self):
        frames, fps = decode_video_range(self.video, 0.0, 0.0, 0, 0)
        self.assertEqual(tuple(frames.shape), (FRAMES, HEIGHT, WIDTH, 3))
        self.assertAlmostEqual(fps, FPS, places=3)
        self.assertLess(float(frames[0].mean()), float(frames[-1].mean()))

    def test_trim_window_selects_the_middle_second(self):
        frames, fps = decode_video_range(self.video, 0.5, 1.5, 0, 0)
        self.assertEqual(frames.shape[0], FPS)
        # Frame at t=0.5 is index 6 (brightness 60/255); allow codec loss.
        self.assertAlmostEqual(float(frames[0].mean()), 60 / 255, delta=0.08)

    def test_single_custom_dimension_preserves_aspect(self):
        frames, _fps = decode_video_range(self.video, 0.0, 0.0, 32, 0)
        self.assertEqual((frames.shape[2], frames.shape[1]), (32, 24))

    def test_audio_window_matches_duration(self):
        result = decode_audio_range(self.video, 0.5, 1.5)
        waveform, rate = result["waveform"], result["sample_rate"]
        self.assertEqual(rate, AUDIO_RATE)
        self.assertEqual(waveform.ndim, 3)
        self.assertAlmostEqual(waveform.shape[-1] / rate, 1.0, delta=0.05)
        self.assertGreater(float(waveform.abs().max()), 0.0)

    def test_silent_fallback_for_video_without_audio_track(self):
        result = decode_audio_range(self.silent, 0.0, 2.0)
        self.assertEqual(float(result["waveform"].abs().max()), 0.0)
        self.assertAlmostEqual(
            result["waveform"].shape[-1] / result["sample_rate"], 2.0, delta=0.01
        )

    def test_output_size_rules(self):
        self.assertEqual(output_size(640, 480, 0, 0), (640, 480))
        self.assertEqual(output_size(640, 480, 320, 0), (320, 240))
        self.assertEqual(output_size(640, 480, 0, 240), (320, 240))
        self.assertEqual(output_size(640, 480, 100, 100), (100, 100))

    def test_lazy_audio_defers_the_loader_until_first_key_read(self):
        calls = []

        def loader():
            calls.append(1)
            return {"waveform": torch.zeros((1, 1, 4)), "sample_rate": 22050}

        audio = LazyAudio(loader)
        self.assertEqual(calls, [])  # construction must not decode
        self.assertEqual(audio["sample_rate"], 22050)
        self.assertEqual(len(calls), 1)
        self.assertEqual(audio.get("sample_rate"), 22050)
        self.assertEqual(set(audio), {"waveform", "sample_rate"})
        self.assertEqual(len(audio), 2)
        self.assertEqual(len(calls), 1)  # cached: still a single decode

    def test_lazy_audio_range_matches_the_eager_decode(self):
        lazy = lazy_audio_range(self.video, 0.5, 1.5)
        eager = decode_audio_range(self.video, 0.5, 1.5)
        self.assertEqual(lazy["sample_rate"], eager["sample_rate"])
        self.assertTrue(torch.equal(lazy["waveform"], eager["waveform"]))

    def test_memory_budget_allows_batches_inside_the_budget(self):
        # 24 frames at 64x48 = 24 * 48 * 64 * 12 bytes, far under 1 GB.
        self.assertIsNone(memory_budget_error(24, 64, 48, 1_000_000_000))

    def test_memory_budget_blocks_oversized_batches_with_a_clear_error(self):
        # 3000 frames at 1920x1080 needs ~74.6 GB float32.
        message = memory_budget_error(3000, 1920, 1080, 16_000_000_000)
        self.assertIsNotNone(message)
        self.assertIn("3000", message)
        self.assertIn("74.6 GB", message)
        self.assertIn("16.0 GB", message)
        self.assertIn("custom_width", message)
        self.assertIn("shorter", message)

    def test_memory_budget_applies_the_safety_factor(self):
        needed = 10 * 8 * 8 * 3 * 4
        self.assertIsNone(memory_budget_error(10, 8, 8, needed * 2))
        self.assertIsNotNone(memory_budget_error(10, 8, 8, needed))  # 0.8 * needed < needed

    def test_memory_budget_fails_soft_without_availability_data(self):
        self.assertIsNone(memory_budget_error(10**9, 4096, 4096, None))
        self.assertIsNone(memory_budget_error(10**9, 4096, 4096, 0))
        self.assertIsNone(memory_budget_error(0, 4096, 4096, 1))
        self.assertIsNone(memory_budget_error(10, 0, 0, 1))

    def test_trim_validation_errors(self):
        with self.assertRaisesRegex(ValueError, "smaller than"):
            trim_window(10.0, 5.0, 5.0)
        with self.assertRaisesRegex(ValueError, "only"):
            trim_window(2.0, 3.0, 0.0)


if __name__ == "__main__":
    unittest.main()
