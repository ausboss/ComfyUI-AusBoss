"""Range-trimmed video and audio decoding for Load Video and the
Video Crop + Rotate + Pad -> Clip node."""

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

from ._execution_helpers import advance_progress, frame_progress, raise_if_interrupted
from ._media_helpers import decode_from, stream_origin, stream_seconds, video_metadata

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

# What to change when a decode will not fit, in Load Video's own inputs. A
# caller with different inputs passes its own advice along with its name.
LOAD_VIDEO_MEMORY_ADVICE = (
    "Trim a shorter start/end window or set custom_width/custom_height to "
    "shrink the frames."
)


def memory_budget_error(
    frame_count: int,
    width: int,
    height: int,
    available_bytes: int | None,
    safety_factor: float = MEMORY_SAFETY_FACTOR,
    source: str = "Load Video",
    advice: str = LOAD_VIDEO_MEMORY_ADVICE,
) -> str | None:
    """Message when the decoded batch cannot fit in memory; None when it can.

    Pure math so tests can drive it with a fake available_bytes. Unknown
    availability (None or <= 0) skips the guard rather than blocking loads.
    ``source`` is the node the message names and ``advice`` the inputs it
    suggests, so each caller only points at controls it actually has.
    """
    if not available_bytes or available_bytes <= 0 or frame_count <= 0:
        return None
    if width <= 0 or height <= 0:
        return None
    needed = frame_count * height * width * _BYTES_PER_PIXEL
    if needed <= int(available_bytes * safety_factor):
        return None
    return (
        f"{source} would need about {needed / 1e9:.1f} GB for {frame_count} "
        f"frames at {width}x{height}, but only {available_bytes / 1e9:.1f} GB "
        f"of memory is available. {advice}"
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


def trim_window(
    duration: float, start_seconds: float, end_seconds: float, source: str = "Load Video"
) -> tuple[float, float]:
    """Validate the requested trim against the source duration; errors name ``source``."""
    start = max(0.0, float(start_seconds))
    end = float(end_seconds) if float(end_seconds) > 0.0 else float("inf")
    if start >= end:
        raise ValueError(f"{source} needs start_seconds smaller than end_seconds.")
    if duration > 0 and start >= duration - _TIME_EPSILON:
        raise ValueError(
            f"{source} starts at {start:.2f}s but the video is only "
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


def clip_load_window(path, start_seconds, end_seconds, max_frames=0,
                     start_frame=None, end_frame=None, frame_load_cap=None):
    """Linked source-frame bounds override seconds; the end frame is exclusive."""
    if start_frame is not None or end_frame is not None:
        fps = float(video_metadata(path).get("fps") or 0)
        if not math.isfinite(fps) or fps <= 0:
            raise ValueError("Frame bounds require a known source frame rate.")
        if start_frame is not None:
            start_seconds = max(0, int(start_frame)) / fps
        if end_frame is not None:
            end_seconds = max(0, int(end_frame)) / fps
    cap = max_frames if frame_load_cap is None else frame_load_cap
    return float(start_seconds), float(end_seconds), max(0, int(cap))


def fixed_clip_window(metadata, start_seconds, frames, force_rate=0, every_nth=1):
    """Place an exact output-frame window on the source grid, sliding at ends."""
    fps = float(metadata.get("fps") or 0)
    duration = float(metadata.get("duration") or 0)
    if not math.isfinite(fps) or fps <= 0 or not math.isfinite(duration) or duration <= 0:
        raise ValueError("Fixed frames requires a known source frame rate and duration.")
    rate = float(force_rate)
    if not math.isfinite(rate) or not 0 <= rate <= 1000:
        raise ValueError("force_rate must be finite and between 0 and 1000 fps.")
    length = int(frames) * max(1, int(every_nth)) / (rate or fps)
    if length > duration + 1e-7:
        raise ValueError(f"Fixed frames needs {length:.3f}s but the source is only {duration:.3f}s. Reduce Fixed frames.")
    # A source-frame start keeps the preview, decode and audio in agreement.
    latest = max(0, math.floor((duration - length) * fps + 1e-7))
    first = min(latest, max(0, math.ceil((float(start_seconds) - _TIME_EPSILON) * fps)))
    start = first / fps
    return start, start + length, int(frames)


def _frames_at_rate(decoded, stream, fps, start, end, rate):
    """Sample-and-hold on a uniform grid; stream frames without a second batch.

    A positive rate drops or repeats source frames, preserving playback time.
    Zero retains the original decode path. The last frame lasts one source tick.
    Times are on the video clock (stream_seconds), like start and end.
    """
    previous = None
    tick = 0
    index = 0
    previous_time = 0.0
    for frame in decoded:
        raise_if_interrupted()
        time = stream_seconds(frame.time, stream)
        if time is None:
            time = start + index / fps
        index += 1
        if rate <= 0:
            yield frame, time
            continue
        if previous is not None:
            boundary = min(time, end)
            while start + tick / rate < boundary - _TIME_EPSILON:
                target = start + tick / rate
                tick += 1
                if target >= previous_time - _TIME_EPSILON:
                    yield previous, target
        previous, previous_time = frame, time
        if time >= end - _TIME_EPSILON:
            return
    if rate > 0 and previous is not None:
        boundary = min(previous_time + 1 / fps, end)
        while start + tick / rate < boundary - _TIME_EPSILON:
            target = start + tick / rate
            tick += 1
            if target >= previous_time - _TIME_EPSILON:
                yield previous, target


def decode_video_range(
    path: Path,
    start_seconds: float,
    end_seconds: float,
    custom_width: int,
    custom_height: int,
    every_nth: int = 1,
    max_frames: int = 0,
    force_rate: float = 0.0,
    *,
    source: str = "Load Video",
    memory_advice: str = LOAD_VIDEO_MEMORY_ADVICE,
) -> tuple[torch.Tensor, float]:
    """Decode [start, end) as a BHWC float batch plus its pre-thinning fps.

    ``every_nth`` keeps one frame in that many (1 keeps all); the caller
    divides the reported fps by it so timing survives. ``max_frames`` stops
    the decode after that many kept frames (0 = no cap) — the cheap way to
    sample a long clip without holding it all in memory. A positive
    ``force_rate`` resamples before thinning; the returned rate reflects it.
    ``source`` is the node errors name, and ``memory_advice`` the inputs a
    too-large decode suggests changing.
    """
    rate = float(force_rate)
    if not math.isfinite(rate) or rate < 0 or rate > 1000:
        raise ValueError("force_rate must be finite and between 0 and 1000 fps.")
    metadata = video_metadata(path)
    start, end = trim_window(float(metadata["duration"]), start_seconds, end_seconds, source)
    nth = max(1, int(every_nth))
    cap = max(0, int(max_frames))
    estimated = _estimate_window_frames(metadata, start, end)
    if rate > 0:
        window_end = min(end, float(metadata["duration"]))
        if math.isfinite(window_end) and window_end > start:
            estimated = math.ceil((window_end - start) * rate)
    if nth > 1 and estimated > 0:
        estimated = math.ceil(estimated / nth)
    if cap > 0:
        estimated = min(estimated, cap) if estimated > 0 else cap
    source_width, source_height = int(metadata["width"]), int(metadata["height"])
    if estimated > 0 and source_width > 0 and source_height > 0:
        planned = output_size(source_width, source_height, custom_width, custom_height)
        error = memory_budget_error(
            estimated, planned[0], planned[1], _available_memory_bytes(),
            source=source, advice=memory_advice,
        )
        if error:
            raise ValueError(error)
    buffer: np.ndarray | None = None
    count = 0
    # Sources that never declare a frame count leave `estimated` at 0, and the
    # decode then runs without a progress bar rather than guessing a total.
    progress = frame_progress(estimated)
    with av.open(str(path)) as container:
        stream = next(candidate for candidate in container.streams if candidate.type == "video")
        stream.thread_type = "AUTO"
        fps = float(stream.average_rate or stream.base_rate or 0.0) or 30.0
        if start > 0 and stream.time_base:
            # From the keyframe at or before the trim start, found the way
            # the preview seek helpers find it.
            decoded = decode_from(container, stream, start, fps)
        else:
            decoded = container.decode(stream)
        size: tuple[int, int] | None = None
        window_index = 0
        for frame, time in _frames_at_rate(decoded, stream, fps, start, end, rate):
            # Checked before the per-frame work, and on skipped frames too, so
            # cancelling during a long lead-in still stops within one frame.
            raise_if_interrupted()
            if time < start - _TIME_EPSILON:
                continue
            if time > end - _TIME_EPSILON:
                break
            keep = window_index % nth == 0
            window_index += 1
            if not keep:
                continue
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
            advance_progress(progress, count, estimated)
            if cap and count >= cap:
                break
    if buffer is None or count == 0:
        raise ValueError(
            f"{source} found no frames between {start:.2f}s and "
            f"{'the end' if end == float('inf') else f'{end:.2f}s'} in '{path.name}'."
        )
    batch = torch.from_numpy(buffer[:count]).float().div_(255.0)
    return batch, rate or fps


def effective_load_args(
    single_frame: bool, end_seconds: float, every_nth: int, max_frames: int
) -> tuple[float, int, int]:
    """Decode args for the trim, or the one-frame override when single_frame is on.

    Single-frame mode reuses the whole trim pipeline unchanged: an open end
    window with a one-frame cap stops the decode at the first frame at or
    after start_seconds, so the audio window, duration, and core VIDEO trim
    all describe exactly that frame.
    """
    if single_frame:
        return 0.0, 1, 1
    return float(end_seconds), max(1, int(every_nth)), max(0, int(max_frames))


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
    # Core trims on the file's own timestamps; the window is on the video
    # clock (stream_seconds), so it moves by the stream's start time.
    with av.open(str(path)) as container:
        stream = next(candidate for candidate in container.streams if candidate.type == "video")
        start += stream_origin(stream)
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
    """ComfyUI AUDIO for the same window; silence when there is no audio track.

    The window is on the video clock (stream_seconds) and the audio is cut on
    it too, so a track that starts before or after the picture keeps the
    offset the file gives it against the frames.
    """
    start = max(0.0, float(start_seconds))
    end = max(start, float(end_seconds))
    with av.open(str(path)) as container:
        stream = next((candidate for candidate in container.streams if candidate.type == "audio"), None)
        if stream is None:
            return silent_audio(end - start)
        clock = next((candidate for candidate in container.streams if candidate.type == "video"), stream)
        rate = int(stream.rate or FALLBACK_SAMPLE_RATE)
        resampler = av.AudioResampler(format="fltp", layout=stream.layout, rate=rate)
        chunks: list[np.ndarray] = []
        first_time: float | None = None
        for frame in container.decode(stream):
            time = stream_seconds(frame.time, clock)
            if time is None:
                time = 0.0
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
    lead = round((first_time - start) * rate)
    if lead > 0:
        # The track begins inside the window: silence until it does, so its
        # first sample still plays with the frame shown at that time.
        data = np.concatenate((np.zeros((data.shape[0], lead), dtype=data.dtype), data), axis=1)
    begin = max(0, -lead)
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
    "effective_load_args",
    "lazy_audio_range",
    "memory_budget_error",
    "output_size",
    "silent_audio",
    "trim_window",
]
