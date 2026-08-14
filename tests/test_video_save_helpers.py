from __future__ import annotations

import asyncio
import inspect
import tempfile
import threading
import time
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
from nodes import _video_save_helpers, node_save_video


def gradient_batch(count: int, height: int, width: int) -> torch.Tensor:
    ramp = torch.linspace(0.0, 1.0, count).view(-1, 1, 1, 1)
    return ramp.expand(count, height, width, 3).clone()


# Types the frontend renders as a widget rather than a socket. Everything else
# in a node definition gets a slot, and slots are numbered by walking required
# then optional - the numbering saved workflows store in their links.
WIDGET_TYPES = {"INT", "FLOAT", "STRING", "BOOLEAN"}


def definition_sockets(spec: dict) -> list[tuple[str, str]]:
    """(name, type) per socket, in the order the frontend numbers them."""
    return [
        (name, definition[0])
        for group in ("required", "optional")
        for name, definition in spec.get(group, {}).items()
        if isinstance(definition[0], str) and definition[0] not in WIDGET_TYPES
    ]


def definition_widgets(spec: dict) -> list[tuple[str, str, dict]]:
    """(name, type, options) per widget, in saved widgets_values order."""
    return [
        (name, definition[0], definition[1] if len(definition) > 1 else {})
        for group in ("required", "optional")
        for name, definition in spec.get(group, {}).items()
        if isinstance(definition[0], str) and definition[0] in WIDGET_TYPES
    ]


def tone(samples: int, sample_rate: int = 44100) -> dict:
    """A mono AUDIO dict of `samples` samples, the shape Load Video hands over."""
    wave = (0.3 * np.sin(np.linspace(0, 880 * np.pi, samples))).astype(np.float32)
    return {"waveform": torch.from_numpy(wave).view(1, 1, -1), "sample_rate": sample_rate}


def run_node(result):
    """Run a node FUNCTION result that may be sync or a coroutine."""
    return asyncio.run(result) if asyncio.iscoroutine(result) else result


class FakeInterrupt(BaseException):
    """Mirrors ComfyUI's InterruptProcessingException: not an Exception."""


class RecordingBar:
    def __init__(self):
        self.updates = []

    def update_absolute(self, value, total=None, preview=None):
        self.updates.append((value, total, preview))


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
            result = run_node(node_save_video.AusBossSaveVideo().save(
                frames=gradient_batch(1, 32, 32), fps=24.0, filename_prefix="AusBoss/video", crf=19
            ))

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
            result = run_node(node_save_video.AusBossSaveVideo().save(
                frames=gradient_batch(1, 8, 8), fps=16.0, filename_prefix="AusBoss/video", crf=19,
                video=connected,
            ))

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
            run_node(node_save_video.AusBossSaveVideo().save(
                frames=images, fps=12.0, filename_prefix="AusBoss/video", crf=19
            ))

        _path, encoded_frames, encoded_fps, _audio, _crf, _metadata = encode.call_args.args
        self.assertIs(encoded_frames, images)
        self.assertAlmostEqual(encoded_fps, 12.0)

    def test_the_link_slot_order_saved_workflows_rely_on_is_unchanged(self):
        # Saved workflows address inputs by slot index, and the frontend numbers
        # them by walking required then optional and keeping the link types. A
        # connected video carries its own frames, so frames leads the optional
        # group rather than sitting in required — the slot order must not move.
        spec = node_save_video.AusBossSaveVideo.INPUT_TYPES()
        sockets = [name for name, _type in definition_sockets(spec)]
        self.assertEqual(sockets, ["frames", "audio", "video"])
        self.assertEqual(spec["optional"]["frames"][0], "IMAGE")
        self.assertEqual(spec["optional"]["video"][0], "VIDEO")
        self.assertEqual(list(spec["required"]), ["fps", "filename_prefix", "crf"])

    def test_a_video_alone_encodes_without_a_frames_connection(self):
        images = gradient_batch(4, 16, 16)
        connected = FakeCoreVideo(images, None, Fraction(12, 1))
        with (
            patch.object(node_save_video, "folder_paths", FakeFolderPaths),
            patch.object(node_save_video, "encode_video", return_value=(16, 16, 4)) as encode,
        ):
            run_node(node_save_video.AusBossSaveVideo().save(
                fps=16.0, filename_prefix="AusBoss/video", crf=19, video=connected
            ))

        _path, encoded_frames, encoded_fps, _audio, _crf, _metadata = encode.call_args.args
        self.assertIs(encoded_frames, images)
        self.assertAlmostEqual(encoded_fps, 12.0)

    def test_neither_frames_nor_video_reports_what_to_connect(self):
        with patch.object(node_save_video, "folder_paths", FakeFolderPaths):
            with self.assertRaisesRegex(ValueError, "frames batch or a video"):
                run_node(node_save_video.AusBossSaveVideo().save(
                    fps=16.0, filename_prefix="AusBoss/video", crf=19
                ))


class LegacyWorkflowTests(unittest.TestCase):
    """A workflow saved before frames moved to optional must still load.

    OLD_SHAPE_WORKFLOW is lifted from the Save Video, Load Video and LaMa
    Inpaint nodes of example_workflows/simple_video_watermark_remover.json as
    it was saved when Save Video declared frames in the required group: the
    Save Video node has no video socket at all, frames carries no optional
    shape marker, and its widgets_values is the three-value list of that era.
    """

    maxDiff = None

    SAVE_ID = 10

    OLD_SHAPE_WORKFLOW = {
        "last_node_id": 90,
        "last_link_id": 106,
        "nodes": [
            {
                "id": 11,
                "type": "AUSBOSS_NODES_LoadVideo",
                "inputs": [],
                "outputs": [
                    {"name": "frames", "type": "IMAGE", "links": [89]},
                    {"name": "audio", "type": "AUDIO", "links": [87]},
                    {"name": "frame_count", "type": "INT", "links": []},
                    {"name": "fps", "type": "FLOAT", "links": [106]},
                    {"name": "width", "type": "INT", "links": []},
                    {"name": "height", "type": "INT", "links": []},
                    {"name": "duration", "type": "FLOAT", "links": []},
                ],
                "widgets_values": ["input.mp4", 0.0, 0.0, 0, 0, "image", ""],
            },
            {
                "id": 6,
                "type": "AUSBOSS_NODES_LaMaInpaint",
                "inputs": [
                    {"name": "image", "type": "IMAGE", "link": None},
                    {"name": "mask", "type": "MASK", "link": None},
                ],
                "outputs": [{"name": "image", "type": "IMAGE", "links": [17]}],
                "widgets_values": ["big-lama.pt"],
            },
            {
                "id": SAVE_ID,
                "type": "AUSBOSS_NODES_SaveVideo",
                "inputs": [
                    {"name": "frames", "type": "IMAGE", "link": 17},
                    {"name": "audio", "shape": 7, "type": "AUDIO", "link": 87},
                    {"name": "fps", "type": "FLOAT", "widget": {"name": "fps"}, "link": 106},
                ],
                "outputs": [],
                "properties": {"Node name for S&R": "AUSBOSS_NODES_SaveVideo"},
                "widgets_values": [16.0, "AusBoss/video_watermark_remover", 19],
            },
        ],
        "links": [
            [17, 6, 0, SAVE_ID, 0, "IMAGE"],
            [87, 11, 1, SAVE_ID, 1, "AUDIO"],
            [89, 11, 0, 6, 0, "IMAGE"],
            [106, 11, 3, SAVE_ID, 2, "FLOAT"],
        ],
        "version": 0.4,
    }

    def setUp(self):
        self.spec = node_save_video.AusBossSaveVideo.INPUT_TYPES()
        self.saved = next(
            node for node in self.OLD_SHAPE_WORKFLOW["nodes"] if node["id"] == self.SAVE_ID
        )
        # Widget-driven inputs are appended to the saved slots when the user
        # converts one; the plain sockets are the ones link slots count.
        self.saved_sockets = [slot for slot in self.saved["inputs"] if "widget" not in slot]

    def test_the_old_frames_link_still_resolves_to_the_frames_socket(self):
        link = next(
            link
            for link in self.OLD_SHAPE_WORKFLOW["links"]
            if link[3] == self.SAVE_ID and link[4] == 0
        )
        self.assertEqual((link[5], self.saved["inputs"][link[4]]["name"]), ("IMAGE", "frames"))
        sockets = definition_sockets(self.spec)
        # By index, the way the saved link addresses it.
        self.assertEqual(sockets[link[4]], ("frames", "IMAGE"))
        # And by name, the way the prompt built from the graph addresses it.
        self.assertIn(("frames", "IMAGE"), sockets)

    def test_the_new_video_socket_lands_after_every_slot_the_old_file_indexes(self):
        sockets = definition_sockets(self.spec)
        saved = [(slot["name"], slot["type"]) for slot in self.saved_sockets]
        self.assertEqual(saved, [("frames", "IMAGE"), ("audio", "AUDIO")])
        self.assertEqual(sockets[: len(saved)], saved)
        self.assertEqual(sockets[len(saved) :], [("video", "VIDEO")])
        # The old file predates the video socket entirely.
        self.assertNotIn("video", [slot["name"] for slot in self.saved["inputs"]])

    def test_the_old_widget_values_still_line_up_with_the_current_widgets(self):
        widgets = definition_widgets(self.spec)
        values = self.saved["widgets_values"]
        self.assertEqual(
            [name for name, _type, _options in widgets], ["fps", "filename_prefix", "crf"]
        )
        self.assertEqual(len(values), len(widgets))
        for value, (name, declared, options) in zip(values, widgets):
            with self.subTest(widget=name):
                if declared == "STRING":
                    self.assertIsInstance(value, str)
                    continue
                self.assertIsInstance(value, float if declared == "FLOAT" else int)
                self.assertGreaterEqual(value, options["min"])
                self.assertLessEqual(value, options["max"])

    def test_the_old_workflow_still_drives_a_save(self):
        # Exactly what the saved node hands the backend: widget values by
        # position, then the three linked inputs on top - fps included, since
        # that widget was converted to a socket.
        widgets = definition_widgets(self.spec)
        call = dict(zip([name for name, _type, _options in widgets], self.saved["widgets_values"]))
        frames = gradient_batch(2, 16, 16)
        audio = tone(2048, 16000)
        call.update(frames=frames, audio=audio, fps=24.0)

        with (
            patch.object(node_save_video, "folder_paths", FakeFolderPaths),
            patch.object(node_save_video, "encode_video", return_value=(16, 16, 2)) as encode,
        ):
            result = run_node(node_save_video.AusBossSaveVideo().save(**call))

        _path, encoded_frames, encoded_fps, encoded_audio, crf, _metadata = encode.call_args.args
        self.assertIs(encoded_frames, frames)
        self.assertIs(encoded_audio, audio)
        self.assertAlmostEqual(encoded_fps, 24.0)  # the link, not the 16.0 widget
        self.assertEqual(crf, 19)
        self.assertEqual(result["ui"]["images"][0]["frame_count"], 2)


class AsyncSaveTests(unittest.TestCase):
    def test_the_node_function_is_a_coroutine(self):
        node = node_save_video.AusBossSaveVideo
        self.assertTrue(inspect.iscoroutinefunction(getattr(node, node.FUNCTION)))

    def test_the_event_loop_keeps_running_while_the_encode_blocks(self):
        ticks = 0
        encoded = threading.Event()

        def slow_encode(*_args):
            encoded.set()
            time.sleep(0.05)
            return (32, 32, 1)

        async def drive():
            nonlocal ticks

            async def heartbeat():
                nonlocal ticks
                while True:
                    ticks += 1
                    await asyncio.sleep(0)

            beat = asyncio.ensure_future(heartbeat())
            try:
                with (
                    patch.object(node_save_video, "folder_paths", FakeFolderPaths),
                    patch.object(node_save_video, "encode_video", slow_encode),
                ):
                    await node_save_video.AusBossSaveVideo().save(
                        frames=gradient_batch(1, 32, 32), fps=24.0,
                        filename_prefix="AusBoss/video", crf=19,
                    )
            finally:
                beat.cancel()

        asyncio.run(drive())
        self.assertTrue(encoded.is_set())
        # A blocking encode inside the coroutine would have starved the
        # heartbeat entirely; off the loop it keeps being scheduled.
        self.assertGreater(ticks, 10)

    def test_the_encode_loop_aborts_promptly_on_an_interrupt(self):
        calls = []

        def interrupt_on_the_third_frame():
            calls.append(1)
            if len(calls) > 2:
                raise FakeInterrupt()

        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(
                _video_save_helpers, "raise_if_interrupted", interrupt_on_the_third_frame
            ):
                with self.assertRaises(FakeInterrupt):
                    encode_video(Path(tmp) / "cancelled.mp4", gradient_batch(64, 32, 32), 8.0, None, 23)

        # Stopped on the third frame instead of grinding through all 64.
        self.assertEqual(len(calls), 3)

    def test_the_audio_loop_aborts_on_an_interrupt_too(self):
        # The picture is two frames, so the third check is the first AAC frame
        # of a track that would otherwise take 44 of them.
        calls = []

        def interrupt_once_the_audio_starts():
            calls.append(1)
            if len(calls) > 2:
                raise FakeInterrupt()

        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(
                _video_save_helpers, "raise_if_interrupted", interrupt_once_the_audio_starts
            ):
                with self.assertRaises(FakeInterrupt):
                    encode_video(
                        Path(tmp) / "cancelled.mp4", gradient_batch(2, 32, 32), 8.0, tone(44100), 23
                    )

        self.assertEqual(len(calls), 3)


class EncodeProgressTests(unittest.TestCase):
    def test_every_encoded_frame_advances_the_progress_bar(self):
        bar = RecordingBar()
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(_video_save_helpers, "frame_progress", lambda _total: bar):
                encode_video(Path(tmp) / "tracked.mp4", gradient_batch(9, 32, 32), 8.0, None, 23)

        self.assertEqual([update[0] for update in bar.updates], list(range(1, 10)))
        self.assertTrue(all(update[1] == 9 for update in bar.updates))
        # The in-node player already previews; progress carries no images.
        self.assertTrue(all(update[2] is None for update in bar.updates))

    def test_the_bar_is_asked_for_the_batch_size(self):
        totals = []
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(
                _video_save_helpers, "frame_progress", lambda total: totals.append(total) or None
            ):
                encode_video(Path(tmp) / "sized.mp4", gradient_batch(4, 32, 32), 8.0, None, 23)
        self.assertEqual(totals, [4])

    def test_the_audio_phase_tracks_its_own_aac_frames(self):
        bars = []

        def new_bar(total):
            bars.append((total, RecordingBar()))
            return bars[-1][1]

        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(_video_save_helpers, "frame_progress", new_bar):
                # 4196 samples is four full AAC frames plus a short tail, so the
                # total has to round up or the last chunk goes unreported.
                encode_video(Path(tmp) / "tracked.mp4", gradient_batch(3, 32, 32), 8.0, tone(4196), 23)

        self.assertEqual([total for total, _bar in bars], [3, 5])
        audio = bars[1][1]
        self.assertEqual([update[0] for update in audio.updates], [1, 2, 3, 4, 5])
        self.assertTrue(all(update[1] == 5 for update in audio.updates))
        self.assertTrue(all(update[2] is None for update in audio.updates))

    def test_a_silent_save_never_opens_an_audio_bar(self):
        totals = []
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(
                _video_save_helpers, "frame_progress", lambda total: totals.append(total) or None
            ):
                encode_video(Path(tmp) / "silent.mp4", gradient_batch(2, 32, 32), 8.0, None, 23)
        self.assertEqual(totals, [2])

    def test_a_broken_progress_bar_never_breaks_the_encode(self):
        class BrokenBar:
            def update_absolute(self, *_args, **_kwargs):
                raise RuntimeError("the websocket went away")

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "resilient.mp4"
            with patch.object(_video_save_helpers, "frame_progress", lambda _total: BrokenBar()):
                self.assertEqual(encode_video(path, gradient_batch(4, 32, 32), 8.0, None, 23)[2], 4)
            with av.open(str(path)) as container:
                video = next(s for s in container.streams if s.type == "video")
                self.assertEqual(sum(1 for _ in container.decode(video)), 4)


if __name__ == "__main__":
    unittest.main()
