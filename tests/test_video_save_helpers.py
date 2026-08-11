from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
import sys

import numpy as np
import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

import av

from nodes._video_save_helpers import encode_video, even_frames, workflow_metadata


def gradient_batch(count: int, height: int, width: int) -> torch.Tensor:
    ramp = torch.linspace(0.0, 1.0, count).view(-1, 1, 1, 1)
    return ramp.expand(count, height, width, 3).clone()


class SaveVideoHelperTests(unittest.TestCase):
    def test_round_trip_preserves_count_fps_size_and_audio(self):
        frames = gradient_batch(12, 48, 64)
        tone = 0.3 * np.sin(np.linspace(0, 880 * np.pi, 32000)).astype(np.float32)
        audio = {"waveform": torch.from_numpy(tone).view(1, 1, -1), "sample_rate": 32000}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "out.mp4"
            width, height, count = encode_video(
                path, frames, 12.0, audio, 19, {"comment": "ausboss-test"}
            )
            self.assertEqual((width, height, count), (64, 48, 12))
            with av.open(str(path)) as container:
                video = next(s for s in container.streams if s.type == "video")
                sound = next(s for s in container.streams if s.type == "audio")
                self.assertEqual((video.codec_context.width, video.codec_context.height), (64, 48))
                self.assertAlmostEqual(float(video.average_rate), 12.0, places=3)
                decoded = sum(1 for _ in container.decode(video))
                self.assertEqual(decoded, 12)
                self.assertEqual(sound.rate, 32000)

    def test_long_stereo_clip_survives_header_written_mid_encode(self):
        # Regression: enough frames that x264 emits packets (writing the
        # container header) while encoding is still running, plus stereo
        # 44.1 kHz audio like real phone videos. The audio stream must be
        # created before the header lands or libav dies with SIGFPE.
        frames = gradient_batch(60, 136, 240)
        samples = int(44100 * 60 / 12)
        left = 0.3 * np.sin(np.linspace(0, 880 * np.pi, samples))
        stereo = np.stack([left, -left]).astype(np.float32)
        audio = {"waveform": torch.from_numpy(stereo).unsqueeze(0), "sample_rate": 44100}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "long.mp4"
            encode_video(path, frames, 12.0, audio, 23)
            with av.open(str(path)) as container:
                video = next(s for s in container.streams if s.type == "video")
                sound = next(s for s in container.streams if s.type == "audio")
                self.assertEqual(sum(1 for _ in container.decode(video)), 60)
                self.assertEqual(sound.rate, 44100)
                self.assertEqual(sound.channels, 2)

    def test_fractional_fps_survives_the_container(self):
        frames = gradient_batch(6, 32, 32)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ntsc.mp4"
            encode_video(path, frames, 29.97, None, 23)
            with av.open(str(path)) as container:
                video = next(s for s in container.streams if s.type == "video")
                self.assertAlmostEqual(float(video.average_rate), 29.97, places=2)

    def test_odd_dimensions_are_cropped_even_and_no_audio_is_fine(self):
        frames = gradient_batch(3, 49, 65)
        self.assertEqual(tuple(even_frames(frames).shape), (3, 48, 64, 3))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "odd.mp4"
            width, height, _count = encode_video(path, frames, 8.0, None, 19)
            self.assertEqual((width, height), (64, 48))
            with av.open(str(path)) as container:
                self.assertFalse([s for s in container.streams if s.type == "audio"])

    def test_metadata_and_fps_validation(self):
        meta = workflow_metadata({"1": {}}, {"workflow": {"nodes": []}})
        self.assertIn("prompt", meta)
        self.assertIn("workflow", meta)
        with self.assertRaisesRegex(ValueError, "fps"):
            encode_video(Path("/tmp/never.mp4"), gradient_batch(1, 32, 32), 0.0, None, 19)


if __name__ == "__main__":
    unittest.main()
