from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

import av
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._audio_trim_helpers import audio_window, decode_audio_window

RATE = 8000


def write_ramp(path: Path, seconds: float) -> None:
    """A mono wav whose sample value tells the second it was written at."""
    samples = int(seconds * RATE)
    data = (np.arange(samples, dtype=np.float32) / RATE / 100.0).reshape(1, -1)
    with av.open(str(path), "w") as container:
        stream = container.add_stream("pcm_f32le", rate=RATE, layout="mono")
        frame = av.AudioFrame.from_ndarray(data, format="flt", layout="mono")
        frame.sample_rate = RATE
        for packet in stream.encode(frame):
            container.mux(packet)
        for packet in stream.encode(None):
            container.mux(packet)


class AudioWindowTests(unittest.TestCase):
    def test_open_end_stays_open_until_the_length_is_known(self):
        self.assertEqual(audio_window(2, 0)["end"], None)
        self.assertEqual(audio_window(2, 0, duration=40)["end"], 40)

    def test_max_keeps_the_start_and_cuts_the_rest(self):
        window = audio_window(8, 30, 15, duration=40)
        self.assertEqual((window["start"], window["end"], window["cut"]), (8, 23, 7))

    def test_max_longer_than_the_pick_changes_nothing(self):
        window = audio_window(8, 12, 15, duration=40)
        self.assertEqual((window["end"], window["cut"]), (12, 0))

    def test_max_with_an_open_end_caps_it(self):
        self.assertEqual(audio_window(5, 0, 10)["end"], 15)

    def test_bad_values_fall_back(self):
        window = audio_window("x", None, float("nan"), duration=10)
        self.assertEqual((window["start"], window["end"], window["cut"]), (0, 10, 0))

    def test_end_before_start_is_an_empty_pick(self):
        window = audio_window(6, 4, duration=10)
        self.assertEqual(window["end"], 6)


class DecodeTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.path = Path(self.folder.name, "ramp.wav")
        write_ramp(self.path, 10.0)

    def tearDown(self):
        self.folder.cleanup()

    def test_takes_exactly_the_pick(self):
        audio = decode_audio_window(self.path, 2.0, 5.0)
        waveform = audio["waveform"]
        self.assertEqual(audio["sample_rate"], RATE)
        self.assertEqual(tuple(waveform.shape), (1, 1, 3 * RATE))
        self.assertAlmostEqual(float(waveform[0, 0, 0]) * 100, 2.0, places=3)

    def test_max_cuts_the_end(self):
        audio = decode_audio_window(self.path, 1.0, 9.0, 2.5)
        self.assertEqual(audio["waveform"].shape[-1], int(2.5 * RATE))

    def test_open_end_runs_to_the_end_of_the_file(self):
        audio = decode_audio_window(self.path, 7.5, 0.0)
        self.assertEqual(audio["waveform"].shape[-1], int(2.5 * RATE))

    def test_start_past_the_end_says_so(self):
        with self.assertRaisesRegex(ValueError, "past the end"):
            decode_audio_window(self.path, 12.0, 0.0)


if __name__ == "__main__":
    unittest.main()
