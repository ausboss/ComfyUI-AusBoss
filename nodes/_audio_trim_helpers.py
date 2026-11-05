"""Trimmed audio decoding for Load Audio.

The window rules live in ``audio_window`` so the node and its tests agree on
what one Run hands on; ``js/load_audio/audio_window.mjs`` mirrors them for the
face. Decoding counts samples from the start of the sound track and stops as
soon as the window is full, so a short pick from a long file never decodes
the whole file.
"""

from __future__ import annotations

import math
from pathlib import Path

import av
import numpy as np
import torch

from ._execution_helpers import raise_if_interrupted

try:
    import folder_paths
except ImportError:  # offline tests
    folder_paths = None

AUDIO_EXTENSIONS = {
    ".aac",
    ".aif",
    ".aiff",
    ".flac",
    ".m4a",
    ".mp3",
    ".oga",
    ".ogg",
    ".opus",
    ".wav",
    ".webm",
    ".wma",
}
# Video files carry sound too: a song is often only on hand inside a clip.
SOUND_IN_VIDEO_EXTENSIONS = {".mkv", ".mov", ".mp4", ".m4v"}

FALLBACK_SAMPLE_RATE = 44100
# Shorter than this is no window at all; the face keeps its handles this far apart.
MIN_WINDOW_SECONDS = 0.1


def _number(value, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def list_input_audio() -> list[str]:
    """Sound files (and videos, for their sound) in ComfyUI's input folder."""
    if folder_paths is None:
        return [""]
    from ._media_helpers import list_input_files

    kinds = AUDIO_EXTENSIONS | SOUND_IN_VIDEO_EXTENSIONS
    results = [
        name
        for name in list_input_files(folder_paths)
        if Path(name).suffix.lower() in kinds
    ]
    return results or [""]


def audio_window(start_seconds, end_seconds, max_seconds=0.0, duration=None) -> dict:
    """The part of a sound file one Run hands on.

    end 0 means "to the end of the file". max_seconds above 0 caps the
    window's length: the pick keeps its start and anything past
    start + max_seconds is cut off. ``duration`` is the file's length when it
    is known; None leaves an open end open.

    Returns start, end (None when open), the end the person picked
    (``picked_end``) and how many seconds the cap cut off (``cut``).
    """
    start = max(0.0, _number(start_seconds))
    picked_end = _number(end_seconds)
    end = picked_end if picked_end > 0 else None
    if duration is not None:
        length = max(0.0, _number(duration))
        start = min(start, length)
        end = length if end is None else min(end, length)
    if end is not None:
        end = max(start, end)
    picked = end
    limit = max(0.0, _number(max_seconds))
    if limit > 0 and (end is None or end - start > limit):
        end = start + limit
        if duration is not None:
            end = min(end, max(0.0, _number(duration)))
    cut = 0.0
    if picked is not None and end is not None:
        cut = max(0.0, picked - end)
    return {"start": start, "end": end, "picked_end": picked, "cut": cut}


def decode_audio_window(path: Path, start_seconds, end_seconds, max_seconds=0.0) -> dict:
    """ComfyUI AUDIO for the window ``audio_window`` describes.

    Raises a plain ValueError for a file with no sound, or a start at or past
    the end of the sound.
    """
    window = audio_window(start_seconds, end_seconds, max_seconds)
    start = window["start"]
    with av.open(str(path)) as container:
        stream = next((candidate for candidate in container.streams if candidate.type == "audio"), None)
        if stream is None:
            raise ValueError(f"{path.name} has no sound in it.")
        rate = int(stream.rate or FALLBACK_SAMPLE_RATE)
        first = round(start * rate)
        last = None if window["end"] is None else round(window["end"] * rate)
        resampler = av.AudioResampler(format="fltp", layout=stream.layout, rate=rate)
        chunks: list[np.ndarray] = []
        position = 0

        def take(frame) -> None:
            nonlocal position
            for resampled in resampler.resample(frame):
                data = resampled.to_ndarray()
                begin = position
                position += data.shape[1]
                if position <= first:
                    continue
                low = max(0, first - begin)
                high = data.shape[1] if last is None else min(data.shape[1], last - begin)
                if high > low:
                    chunks.append(data[:, low:high])

        for frame in container.decode(stream):
            raise_if_interrupted()
            take(frame)
            if last is not None and position >= last:
                break
        else:
            take(None)  # the resampler hands back what it still holds
    if not chunks:
        if position == 0:
            raise ValueError(f"{path.name} has no sound in it.")
        raise ValueError(
            f"The start ({start:.2f} s) is past the end of {path.name}, "
            f"which is {position / rate:.2f} s long. Drag the start back into the sound."
        )
    data = np.concatenate(chunks, axis=1).astype(np.float32, copy=False)
    return {
        "waveform": torch.from_numpy(np.ascontiguousarray(data)).unsqueeze(0),
        "sample_rate": rate,
    }


__all__ = [
    "AUDIO_EXTENSIONS",
    "MIN_WINDOW_SECONDS",
    "SOUND_IN_VIDEO_EXTENSIONS",
    "audio_window",
    "decode_audio_window",
    "list_input_audio",
]
