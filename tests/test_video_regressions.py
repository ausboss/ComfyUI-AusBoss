"""Concurrency, cancellation and timing regressions using CPU media only."""

import asyncio
from fractions import Fraction
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

import av
import numpy as np
import torch
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from nodes import _media_helpers as media
from nodes import _video_load_helpers as load
from nodes import _video_save_helpers as save
from nodes import node_save_video as saver


class Interrupted(BaseException):
    pass


class VideoRegressions(unittest.TestCase):
    def test_concurrent_saves_reserve_distinct_destinations(self):
        with tempfile.TemporaryDirectory() as tmp:
            folders = types.SimpleNamespace(
                get_output_directory=lambda: tmp,
                get_save_image_path=lambda *args: (tmp, "video", 1, "", "video"),
            )
            barrier = threading.Barrier(2)
            destinations = []

            def encode(path, *args):
                destinations.append(path)
                barrier.wait(timeout=5)
                path.write_bytes(b"complete")
                return 16, 16, 1

            async def run():
                return await asyncio.gather(*[
                    saver.AusBossSaveVideo().save(12, "video", 19, frames=torch.zeros(1, 16, 16, 3))
                    for _ in range(2)
                ])

            with patch.object(saver, "folder_paths", folders), patch.object(saver, "encode_video", encode):
                results = asyncio.run(run())
            self.assertEqual(len(set(destinations)), 2)
            self.assertEqual({Path(r["result"][0]) for r in results}, set(destinations))

    def test_failed_save_removes_its_reservation(self):
        with tempfile.TemporaryDirectory() as tmp:
            folders = types.SimpleNamespace(
                get_output_directory=lambda: tmp,
                get_save_image_path=lambda *args: (tmp, "video", 1, "", "video"),
            )
            with patch.object(saver, "folder_paths", folders), patch.object(saver, "encode_video", side_effect=Interrupted):
                with self.assertRaises(Interrupted):
                    asyncio.run(saver.AusBossSaveVideo().save(12, "video", 19, frames=torch.zeros(1, 16, 16, 3)))
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_eviction_does_not_close_a_busy_decoder(self):
        class Session:
            def __init__(self, path):
                self.lock = threading.Lock()
                self.last_used = 0
                self.closed = False

            def close(self):
                self.closed = True

        with tempfile.TemporaryDirectory() as tmp:
            paths = [Path(tmp) / str(i) for i in range(4)]
            for path in paths:
                path.touch()
            busy = Session(paths[0])
            busy.lock.acquire()
            sessions = {media._file_key(paths[0]): busy}
            with patch.object(media, "_SESSIONS", sessions), patch.object(media, "_ScrubSession", Session), patch.object(media, "_start_reaper_locked"):
                for path in paths[1:]:
                    media._get_session(path)
                self.assertFalse(busy.closed)
            busy.lock.release()

    def test_interrupted_encoding_publishes_nothing(self):
        calls = 0

        def interrupt():
            nonlocal calls
            calls += 1
            if calls == 4:
                raise Interrupted

        with tempfile.TemporaryDirectory() as tmp, patch.object(save, "raise_if_interrupted", interrupt):
            path = Path(tmp) / "clip.mkv"
            with self.assertRaises(Interrupted):
                save.encode_video(path, torch.zeros(10, 16, 16, 3), 12, None, 19, video_format="mkv ffv1")
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_gif_distributes_centisecond_rounding_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "clip.gif"
            frames = torch.linspace(0, 1, 24).view(24, 1, 1, 1).expand(24, 16, 16, 3)
            save.encode_video(path, frames, 24, None, 19, video_format="gif")
            durations = []
            with Image.open(path) as image:
                for index in range(image.n_frames):
                    image.seek(index)
                    durations.append(image.info.get("duration", 0))
            self.assertEqual(sum(durations), 1000)
            self.assertTrue(all(duration > 0 and duration % 10 == 0 for duration in durations))

    def test_gif_rejects_rates_above_its_timing_grid(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, "100 fps"):
                save.encode_video(Path(tmp) / "clip.gif", torch.zeros(2, 16, 16, 3), 120, None, 19, video_format="gif")

    def test_audio_tail_is_padded(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "audio.mkv"
            with av.open(str(path), "w") as container:
                stream = container.add_stream("pcm_s16le", rate=8000)
                stream.layout = "mono"
                frame = av.AudioFrame.from_ndarray(np.full((1, 4000), 1000, np.int16), format="s16", layout="mono")
                frame.sample_rate = 8000
                frame.pts = 0
                for packet in stream.encode(frame):
                    container.mux(packet)
                for packet in stream.encode():
                    container.mux(packet)
            audio = load.decode_audio_range(path, 0, 2)
            self.assertEqual(audio["waveform"].shape[-1], 2 * audio["sample_rate"])
            self.assertEqual(torch.count_nonzero(audio["waveform"][..., 4000:]).item(), 0)

    def test_audio_checks_cancellation_during_decode(self):
        stream = types.SimpleNamespace(
            type="audio", rate=8000, layout="mono", start_time=0, time_base=Fraction(1, 8000),
        )
        frame = av.AudioFrame.from_ndarray(np.zeros((1, 4000), np.int16), format="s16", layout="mono")
        frame.sample_rate = 8000
        frame.pts = 0
        frame.time_base = Fraction(1, 8000)
        container = types.SimpleNamespace(streams=[stream], decode=lambda _: iter([frame]))
        with patch.object(load.av, "open") as opened, patch.object(load, "raise_if_interrupted", side_effect=[None, Interrupted]) as interrupt:
            opened.return_value.__enter__.return_value = container
            with self.assertRaises(Interrupted):
                load.decode_audio_range(Path("clip.mkv"), 0, 2)
        self.assertEqual(interrupt.call_count, 2)

    def test_audio_seeks_near_a_late_window_on_the_video_clock(self):
        video = types.SimpleNamespace(type="video", start_time=5000, time_base=Fraction(1, 1000))
        audio = types.SimpleNamespace(type="audio", rate=8000, layout="mono", time_base=Fraction(1, 8000))
        with patch.object(load.av, "open") as opened:
            container = opened.return_value.__enter__.return_value
            container.streams = [video, audio]
            container.decode.return_value = iter([])
            load.decode_audio_range(Path("clip.mkv"), 30, 32)
        container.seek.assert_called_once_with(34 * 8000, stream=audio, backward=True)


if __name__ == "__main__":
    unittest.main()
