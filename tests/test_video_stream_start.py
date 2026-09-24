"""Videos whose stream does not start at 0 s.

Transport streams (.mts/.m2ts/.mpg) open about 1.4 s in, and an MP4/MOV edit
list or a leading audio track can delay the picture too. Every trim window,
frame index, duration and audio cut in the pack counts from the video's first
frame, so these clips must load exactly like the same pictures starting at 0.
"""

from __future__ import annotations

import asyncio
import sys
import tempfile
import unittest
import unittest.mock
from fractions import Fraction
from pathlib import Path
from types import SimpleNamespace

import av
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _media_helpers, node_load_video
from nodes._media_helpers import decode_video_frame, stream_origin, stream_seconds, video_metadata
from nodes._video_load_helpers import core_trimmed_video, decode_audio_range, decode_video_range
from nodes.node_video_crop_rotate_pad import AusBossVideoCropRotatePad
from nodes.node_video_crop_rotate_pad_clip import AusBossVideoCropRotatePadClip
from test_video_load_helpers import ensure_core_video_api, frame_window_seconds

FPS = 24
FRAMES = 72  # 3 s
WIDTH, HEIGHT = 64, 48
AUDIO_RATE = 8000
SAMPLES = AUDIO_RATE * FRAMES // FPS
CLOCK = Fraction(1, 90000)


def level(index: int) -> int:
    return 8 + 3 * index


def frame_number(image) -> int:
    """Which frame a brightness-coded picture (HWC, 0..1 floats) shows."""
    return round((float(np.asarray(image, dtype=np.float32).mean()) * 255 - 8) / 3)


def ramp(sample: int) -> float:
    return 0.05 + 0.85 * sample / SAMPLES


def ramp_sample(value: float) -> float:
    """The source audio sample a ramp value came from."""
    return (float(value) - 0.05) / 0.85 * SAMPLES


def _mux(container, packets, shift: int) -> None:
    # The shift goes onto the packets on a 90 kHz clock: an encoder keeps
    # frame times on its own 1/fps grid, which cannot hold a 1.4 s offset.
    for packet in packets:
        if shift and packet.pts is not None and packet.dts is not None:
            base = packet.time_base
            packet.pts = round(packet.pts * base / CLOCK) + shift
            packet.dts = round(packet.dts * base / CLOCK) + shift
            packet.time_base = CLOCK
        container.mux(packet)


def write_clip(path: Path, *, fmt=None, codec="mpeg4", b_frames=0, gop=12,
               video_start=0.0, audio_start=None) -> None:
    """FRAMES brightness-coded frames whose timestamps begin at video_start;
    audio_start adds a PCM ramp (ramp(k) at sample k) beginning there."""
    with av.open(str(path), "w", format=fmt) as container:
        # No scene cuts: every brightness step would otherwise open a GOP.
        video = container.add_stream(codec, rate=FPS, options={"sc_threshold": "1000000000"})
        video.width, video.height, video.pix_fmt = WIDTH, HEIGHT, "yuv420p"
        video.codec_context.gop_size = gop
        video.codec_context.max_b_frames = b_frames
        video.codec_context.bit_rate = 4_000_000
        audio = None
        if audio_start is not None:
            audio = container.add_stream("pcm_s16le", rate=AUDIO_RATE, layout="mono")
        shift = round(Fraction(str(video_start)) / CLOCK)
        for index in range(FRAMES):
            array = np.full((HEIGHT, WIDTH, 3), level(index), dtype=np.uint8)
            frame = av.VideoFrame.from_ndarray(array, format="rgb24")
            frame.pts, frame.time_base = index, Fraction(1, FPS)
            _mux(container, video.encode(frame), shift)
        _mux(container, video.encode(), shift)
        if audio is not None:
            values = (np.array([ramp(k) for k in range(SAMPLES)]) * 32767).astype(np.int16)
            first = round(audio_start * AUDIO_RATE)
            for offset in range(0, SAMPLES, 800):
                chunk = av.AudioFrame.from_ndarray(values[None, offset:offset + 800], format="s16", layout="mono")
                chunk.sample_rate, chunk.time_base = AUDIO_RATE, Fraction(1, AUDIO_RATE)
                chunk.pts = first + offset
                _mux(container, audio.encode(chunk), 0)
            _mux(container, audio.encode(), 0)


def run(result):
    return asyncio.run(result) if asyncio.iscoroutine(result) else result


_FOLDER = None
_ROOTS = None


def setUpModule():
    """Tiny clips: the same pictures, differently placed in time."""
    global _FOLDER, _ROOTS
    _FOLDER = tempfile.TemporaryDirectory()
    folder = Path(_FOLDER.name)
    # MPEG-2 with B-frames in a transport stream, as .mpg/.m2ts carry it;
    # the second has a keyframe only at the top.
    write_clip(folder / "shifted.mts", fmt="mpegts", codec="mpeg2video", b_frames=2, video_start=1.4)
    write_clip(folder / "one_key.mts", fmt="mpegts", codec="mpeg2video", b_frames=2, gop=FRAMES,
               video_start=1.4)
    # An MP4 whose edit list delays the picture.
    write_clip(folder / "edit.mp4", video_start=1.4)
    # Audio from 0 with the picture from 0.5 s, and the other way round.
    write_clip(folder / "lead.mkv", video_start=0.5, audio_start=0.0)
    write_clip(folder / "late.mkv", audio_start=0.5)
    write_clip(folder / "zero.mkv", audio_start=0.0)
    # Local path mode reads only ComfyUI's folders; this one stands in.
    root = folder.resolve()
    _ROOTS = unittest.mock.patch.object(_media_helpers, "_comfy_managed_roots", lambda: [root])
    _ROOTS.start()


def tearDownModule():
    _media_helpers.close_scrub_sessions()
    _ROOTS.stop()
    _FOLDER.cleanup()


class Clips(unittest.TestCase):
    def setUp(self):
        folder = Path(_FOLDER.name)
        self.ts, self.edit = folder / "shifted.mts", folder / "edit.mp4"
        self.lead, self.late, self.zero = folder / "lead.mkv", folder / "late.mkv", folder / "zero.mkv"
        self.shifted = (self.ts, self.edit, self.lead)
        self.every = self.shifted + (self.zero,)

    def tearDown(self):
        _media_helpers.close_scrub_sessions()
        _media_helpers.clear_preview_cache()


class StreamClockTests(Clips):
    def test_fixtures_really_start_late(self):
        for path, earliest in ((self.ts, 1.4), (self.edit, 1.4), (self.lead, 0.5)):
            with self.subTest(path.name), av.open(str(path)) as container:
                self.assertGreater(stream_origin(container.streams.video[0]), earliest - 0.01)

    def test_times_count_from_the_streams_first_frame(self):
        stream = SimpleNamespace(start_time=126000, time_base=CLOCK)
        self.assertAlmostEqual(stream_seconds(1.4, stream), 0.0)
        self.assertAlmostEqual(stream_seconds(2.4, stream), 1.0)
        self.assertIsNone(stream_seconds(None, stream))
        unknown = SimpleNamespace(start_time=None, time_base=CLOCK)
        self.assertEqual(stream_seconds(2.4, unknown), 2.4)

    def test_a_zero_start_file_keeps_its_own_times(self):
        with av.open(str(self.zero)) as container:
            stream = container.streams.video[0]
            self.assertEqual(stream_origin(stream), 0.0)
            for frame in container.decode(stream):
                self.assertEqual(stream_seconds(frame.time, stream), frame.time)

    def test_metadata_is_the_video_streams_own_length(self):
        # lead.mkv's container runs 0-3.5 s around a 3 s picture from 0.5 s.
        for path in self.every:
            with self.subTest(path.name):
                metadata = video_metadata(path)
                self.assertAlmostEqual(metadata["duration"], FRAMES / FPS, delta=0.01)
                self.assertEqual(metadata["frame_count"], FRAMES)
                self.assertAlmostEqual(metadata["fps"], FPS)


class TrimWindowTests(Clips):
    def assert_frames(self, batch, first, last):
        self.assertEqual(int(batch.shape[0]), last - first + 1)
        self.assertEqual(frame_number(batch[0]), first)
        self.assertEqual(frame_number(batch[-1]), last)

    def test_second_windows_keep_their_frames(self):
        for path in self.every:
            with self.subTest(path.name):
                self.assert_frames(decode_video_range(path, 0.0, 2.0, 0, 0)[0], 0, 47)
                self.assert_frames(decode_video_range(path, 1.0, 3.0, 0, 0)[0], 24, 71)
                self.assert_frames(decode_video_range(path, 1.0, 0.0, 0, 0)[0], 24, 71)
                self.assert_frames(decode_video_range(path, 0.0, 0.0, 0, 0)[0], 0, 71)

    def test_a_single_keyframe_transport_stream_trims_and_seeks(self):
        # A seek anywhere past the top used to leave its decoder nothing to
        # show: "Load Video found no frames".
        path = Path(_FOLDER.name) / "one_key.mts"
        self.assert_frames(decode_video_range(path, 1.0, 3.0, 0, 0)[0], 24, 71)
        for target in (40, 0, 71):
            image, index, _ = decode_video_frame(path, "frame index", target, 0.0)
            self.assertEqual((index, frame_number(np.asarray(image.convert("RGB")) / 255.0)), (target, target))

    def test_timeline_frame_windows_round_trip(self):
        # Windows that open between keyframes: the transport stream's seek
        # lands on a packet before the target, not on a keyframe.
        for path in self.every:
            for first, last in [(1, 1), (5, 30), (13, 13), (23, 40), (37, 71), (70, 71)]:
                with self.subTest(path.name, first=first, last=last):
                    start, end = frame_window_seconds(FPS, FRAMES, first, last)
                    self.assert_frames(decode_video_range(path, start, end, 0, 0)[0], first, last)


class FrameIndexTests(Clips):
    def test_preview_reports_the_frame_it_shows(self):
        # Backward jumps re-seek; the short steps forward decode on.
        for path in self.every:
            for target in (0, 12, 13, 47, 71, 5, 30, 0):
                with self.subTest(path.name, target=target):
                    image, index, moment = decode_video_frame(path, "frame index", target, 0.0)
                    self.assertEqual(index, target)
                    self.assertAlmostEqual(moment, target / FPS, delta=1e-3)
                    self.assertEqual(frame_number(np.asarray(image.convert("RGB")) / 255.0), target)

    def test_time_mode_counts_from_the_first_frame(self):
        for path in self.every:
            with self.subTest(path.name):
                image, index, moment = decode_video_frame(path, "time seconds", 0, 1.0)
                self.assertEqual((index, frame_number(np.asarray(image.convert("RGB")) / 255.0)), (24, 24))
                self.assertAlmostEqual(moment, 1.0, delta=1e-3)

    def test_frame_node_outputs_the_frame_asked_for(self):
        # The editor writes the index the frame route reports back into
        # frame_index, so the next run must land on the same picture.
        for path in self.every:
            with self.subTest(path.name):
                node = AusBossVideoCropRotatePad()
                original = node.load_transform("", "local path", str(path), "frame index", 12, 0.0)[3]
                self.assertEqual(frame_number(original[0]), 12)
                _, index, moment = _media_helpers.cached_preview(path, "frame index", 12, 0.0, 640, 640)
                self.assertEqual(index, 12)
                self.assertAlmostEqual(moment, 12 / FPS, delta=1e-3)
                again = node.load_transform("", "local path", str(path), "frame index", index, 0.0)[3]
                self.assertEqual(frame_number(again[0]), 12)

    def test_storyboard_tiles_are_on_the_video_clock(self):
        for path in self.shifted:
            with self.subTest(path.name):
                key = _media_helpers._file_key(path)
                with _media_helpers._STORYBOARDS_LOCK:
                    _media_helpers._STORYBOARDS[key] = {"status": "building"}
                _media_helpers._build_storyboard(path, key)
                times = _media_helpers.storyboard_payload(path)["times"]
                self.assertAlmostEqual(times[0], 0.0, delta=1e-3)
                self.assertLess(times[-1], FRAMES / FPS)


class AudioSyncTests(Clips):
    def test_audio_that_leads_the_picture_is_cut_at_the_first_frame(self):
        # Frame 0 of lead.mkv plays 0.5 s into its audio.
        waveform = decode_audio_range(self.lead, 0.0, 1.0)["waveform"][0, 0]
        self.assertEqual(int(waveform.shape[0]), AUDIO_RATE)
        self.assertAlmostEqual(ramp_sample(waveform[0]), 0.5 * AUDIO_RATE, delta=2)

    def test_audio_that_starts_late_is_preceded_by_silence(self):
        waveform = decode_audio_range(self.late, 0.0, 1.0)["waveform"][0, 0]
        self.assertEqual(int(waveform.shape[0]), AUDIO_RATE)
        onset = int((waveform.abs() > 1e-3).nonzero()[0])
        self.assertAlmostEqual(onset, 0.5 * AUDIO_RATE, delta=2)
        self.assertAlmostEqual(ramp_sample(waveform[onset]), 0, delta=2)
        later = decode_audio_range(self.late, 1.0, 2.0)["waveform"][0, 0]
        self.assertAlmostEqual(ramp_sample(later[0]), 0.5 * AUDIO_RATE, delta=2)

    def test_zero_start_audio_is_unchanged(self):
        waveform = decode_audio_range(self.zero, 0.25, 1.0)["waveform"][0, 0]
        self.assertEqual(int(waveform.shape[0]), round(0.75 * AUDIO_RATE))
        self.assertAlmostEqual(ramp_sample(waveform[0]), 0.25 * AUDIO_RATE, delta=2)


class NodeTests(Clips):
    def load(self, path, start, end):
        with unittest.mock.patch.object(node_load_video, "resolve_input_path", lambda _name: path):
            return run(node_load_video.AusBossLoadVideo().load_video(path.name, start, end, 0, 0))

    def test_load_video_trims_on_the_video_clock(self):
        for path in self.every:
            with self.subTest(path.name):
                frames, _audio, count, fps, _w, _h, duration, _core = self.load(path, 1.0, 3.0)
                self.assertEqual(count, 48)
                self.assertEqual(frame_number(frames[0]), 24)
                self.assertAlmostEqual(duration, 2.0)

    def test_load_video_audio_plays_with_its_frames(self):
        _frames, audio, _count, _fps, _w, _h, duration, _core = self.load(self.lead, 1.0, 2.0)
        waveform = audio["waveform"][0, 0]
        self.assertAlmostEqual(waveform.shape[0] / audio["sample_rate"], duration, delta=1e-3)
        self.assertAlmostEqual(ramp_sample(waveform[0]), 1.5 * AUDIO_RATE, delta=2)

    def test_clip_node_frame_bounds_use_the_video_clock(self):
        node = AusBossVideoCropRotatePadClip()
        for path in self.shifted:
            with self.subTest(path.name):
                out = run(node.load_transform("", "local path", str(path), 0.0, 0.0, start_frame=30, end_frame=54))
                self.assertEqual(out[3], 24)
                self.assertEqual(frame_number(out[9][0]), 30)
                self.assertEqual(frame_number(out[9][-1]), 53)
                fixed = run(node.load_transform("", "local path", str(path), 1.0, 0.0, fixed_frames=24))
                self.assertEqual(frame_number(fixed[9][0]), 24)
                self.assertEqual(fixed[3], 24)

    def test_core_video_covers_the_same_window(self):
        if not ensure_core_video_api(self):
            self.skipTest("Set AUSBOSS_COMFY_ROOT to test ComfyUI's VIDEO type.")
        # Core seeks straight to a timestamp, which a transport stream cannot
        # honour; the MP4 and MKV delays are what the shift has to cover.
        for path in (self.edit, self.lead, self.zero):
            with self.subTest(path.name):
                images = core_trimmed_video(path, 1.0, 2.0).get_components().images
                self.assertEqual(int(images.shape[0]), 24)
                self.assertEqual(frame_number(images[0]), 24)


if __name__ == "__main__":
    unittest.main()
