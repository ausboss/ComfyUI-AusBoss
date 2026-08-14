from __future__ import annotations

import tempfile
import unittest
from fractions import Fraction
from unittest.mock import patch
from pathlib import Path
import sys

import numpy as np
import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

import av

from nodes._video_load_helpers import LazyAudio
from nodes._video_save_helpers import (
    encode_video,
    even_frames,
    resolve_encode_fps,
    video_components,
    workflow_metadata,
)
from nodes import node_save_video


def gradient_batch(count: int, height: int, width: int) -> torch.Tensor:
    ramp = torch.linspace(0.0, 1.0, count).view(-1, 1, 1, 1)
    return ramp.expand(count, height, width, 3).clone()


class FakeComponents:
    def __init__(self, images, audio, frame_rate):
        self.images = images
        self.audio = audio
        self.frame_rate = frame_rate


class FakeCoreVideo:
    """Stands in for a core VIDEO: only get_components is ever duck-typed."""

    def __init__(self, images, audio=None, frame_rate=Fraction(24000, 1001)):
        self.components = FakeComponents(images, audio, frame_rate)

    def get_components(self):
        return self.components


class FakeFolderPaths:
    @staticmethod
    def get_output_directory():
        return "/tmp"

    @staticmethod
    def get_save_image_path(*_args):
        return "/tmp", "video", 3, "AusBoss", "AusBoss/video"


class SaveVideoHelperTests(unittest.TestCase):
    def test_round_trip_preserves_count_fps_size_and_audio(self):
        frames = gradient_batch(12, 48, 64)
        tone = 0.3 * np.sin(np.linspace(0, 880 * np.pi, 32000)).astype(np.float32)
        audio = {"waveform": torch.from_numpy(tone).view(1, 1, -1), "sample_rate": 32000}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "out.mp4"
            width, height, count = encode_video(
                path,
                frames,
                12.0,
                audio,
                19,
                {"prompt": "ausboss-test", "workflow": "ausboss-workflow"},
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
                self.assertEqual(container.metadata.get("prompt"), "ausboss-test")
                self.assertEqual(container.metadata.get("workflow"), "ausboss-workflow")
            mp4 = path.read_bytes()
            self.assertLess(mp4.index(b"moov"), mp4.index(b"mdat"))

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

    def test_output_is_tagged_bt709_limited_range(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "color.mp4"
            encode_video(path, gradient_batch(4, 32, 32), 8.0, None, 23)
            with av.open(str(path)) as container:
                context = next(s for s in container.streams if s.type == "video").codec_context
                # AVCOL_*_BT709 == 1 for primaries, transfer, and matrix.
                self.assertEqual(context.color_primaries, 1)
                self.assertEqual(context.color_trc, 1)
                self.assertEqual(context.colorspace, 1)
                self.assertEqual(context.color_range, 1)  # limited/tv
            # The muxer writes the matching mp4 colr atom (nclx 1/1/1).
            data = path.read_bytes()
            colr = data.find(b"colr")
            self.assertGreater(colr, 0)
            self.assertEqual(data[colr + 4 : colr + 14], b"nclx\x00\x01\x00\x01\x00\x01")

    def test_encode_accepts_load_videos_lazy_audio_mapping(self):
        tone = 0.3 * np.sin(np.linspace(0, 880 * np.pi, 8000)).astype(np.float32)
        audio = LazyAudio(
            lambda: {"waveform": torch.from_numpy(tone).view(1, 1, -1), "sample_rate": 16000}
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "lazy.mp4"
            encode_video(path, gradient_batch(4, 32, 32), 8.0, audio, 23)
            with av.open(str(path)) as container:
                sound = next(s for s in container.streams if s.type == "audio")
                self.assertEqual(sound.rate, 16000)

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

    def test_save_node_returns_preview_metadata(self):
        with (
            patch.object(node_save_video, "folder_paths", FakeFolderPaths),
            patch.object(node_save_video, "encode_video", return_value=(576, 1024, 188)),
        ):
            result = node_save_video.AusBossSaveVideo().save(
                gradient_batch(1, 32, 32), 24.0, "AusBoss/video", 19
            )

        self.assertEqual(result["ui"]["images"], [{
            "filename": "video_00003_.mp4",
            "subfolder": "AusBoss",
            "type": "output",
            "width": 576,
            "height": 1024,
            "frame_count": 188,
            "fps": 24.0,
            "duration": 188 / 24.0,
        }])


class EncodeFpsPrecedenceTests(unittest.TestCase):
    def test_no_video_keeps_the_widget_rate_and_stays_quiet(self):
        self.assertEqual(resolve_encode_fps(16.0, None), (16.0, None))

    def test_a_matching_video_rate_stays_quiet(self):
        fps, notice = resolve_encode_fps(24.0, 24.0)
        self.assertAlmostEqual(fps, 24.0)
        self.assertIsNone(notice)

    def test_a_differing_video_rate_wins_and_is_logged_once(self):
        fps, notice = resolve_encode_fps(16.0, float(Fraction(24000, 1001)))
        self.assertAlmostEqual(fps, 23.976, places=3)
        self.assertIsNotNone(notice)
        self.assertEqual(notice.count("\n"), 0)
        notice.encode("ascii")  # import-time consoles are cp1252 on Windows
        self.assertIn("23.976", notice)
        self.assertIn("16.000", notice)

    def test_rates_inside_the_widget_step_are_not_reported(self):
        self.assertIsNone(resolve_encode_fps(30.0, 30.0004)[1])

    def test_unusable_video_rates_fall_back_to_the_widget(self):
        for rate in (0.0, -5.0, float("nan"), float("inf")):
            self.assertEqual(resolve_encode_fps(12.0, rate), (12.0, None))


class CoreVideoInputTests(unittest.TestCase):
    def test_no_connection_reports_nothing_to_supersede(self):
        self.assertIsNone(video_components(None))

    def test_components_are_unpacked_as_frames_audio_and_fps(self):
        images = gradient_batch(3, 32, 32)
        audio = {"waveform": torch.zeros((1, 1, 16)), "sample_rate": 8000}
        frames, track, fps = video_components(FakeCoreVideo(images, audio, Fraction(30, 1)))
        self.assertIs(frames, images)
        self.assertIs(track, audio)
        self.assertAlmostEqual(fps, 30.0)

    def test_a_video_without_a_track_reports_no_audio(self):
        self.assertIsNone(video_components(FakeCoreVideo(gradient_batch(1, 8, 8)))[1])

    def test_a_non_video_object_is_rejected_with_a_clear_message(self):
        with self.assertRaisesRegex(ValueError, "core VIDEO"):
            video_components(object())

    def test_the_video_input_supersedes_frames_audio_and_the_fps_widget(self):
        images = gradient_batch(5, 32, 32)
        audio = {"waveform": torch.zeros((1, 1, 16)), "sample_rate": 8000}
        connected = FakeCoreVideo(images, audio, Fraction(24000, 1001))
        with (
            patch.object(node_save_video, "folder_paths", FakeFolderPaths),
            patch.object(
                node_save_video, "encode_video", return_value=(32, 32, 5)
            ) as encode,
        ):
            result = node_save_video.AusBossSaveVideo().save(
                gradient_batch(1, 8, 8), 16.0, "AusBoss/video", 19, video=connected
            )

        _path, encoded_frames, encoded_fps, encoded_audio, _crf, _metadata = encode.call_args.args
        self.assertIs(encoded_frames, images)
        self.assertIs(encoded_audio, audio)
        self.assertAlmostEqual(encoded_fps, 23.976, places=3)
        self.assertAlmostEqual(result["ui"]["images"][0]["fps"], 23.976, places=3)

    def test_an_unconnected_video_leaves_the_frames_path_untouched(self):
        images = gradient_batch(2, 8, 8)
        with (
            patch.object(node_save_video, "folder_paths", FakeFolderPaths),
            patch.object(
                node_save_video, "encode_video", return_value=(8, 8, 2)
            ) as encode,
        ):
            node_save_video.AusBossSaveVideo().save(images, 12.0, "AusBoss/video", 19)

        _path, encoded_frames, encoded_fps, _audio, _crf, _metadata = encode.call_args.args
        self.assertIs(encoded_frames, images)
        self.assertAlmostEqual(encoded_fps, 12.0)

    def test_the_video_input_is_optional_and_declared_after_audio(self):
        optional = node_save_video.AusBossSaveVideo.INPUT_TYPES()["optional"]
        self.assertEqual(list(optional), ["audio", "video"])
        self.assertEqual(optional["video"][0], "VIDEO")
        required = node_save_video.AusBossSaveVideo.INPUT_TYPES()["required"]
        self.assertEqual(list(required), ["frames", "fps", "filename_prefix", "crf"])


if __name__ == "__main__":
    unittest.main()
