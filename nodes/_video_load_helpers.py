"""Range-trimmed video and audio decoding for the AusBoss Load Video node."""

from __future__ import annotations

from pathlib import Path

import av
import numpy as np
import torch
from PIL import Image

from ._media_helpers import video_metadata

FALLBACK_SAMPLE_RATE = 44100
_TIME_EPSILON = 1e-4


def output_size(
    source_width: int, source_height: int, custom_width: int, custom_height: int
) -> tuple[int, int]:
    """0 keeps a source dimension; a single custom value preserves aspect."""
    if custom_width <= 0 and custom_height <= 0:
        return source_width, source_height
    if custom_width > 0 and custom_height > 0:
        return custom_width, custom_height
    if custom_width > 0:
        height = round(source_height * custom_width / source_width / 2) * 2
        return custom_width, max(2, height)
    width = round(source_width * custom_height / source_height / 2) * 2
    return max(2, width), custom_height


def trim_window(duration: float, start_seconds: float, end_seconds: float) -> tuple[float, float]:
    """Validate the requested trim against the source duration."""
    start = max(0.0, float(start_seconds))
    end = float(end_seconds) if float(end_seconds) > 0.0 else float("inf")
    if start >= end:
        raise ValueError("Load Video needs start_seconds smaller than end_seconds.")
    if duration > 0 and start >= duration - _TIME_EPSILON:
        raise ValueError(
            f"Load Video starts at {start:.2f}s but the video is only "
            f"{duration:.2f}s long."
        )
    return start, end


def decode_video_range(
    path: Path,
    start_seconds: float,
    end_seconds: float,
    custom_width: int,
    custom_height: int,
) -> tuple[torch.Tensor, float]:
    """Decode [start, end) as a BHWC float batch plus the source fps."""
    metadata = video_metadata(path)
    start, end = trim_window(float(metadata["duration"]), start_seconds, end_seconds)
    frames: list[torch.Tensor] = []
    with av.open(str(path)) as container:
        stream = next(candidate for candidate in container.streams if candidate.type == "video")
        stream.thread_type = "AUTO"
        fps = float(stream.average_rate or stream.base_rate or 0.0) or 30.0
        if start > 0 and stream.time_base:
            container.seek(max(0, int(start / stream.time_base)), stream=stream, backward=True)
        size: tuple[int, int] | None = None
        for frame in container.decode(stream):
            time = frame.time
            if time is None:
                time = start + len(frames) / fps
            if time < start - _TIME_EPSILON:
                continue
            if time > end - _TIME_EPSILON:
                break
            array = frame.to_ndarray(format="rgb24")
            if size is None:
                size = output_size(array.shape[1], array.shape[0], custom_width, custom_height)
            if (array.shape[1], array.shape[0]) != size:
                array = np.asarray(Image.fromarray(array).resize(size, Image.LANCZOS))
            frames.append(torch.from_numpy(array.copy()))
    if not frames:
        raise ValueError(
            f"Load Video found no frames between {start:.2f}s and "
            f"{'the end' if end == float('inf') else f'{end:.2f}s'} in '{path.name}'."
        )
    batch = torch.stack(frames, dim=0).float() / 255.0
    return batch, fps


def silent_audio(duration: float) -> dict:
    samples = max(1, round(max(0.0, duration) * FALLBACK_SAMPLE_RATE))
    return {
        "waveform": torch.zeros((1, 1, samples), dtype=torch.float32),
        "sample_rate": FALLBACK_SAMPLE_RATE,
    }


def decode_audio_range(path: Path, start_seconds: float, end_seconds: float) -> dict:
    """ComfyUI AUDIO for the same window; silence when there is no audio track."""
    start = max(0.0, float(start_seconds))
    end = max(start, float(end_seconds))
    with av.open(str(path)) as container:
        stream = next((candidate for candidate in container.streams if candidate.type == "audio"), None)
        if stream is None:
            return silent_audio(end - start)
        rate = int(stream.rate or FALLBACK_SAMPLE_RATE)
        resampler = av.AudioResampler(format="fltp", layout=stream.layout, rate=rate)
        chunks: list[np.ndarray] = []
        first_time: float | None = None
        for frame in container.decode(stream):
            time = frame.time if frame.time is not None else 0.0
            span = frame.samples / float(frame.sample_rate or rate)
            if time + span < start - _TIME_EPSILON:
                continue
            if time > end + _TIME_EPSILON:
                break
            if first_time is None:
                first_time = time
            for resampled in resampler.resample(frame):
                chunks.append(resampled.to_ndarray())
    if not chunks or first_time is None:
        return silent_audio(end - start)
    data = np.concatenate(chunks, axis=1)
    begin = max(0, round((start - first_time) * rate))
    length = max(1, round((end - start) * rate))
    data = data[:, begin : begin + length]
    if data.size == 0:
        return silent_audio(end - start)
    return {
        "waveform": torch.from_numpy(np.ascontiguousarray(data)).unsqueeze(0),
        "sample_rate": rate,
    }


__all__ = [
    "decode_audio_range",
    "decode_video_range",
    "output_size",
    "silent_audio",
    "trim_window",
]
