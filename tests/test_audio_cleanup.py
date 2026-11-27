from __future__ import annotations

import asyncio
import math
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import av
import numpy as np
import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._audio_cleanup_helpers import (
    PEAK_CEILING_DB,
    TARGET_LUFS,
    clean_up_voice,
    integrated_loudness,
)

RATE = 16000


def seconds(n: float) -> int:
    return int(n * RATE)


def voice_like(length: float, rng: np.random.Generator) -> np.ndarray:
    """A buzzy vowel at 150 Hz with a syllable rhythm: something with the
    harmonics and the stops a voice has."""
    t = np.arange(seconds(length)) / RATE
    tone = sum(np.sin(2 * np.pi * 150 * k * t) / k for k in range(1, 20))
    rhythm = np.clip(np.sin(2 * np.pi * 3.0 * t), 0, None) ** 0.5
    return (0.2 * tone * rhythm).astype(np.float32)


def sound(*channels: np.ndarray, rate: int = RATE) -> dict:
    data = np.stack(channels).astype(np.float32)
    return {"waveform": torch.from_numpy(data).unsqueeze(0), "sample_rate": rate}


def band_level(signal: np.ndarray, low: float, high: float) -> float:
    spectrum = np.abs(np.fft.rfft(signal)) ** 2
    hz = np.fft.rfftfreq(signal.size, 1 / RATE)
    return 10 * math.log10(spectrum[(hz >= low) & (hz < high)].sum() + 1e-20)


class CleanUpTests(unittest.TestCase):
    def setUp(self):
        self.rng = np.random.default_rng(7)

    def test_comes_out_as_one_channel_at_the_same_rate(self):
        voice = voice_like(2.0, self.rng)
        out = clean_up_voice(sound(voice, voice * 0.5, rate=RATE))
        self.assertEqual(out["sample_rate"], RATE)
        self.assertEqual(out["waveform"].shape[:2], (1, 1))

    def test_cuts_quiet_ends_and_keeps_a_short_pad(self):
        quiet = np.zeros(seconds(1.5), dtype=np.float32)
        voice = voice_like(2.0, self.rng)
        noisy = np.concatenate([quiet, voice, quiet, quiet])
        noisy = noisy + self.rng.normal(0, 1e-4, noisy.size).astype(np.float32)
        out = clean_up_voice(sound(noisy))["waveform"][0, 0]
        length = out.shape[-1] / RATE
        self.assertLess(length, 2.6)
        self.assertGreater(length, 1.9)

    def test_level_is_even_and_never_clips(self):
        ceiling = 10 ** (PEAK_CEILING_DB / 20)
        for scale in (0.05, 0.2, 4.0):  # very quiet, quiet, clipping hot
            out = clean_up_voice(sound(voice_like(3.0, self.rng) * scale))["waveform"][0, 0]
            self.assertLessEqual(float(out.abs().max()), ceiling + 1e-6)
            self.assertAlmostEqual(integrated_loudness(out, RATE), TARGET_LUFS, delta=1.5)

    def test_takes_out_rumble_and_hum(self):
        voice = voice_like(3.0, self.rng)
        t = np.arange(voice.size) / RATE
        hum = (0.05 * np.sin(2 * np.pi * 30 * t) + 0.05 * np.sin(2 * np.pi * 50 * t)).astype(np.float32)
        before = voice + hum
        out = clean_up_voice(sound(before))["waveform"][0, 0].numpy()
        # Under 60 Hz against the voice's own 150 Hz and up, before and after.
        gap_before = band_level(before, 140, 4000) - band_level(before, 20, 60)
        gap_after = band_level(out, 140, 4000) - band_level(out, 20, 60)
        self.assertGreater(gap_after - gap_before, 12)

    def test_turns_down_hiss_between_words(self):
        voice = voice_like(4.0, self.rng)
        hiss = self.rng.normal(0, 0.01, voice.size).astype(np.float32)
        before = voice + hiss
        out = clean_up_voice(sound(before))["waveform"][0, 0].numpy()

        def floor_gap(signal: np.ndarray) -> float:
            frames = signal[: signal.size // 320 * 320].reshape(-1, 320)
            levels = 10 * np.log10((frames**2).mean(axis=1) + 1e-20)
            return float(levels.max() - np.quantile(levels, 0.1))

        self.assertGreater(floor_gap(out) - floor_gap(before), 6)

    def test_silence_and_tiny_sounds_pass_without_error(self):
        silent = clean_up_voice(sound(np.zeros(seconds(1.0), dtype=np.float32)))["waveform"]
        self.assertEqual(float(silent.abs().max()), 0.0)
        short = clean_up_voice(sound(voice_like(0.05, self.rng)))["waveform"]
        self.assertTrue(torch.isfinite(short).all())
        empty = clean_up_voice(sound(np.zeros(0, dtype=np.float32)))["waveform"]
        self.assertEqual(tuple(empty.shape), (1, 1, 0))

    def test_loudness_meter_reads_a_full_scale_tone_as_broadcast_meters_do(self):
        # A 997 Hz sine at 0 dBFS reads -3.01 LUFS on a BS.1770 meter.
        t = np.arange(seconds(3.0)) / RATE
        tone = torch.from_numpy(np.sin(2 * np.pi * 997 * t).astype(np.float32))
        self.assertAlmostEqual(integrated_loudness(tone, RATE), -3.01, delta=0.1)


class NodeTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.path = Path(self.folder.name, "voice.wav")
        rng = np.random.default_rng(3)
        voice = voice_like(2.0, rng)
        quiet = np.zeros(seconds(1.0), dtype=np.float32)
        data = np.stack([np.concatenate([quiet, voice, quiet])] * 2)
        with av.open(str(self.path), "w") as container:
            stream = container.add_stream("pcm_f32le", rate=RATE, layout="stereo")
            frame = av.AudioFrame.from_ndarray(data, format="fltp", layout="stereo")
            frame.sample_rate = RATE
            for packet in stream.encode(frame):
                container.mux(packet)
            for packet in stream.encode(None):
                container.mux(packet)

    def tearDown(self):
        self.folder.cleanup()

    def run_node(self, **values):
        from nodes import node_load_audio

        node = node_load_audio.AusBossLoadAudio()
        with mock.patch.object(node_load_audio, "resolve_input_path", return_value=self.path):
            return asyncio.run(node.load_audio("voice.wav", 0.0, 0.0, **values))

    def test_off_hands_on_the_sound_as_it_is(self):
        audio, length = self.run_node()
        self.assertEqual(tuple(audio["waveform"].shape), (1, 2, seconds(4.0)))
        self.assertAlmostEqual(length, 4.0, places=3)
        audio, _length = self.run_node(clean_up=False)
        self.assertEqual(audio["waveform"].shape[1], 2)

    def test_on_cleans_after_the_trim_and_seconds_matches(self):
        audio, length = self.run_node(clean_up=True, max_seconds=3.0)
        waveform = audio["waveform"]
        self.assertEqual(waveform.shape[1], 1)
        self.assertAlmostEqual(length, waveform.shape[-1] / RATE, places=6)
        # Max length took the first 3 s (1 s quiet, 2 s voice), then the
        # quiet start went: about 2 s of voice and its pads are left.
        self.assertLess(length, 2.5)

    def test_an_older_saves_empty_value_leaves_it_off(self):
        audio, _length = self.run_node(clean_up="")
        self.assertEqual(audio["waveform"].shape[1], 2)


if __name__ == "__main__":
    unittest.main()
