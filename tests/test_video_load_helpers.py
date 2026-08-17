from __future__ import annotations

import asyncio
import inspect
import os
import tempfile
import unittest
from fractions import Fraction
from pathlib import Path
from unittest.mock import patch
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
    core_trim_args,
    core_trimmed_video,
    decode_audio_range,
    decode_video_range,
    lazy_audio_range,
    memory_budget_error,
    output_size,
    trim_window,
)
from nodes import _video_load_helpers, node_load_video


def core_video_api_available() -> bool:
    """True when ComfyUI's comfy_api video types import in this interpreter."""
    try:
        import comfy_api.input_impl  # noqa: F401
    except Exception:
        return False
    return True


def ensure_core_video_api(case: unittest.TestCase | None = None) -> bool:
    """Make comfy_api importable when AUSBOSS_COMFY_ROOT points at a ComfyUI
    checkout; appended (never prepended) so ComfyUI's top-level nodes.py can
    never shadow this pack's nodes package.

    ``case`` registers the cleanup that takes the entry back out again. Left
    on sys.path it changes the answer to "is ComfyUI importable?" for every
    test that runs afterwards, which silently flips each `except ImportError`
    fail-soft seam in the pack onto its other branch - the branch the offline
    assertions are not written for.
    """
    if core_video_api_available():
        return True
    root = os.environ.get("AUSBOSS_COMFY_ROOT", "")
    if root and (Path(root) / "comfy_api").is_dir() and root not in sys.path:
        sys.path.append(root)
        if case is not None:
            case.addClassCleanup(_drop_from_sys_path, root)
    return core_video_api_available()


def _drop_from_sys_path(entry: str) -> None:
    while entry in sys.path:
        sys.path.remove(entry)


def run_node(result):
    """Run a node FUNCTION result that may be sync or a coroutine."""
    return asyncio.run(result) if asyncio.iscoroutine(result) else result


class FakeInterrupt(BaseException):
    """Mirrors ComfyUI's InterruptProcessingException: not an Exception."""


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

    def test_every_nth_thins_the_batch(self):
        frames, fps = decode_video_range(self.video, 0.0, 0.0, 0, 0, every_nth=2)
        self.assertEqual(frames.shape[0], FRAMES // 2)
        # The helper reports the source rate; the node divides it.
        self.assertAlmostEqual(fps, FPS, places=3)
        # Kept frames are the even source indices: brightness steps by 20/255.
        self.assertAlmostEqual(
            float(frames[1].mean()) - float(frames[0].mean()), 20 / 255, delta=0.05
        )

    def test_max_frames_caps_the_decode(self):
        frames, _fps = decode_video_range(self.video, 0.0, 0.0, 0, 0, max_frames=5)
        self.assertEqual(frames.shape[0], 5)

    def test_every_nth_and_cap_compose(self):
        frames, _fps = decode_video_range(
            self.video, 0.0, 0.0, 0, 0, every_nth=3, max_frames=4
        )
        self.assertEqual(frames.shape[0], 4)

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


class CoreTrimArgsTests(unittest.TestCase):
    def test_zeroes_pass_through_as_no_trim(self):
        self.assertEqual(core_trim_args(0.0, 0.0), (0.0, 0.0))

    def test_start_and_end_become_start_and_duration(self):
        self.assertEqual(core_trim_args(0.5, 1.5), (0.5, 1.0))

    def test_end_zero_means_until_the_end(self):
        self.assertEqual(core_trim_args(2.0, 0.0), (2.0, 0.0))

    def test_negative_start_clamps_to_zero(self):
        self.assertEqual(core_trim_args(-1.0, 3.0), (0.0, 3.0))

    def test_returns_none_when_the_core_api_is_unavailable(self):
        # Forced, not inferred from the interpreter: reading the real import
        # state made this assertion depend on whether an earlier class had
        # already put ComfyUI on sys.path, so it self-skipped under any
        # runner that reordered the classes and covered nothing.
        with patch.dict(sys.modules, {"comfy_api.input_impl": None}):
            self.assertIsNone(core_trimmed_video(Path("/tmp/never.mp4"), 0.0, 0.0))


class CoreVideoAdapterIntegrationTests(unittest.TestCase):
    """Constructs the core VIDEO adapter against a tiny generated clip.

    Runs only when comfy_api is importable — either natively or via
    AUSBOSS_COMFY_ROOT pointing at a ComfyUI checkout."""

    @classmethod
    def setUpClass(cls):
        if not ensure_core_video_api(cls):
            raise unittest.SkipTest(
                "comfy_api is not importable; set AUSBOSS_COMFY_ROOT to a ComfyUI checkout"
            )
        cls._tmp = tempfile.TemporaryDirectory()
        cls.video = Path(cls._tmp.name) / "clip.mp4"
        write_test_video(cls.video, with_audio=True)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def test_trimmed_adapter_reads_metadata_without_decoding_frames(self):
        video = core_trimmed_video(self.video, 0.5, 1.5)
        self.assertIsNotNone(video)
        # get_components materializes every frame; blocking it proves the
        # metadata reads stay decode-free.
        with patch.object(
            type(video), "get_components", side_effect=AssertionError("decoded all frames")
        ):
            self.assertEqual(video.get_dimensions(), (WIDTH, HEIGHT))
            self.assertAlmostEqual(video.get_duration(), 1.0, delta=0.15)
            self.assertAlmostEqual(float(video.get_frame_rate()), FPS, delta=0.01)

    def test_trimmed_adapter_components_cover_the_requested_window(self):
        video = core_trimmed_video(self.video, 0.5, 1.5)
        components = video.get_components()
        self.assertAlmostEqual(int(components.images.shape[0]), FPS, delta=2)
        self.assertEqual(
            (int(components.images.shape[2]), int(components.images.shape[1])),
            (WIDTH, HEIGHT),
        )
        self.assertAlmostEqual(float(components.frame_rate), FPS, delta=0.01)

    def test_untrimmed_adapter_spans_the_whole_clip(self):
        video = core_trimmed_video(self.video, 0.0, 0.0)
        self.assertAlmostEqual(video.get_duration(), FRAMES / FPS, delta=0.15)


class LoadVideoNodeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.video = Path(cls._tmp.name) / "clip.mp4"
        write_test_video(cls.video, with_audio=True)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def test_video_output_is_appended_after_the_original_seven(self):
        node = node_load_video.AusBossLoadVideo
        self.assertEqual(
            node.RETURN_TYPES,
            ("IMAGE", "AUDIO", "INT", "FLOAT", "INT", "INT", "FLOAT", "VIDEO"),
        )
        self.assertEqual(
            node.RETURN_NAMES,
            ("frames", "audio", "frame_count", "fps", "width", "height", "duration", "video"),
        )
        self.assertEqual(len(node.OUTPUT_TOOLTIPS), len(node.RETURN_TYPES))

    def test_node_returns_the_trimmed_window_plus_a_core_video(self):
        result = run_node(
            node_load_video.AusBossLoadVideo().load_video(str(self.video), 0.5, 1.5, 0, 0)
        )
        self.assertEqual(len(result), 8)
        frames, _audio, frame_count, fps, width, height, duration, core_video = result
        self.assertEqual(frame_count, int(frames.shape[0]))
        self.assertEqual((width, height), (WIDTH, HEIGHT))
        self.assertAlmostEqual(fps, FPS, places=3)
        self.assertAlmostEqual(duration, 1.0, delta=0.2)
        if core_video_api_available():
            self.assertAlmostEqual(core_video.get_duration(), 1.0, delta=0.15)
        else:
            self.assertIsNone(core_video)

    def test_the_node_function_is_a_coroutine(self):
        node = node_load_video.AusBossLoadVideo
        self.assertTrue(inspect.iscoroutinefunction(getattr(node, node.FUNCTION)))

    def test_the_event_loop_keeps_running_while_the_decode_blocks(self):
        ticks = 0

        async def drive():
            nonlocal ticks

            async def heartbeat():
                nonlocal ticks
                while True:
                    ticks += 1
                    await asyncio.sleep(0)

            beat = asyncio.ensure_future(heartbeat())
            try:
                return await node_load_video.AusBossLoadVideo().load_video(
                    str(self.video), 0.0, 0.0, 0, 0
                )
            finally:
                beat.cancel()

        with patch.object(node_load_video, "resolve_input_path", lambda _name: self.video):
            result = asyncio.run(drive())

        self.assertEqual(int(result[2]), FRAMES)
        # A blocking decode inside the coroutine would have starved the
        # heartbeat entirely; off the loop it keeps being scheduled.
        self.assertGreater(ticks, 10)


class RecordingBar:
    def __init__(self):
        self.updates = []

    def update_absolute(self, value, total=None, preview=None):
        self.updates.append((value, total, preview))


class DecodeLoopTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.video = Path(cls._tmp.name) / "clip.mp4"
        write_test_video(cls.video, with_audio=False)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def test_every_decoded_frame_advances_the_progress_bar(self):
        bar = RecordingBar()
        with patch.object(_video_load_helpers, "frame_progress", lambda _total: bar):
            frames, _fps = decode_video_range(self.video, 0.0, 0.0, 0, 0)

        count = int(frames.shape[0])
        self.assertEqual(count, FRAMES)
        self.assertEqual([update[0] for update in bar.updates], list(range(1, count + 1)))
        self.assertTrue(all(update[1] >= count for update in bar.updates))
        # The in-node player already previews; progress carries no images.
        self.assertTrue(all(update[2] is None for update in bar.updates))

    def test_an_unknown_frame_total_skips_tracking_without_a_bar(self):
        totals = []
        with patch.object(
            _video_load_helpers, "frame_progress", lambda total: totals.append(total) or None
        ):
            frames, _fps = decode_video_range(self.video, 0.0, 0.0, 0, 0)
        self.assertEqual(int(frames.shape[0]), FRAMES)
        self.assertEqual(len(totals), 1)

    def test_a_broken_progress_bar_never_breaks_the_decode(self):
        class BrokenBar:
            def update_absolute(self, *_args, **_kwargs):
                raise RuntimeError("the websocket went away")

        with patch.object(_video_load_helpers, "frame_progress", lambda _total: BrokenBar()):
            frames, _fps = decode_video_range(self.video, 0.0, 0.0, 0, 0)
        self.assertEqual(int(frames.shape[0]), FRAMES)

    def test_the_decode_loop_aborts_promptly_on_an_interrupt(self):
        calls = []

        def interrupt_on_the_third_frame():
            calls.append(1)
            if len(calls) > 2:
                raise FakeInterrupt()

        with patch.object(
            _video_load_helpers, "raise_if_interrupted", interrupt_on_the_third_frame
        ):
            with self.assertRaises(FakeInterrupt):
                decode_video_range(self.video, 0.0, 0.0, 0, 0)

        # Stopped on the third frame instead of decoding all 24.
        self.assertEqual(len(calls), 3)


if __name__ == "__main__":
    unittest.main()
