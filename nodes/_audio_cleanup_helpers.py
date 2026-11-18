"""Voice cleanup for Load Audio's clean_up switch.

One pass, in this order, on the part of the file the node hands on:

1. one channel (the channels are averaged);
2. a high-pass at 80 Hz for rumble and mains hum (a man's voice starts
   around 85 Hz, so it keeps its depth);
3. light hiss reduction: a noise print from the quietest moments, and every
   sound close to it is turned down by at most ``HISS_REDUCTION_DB``;
4. quiet stretches at the start and the end are cut, keeping a short pad;
5. an even loudness (``TARGET_LUFS``, measured the way broadcast meters do),
   with a limiter that keeps every peak under ``PEAK_CEILING_DB``.

Everything is torch on the CPU, at the file's own sample rate.
"""

from __future__ import annotations

import math

import torch
import torch.nn.functional as F

from ._execution_helpers import raise_if_interrupted

HIGH_PASS_HZ = 80.0
HISS_REDUCTION_DB = 12.0
# A sound counts as hiss below this many dB over the noise print.
GATE_MARGIN_DB = 6.0
TARGET_LUFS = -18.0
PEAK_CEILING_DB = -1.0
MAX_BOOST_DB = 30.0
# Quiet ends: what stays before the first and after the last sound.
LEAD_PAD_SECONDS = 0.1
TAIL_PAD_SECONDS = 0.2
# Quieter than this everywhere is treated as silence and left alone.
SILENCE_DB = -60.0

_EPS = 1e-10


def _db(value: torch.Tensor) -> torch.Tensor:
    return 20.0 * torch.log10(value.clamp_min(_EPS))


def _shape_spectrum(signal: torch.Tensor, rate: int, gain_for_hz) -> torch.Tensor:
    """Multiply the whole signal's spectrum by ``gain_for_hz(frequencies)``.

    Zero phase. The signal is padded first so the filter's ring at one end
    does not wrap around into the other.
    """
    length = signal.shape[-1]
    pad = int(rate * 0.1)
    padded = F.pad(signal, (pad, pad))
    spectrum = torch.fft.rfft(padded.double())
    hz = torch.fft.rfftfreq(padded.shape[-1], d=1.0 / rate, dtype=torch.float64)
    shaped = torch.fft.irfft(spectrum * gain_for_hz(hz), n=padded.shape[-1])
    return shaped[..., pad : pad + length].to(signal.dtype)


def _high_pass_gain(hz: torch.Tensor) -> torch.Tensor:
    # A fourth-order Butterworth's magnitude: -3 dB at the corner, -10 dB at
    # 60 Hz hum, -16 dB at 50 Hz, -24 dB an octave under. Zero at DC.
    ratio = (HIGH_PASS_HZ / hz.clamp_min(1e-6)) ** 8
    return torch.where(hz > 0, 1.0 / torch.sqrt(1.0 + ratio), torch.zeros_like(hz))


def _biquad_magnitude(b, a, hz: torch.Tensor, rate: int) -> torch.Tensor:
    z = torch.exp(-1j * 2.0 * math.pi * hz / rate)
    top = b[0] + b[1] * z + b[2] * z * z
    bottom = a[0] + a[1] * z + a[2] * z * z
    return (top / bottom).abs()


def _k_weighting_gain(rate: int):
    """The loudness meter's ear curve (ITU-R BS.1770) at any sample rate."""
    # Stage 1: a high shelf, +4 dB above about 1.7 kHz.
    f0, gain_db, q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    k = math.tan(math.pi * f0 / rate)
    vh = 10.0 ** (gain_db / 20.0)
    vb = vh ** 0.4996667741545416
    a0 = 1.0 + k / q + k * k
    shelf_b = ((vh + vb * k / q + k * k) / a0, 2.0 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0)
    shelf_a = (1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0)
    # Stage 2: a high-pass at about 38 Hz.
    f0, q = 38.13547087602444, 0.5003270373238773
    k = math.tan(math.pi * f0 / rate)
    a0 = 1.0 + k / q + k * k
    pass_b = (1.0, -2.0, 1.0)
    pass_a = (1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0)

    def gain(hz: torch.Tensor) -> torch.Tensor:
        return _biquad_magnitude(shelf_b, shelf_a, hz, rate) * _biquad_magnitude(pass_b, pass_a, hz, rate)

    return gain


def integrated_loudness(mono: torch.Tensor, rate: int) -> float:
    """Integrated loudness in LUFS of a 1-D signal, or -inf for silence.

    400 ms blocks every 100 ms, gated at -70 LUFS and then 10 LU under the
    mean, as broadcast meters measure it.
    """
    weighted = _shape_spectrum(mono, rate, _k_weighting_gain(rate)).double()
    block = int(round(0.4 * rate))
    hop = int(round(0.1 * rate))
    if weighted.shape[-1] < block:
        blocks = weighted.square().mean().reshape(1)
    else:
        blocks = weighted.unfold(-1, block, hop).square().mean(dim=-1)

    def lufs(power: torch.Tensor) -> torch.Tensor:
        return -0.691 + 10.0 * torch.log10(power.clamp_min(1e-20))

    kept = blocks[lufs(blocks) > -70.0]
    if kept.numel() == 0:
        return float("-inf")
    relative = lufs(kept.mean()) - 10.0
    kept = kept[lufs(kept) > relative]
    return float(lufs(kept.mean()))


def _fft_size(rate: int) -> int:
    # About 40 ms: fine enough to tell a voice's harmonics from hiss.
    return max(256, 1 << int(round(math.log2(rate * 0.04))))


def _reduce_hiss(mono: torch.Tensor, rate: int) -> torch.Tensor:
    """Spectral gate: a noise print from the quietest frames, then a soft,
    smoothed gain that turns down whatever sits close to it."""
    n_fft = _fft_size(rate)
    hop = n_fft // 4
    if mono.shape[-1] < n_fft * 4:
        return mono  # too short to learn what the noise is
    window = torch.hann_window(n_fft, dtype=mono.dtype)
    spec = torch.stft(mono, n_fft, hop, window=window, center=True, return_complex=True)
    level = _db(spec.abs())  # bins x frames
    # The quietest tenth of the frames, by their total energy, is the print.
    energy = spec.abs().square().sum(dim=0)
    count = max(4, energy.shape[0] // 10)
    quiet = torch.topk(energy, count, largest=False).indices
    noise = level[:, quiet]
    threshold = noise.mean(dim=1, keepdim=True) + noise.std(dim=1, keepdim=True) + GATE_MARGIN_DB
    # 0 for hiss, 1 for anything well over it, a 3 dB soft edge between.
    keep = torch.sigmoid((level - threshold) / 1.5)
    # Smooth across nearby bins and frames so the gain does not twinkle.
    kernel = torch.outer(torch.hann_window(7, periodic=False), torch.hann_window(5, periodic=False))
    kernel = (kernel / kernel.sum()).to(keep.dtype)[None, None]
    keep = F.conv2d(keep[None, None], kernel, padding=(3, 2))[0, 0]
    floor = 10.0 ** (-HISS_REDUCTION_DB / 20.0)
    gain = floor + (1.0 - floor) * keep
    return torch.istft(spec * gain, n_fft, hop, window=window, center=True, length=mono.shape[-1])


def _sound_span(mono: torch.Tensor, rate: int) -> tuple[int, int]:
    """First and last sample worth keeping, quiet ends cut, pads kept."""
    frame = max(1, int(rate * 0.02))
    usable = (mono.shape[-1] // frame) * frame
    if usable == 0:
        return 0, mono.shape[-1]
    levels = _db(mono[:usable].reshape(-1, frame).square().mean(dim=1).sqrt())
    loudest = float(levels.max())
    if loudest < SILENCE_DB:
        return 0, mono.shape[-1]
    floor = float(torch.quantile(levels, 0.1))
    # 10 dB over the quiet floor, or halfway to the loudest moment when the
    # noise sits closer than that, and never more than 50 dB under it.
    threshold = max(loudest - 50.0, min(floor + 10.0, (floor + loudest) / 2.0))
    loud = torch.nonzero(levels > threshold).flatten()
    first = max(0, int(loud[0]) * frame - int(rate * LEAD_PAD_SECONDS))
    last = min(mono.shape[-1], (int(loud[-1]) + 1) * frame + int(rate * TAIL_PAD_SECONDS))
    return first, last


def _limit(mono: torch.Tensor, rate: int, ceiling: float) -> torch.Tensor:
    """Look-ahead peak limiter: the gain dips just before a peak and comes
    back after it, so nothing passes the ceiling and nothing is clipped."""
    needed = (ceiling / mono.abs().clamp_min(_EPS)).clamp(max=1.0)
    if float(needed.min()) >= 1.0:
        return mono
    reach = max(1, int(rate * 0.005))
    width = 2 * reach + 1
    # The lowest gain any sample within reach needs, then averaged over the
    # same reach: every average is at or under what its own sample needs.
    lowest = -F.max_pool1d(-needed[None, None], width, stride=1, padding=reach)
    smooth = F.avg_pool1d(lowest, width, stride=1, padding=reach, count_include_pad=False)[0, 0]
    return (mono * smooth).clamp(-ceiling, ceiling)


def clean_up_voice(sound: dict) -> dict:
    """ComfyUI AUDIO in, the cleaned-up voice out as one channel."""
    waveform = sound["waveform"]
    rate = int(sound["sample_rate"])
    mono = waveform[0].float().mean(dim=0)
    if mono.numel() == 0:
        return {"waveform": mono.reshape(1, 1, 0), "sample_rate": rate}
    raise_if_interrupted()
    mono = _shape_spectrum(mono, rate, _high_pass_gain)
    raise_if_interrupted()
    mono = _reduce_hiss(mono, rate)
    raise_if_interrupted()
    first, last = _sound_span(mono, rate)
    mono = mono[first:last]
    loudness = integrated_loudness(mono, rate)
    if math.isfinite(loudness):
        gain_db = min(TARGET_LUFS - loudness, MAX_BOOST_DB)
        mono = mono * (10.0 ** (gain_db / 20.0))
        mono = _limit(mono, rate, 10.0 ** (PEAK_CEILING_DB / 20.0))
    return {"waveform": mono.contiguous().reshape(1, 1, -1), "sample_rate": rate}


__all__ = ["clean_up_voice", "integrated_loudness"]
