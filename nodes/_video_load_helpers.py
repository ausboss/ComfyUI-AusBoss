"""Range-trimmed video and audio decoding for the AusBoss Load Video node."""

from __future__ import annotations

import math
from collections.abc import Mapping
from functools import partial
from pathlib import Path
from typing import Callable

import av
import numpy as np
import torch
from PIL import Image

from ._media_helpers import video_metadata

try:
    import psutil  # ComfyUI core dependency; fail soft for offline tests.
except ImportError:
    psutil = None

FALLBACK_SAMPLE_RATE = 44100
_TIME_EPSILON = 1e-4

# Fraction of available memory the decoded float batch may claim. The decode
# also holds a uint8 staging buffer (a quarter of the float size), so a full
# budget would still overshoot; 0.8 leaves room for that and for the rest of
# the workflow downstream.
MEMORY_SAFETY_FACTOR = 0.8
_BYTES_PER_PIXEL = 3 * 4  # rgb float32, the BHWC batch ComfyUI consumes


def memory_budget_error(
    frame_count: int,
    width: int,
    height: int,
    available_bytes: int | None,
    safety_factor: float = MEMORY_SAFETY_FACTOR,
) -> str | None:
    """Message when the decoded batch cannot fit in memory; None when it can.

    Pure math so tests can drive it with a fake available_bytes. Unknown
    availability (None or <= 0) skips the guard rather than blocking loads.
    """
    if not available_bytes or available_bytes <= 0 or frame_count <= 0:
        return None
    if width <= 0 or height <= 0:
        return None
    needed = frame_count * height * width * _BYTES_PER_PIXEL
    if needed <= int(available_bytes * safety_factor):
        return None
    return (
        f"Load Video would need about {needed / 1e9:.1f} GB for {frame_count} "
        f"frames at {width}x{height}, but only {available_bytes / 1e9:.1f} GB "
        "of memory is available. Trim a shorter start/end window or set "
        "custom_width/custom_height to shrink the frames."
    )


def _available_memory_bytes() -> int | None:
    if psutil is None:
        return None
    try:
        return int(psutil.virtual_memory().available)
    except Exception:
        return None


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


def _estimate_window_frames(metadata: dict, start: float, end: float) -> int:
    """Frames expected inside [start, end); 0 when the source gives no clue."""
    duration = float(metadata["duration"] or 0.0)
    fps = float(metadata["fps"] or 0.0)
    total = int(metadata["frame_count"] or 0)
    window_end = min(end, duration) if duration > 0 else end
    estimated = 0
    if fps > 0 and math.isfinite(window_end) and window_end > start:
        estimated = int(math.ceil((window_end - start) * fps))
    if total > 0:
        estimated = min(estimated, total) if estimated > 0 else total
    return estimated


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
    estimated = _estimate_window_frames(metadata, start, end)
    source_width, source_height = int(metadata["width"]), int(metadata["height"])
    if estimated > 0 and source_width > 0 and source_height > 0:
        planned = output_size(source_width, source_height, custom_width, custom_height)
        error = memory_budget_error(estimated, planned[0], planned[1], _available_memory_bytes())
        if error:
            raise ValueError(error)
    buffer: np.ndarray | None = None
    count = 0
    with av.open(str(path)) as container:
        stream = next(candidate for candidate in container.streams if candidate.type == "video")
        stream.thread_type = "AUTO"
        fps = float(stream.average_rate or stream.base_rate or 0.0) or 30.0
        if start > 0 and stream.time_base:
            # Keyframe at or before the trim start (backward=True), offset by
            # the stream start time to match the preview seek helpers.
            offset = int(start / stream.time_base) + (stream.start_time or 0)
            container.seek(max(0, offset), stream=stream, backward=True)
        size: tuple[int, int] | None = None
        for frame in container.decode(stream):
            time = frame.time
            if time is None:
                time = start + count / fps
            if time < start - _TIME_EPSILON:
                continue
            if time > end - _TIME_EPSILON:
                break
            array = frame.to_ndarray(format="rgb24")
            if size is None:
                size = output_size(array.shape[1], array.shape[0], custom_width, custom_height)
            if (array.shape[1], array.shape[0]) != size:
                array = np.asarray(Image.fromarray(array).resize(size, Image.LANCZOS))
            # Preallocated uint8 staging keeps peak memory at one uint8 copy
            # plus the final float batch, instead of a list of per-frame
            # tensors plus a stacked copy of everything.
            if buffer is None:
                buffer = np.empty((max(estimated, 8), size[1], size[0], 3), dtype=np.uint8)
            elif count >= buffer.shape[0]:
                grown = np.empty(
                    (max(count + 8, buffer.shape[0] + buffer.shape[0] // 4),) + buffer.shape[1:],
                    dtype=np.uint8,
                )
                grown[:count] = buffer
                buffer = grown
            buffer[count] = array
            count += 1
    if buffer is None or count == 0:
        raise ValueError(
            f"Load Video found no frames between {start:.2f}s and "
            f"{'the end' if end == float('inf') else f'{end:.2f}s'} in '{path.name}'."
        )
    batch = torch.from_numpy(buffer[:count]).float().div_(255.0)
    return batch, fps


def core_trim_args(start_seconds: float, end_seconds: float) -> tuple[float, float]:
    """Map the node's start/end widgets onto core's (start_time, duration).

    Core's VIDEO trim treats duration 0 as "until the end", which matches
    end_seconds 0. Degenerate windows (end at or before start) also collapse
    to 0 here, but VALIDATE_INPUTS rejects those graphs before execution.
    """
    start = max(0.0, float(start_seconds))
    end = float(end_seconds)
    duration = end - start if end > 0.0 else 0.0
    return start, max(0.0, duration)


def core_trimmed_video(path: Path, start_seconds: float, end_seconds: float):
    """Core VIDEO object for the trim window; no frames decode until consumed.

    Imported at call time and fail-soft: returns None when the running
    ComfyUI core predates the comfy_api VIDEO type, so the pack still loads
    (the node tooltip documents the requirement). Inside ComfyUI the module
    is already imported, so the lookup is a sys.modules hit.
    """
    try:
        from comfy_api.input_impl import VideoFromFile
    except Exception:
        return None
    video = VideoFromFile(str(path))
    start, duration = core_trim_args(start_seconds, end_seconds)
    if start <= 0.0 and duration <= 0.0:
        return video
    try:
        return video.as_trimmed(start, duration, strict_duration=False)
    except Exception:
        # A core with VideoFromFile but a different trim surface: surface
        # nothing rather than a wrongly windowed video.
        print(
            "[AusBoss] Load Video: this ComfyUI core cannot trim VIDEO "
            "objects; the video output is None."
        )
        return None


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


class LazyAudio(Mapping):
    """ComfyUI AUDIO that decodes on first access and caches the result.

    Downstream nodes dict-access the "waveform"/"sample_rate" keys, so a
    Mapping is a drop-in AUDIO value — but a graph that never consumes the
    audio output now skips the extraction entirely.
    """

    def __init__(self, loader: Callable[[], dict]):
        self._loader = loader
        self._data: dict | None = None

    def _resolve(self) -> dict:
        if self._data is None:
            self._data = dict(self._loader())
        return self._data

    def __getitem__(self, key):
        return self._resolve()[key]

    def __iter__(self):
        return iter(self._resolve())

    def __len__(self) -> int:
        return len(self._resolve())


def lazy_audio_range(path: Path, start_seconds: float, end_seconds: float) -> LazyAudio:
    """AUDIO for [start, end) whose decode is deferred until first key read."""
    return LazyAudio(partial(decode_audio_range, path, start_seconds, end_seconds))


__all__ = [
    "LazyAudio",
    "core_trim_args",
    "core_trimmed_video",
    "decode_audio_range",
    "decode_video_range",
    "lazy_audio_range",
    "memory_budget_error",
    "output_size",
    "silent_audio",
    "trim_window",
]
