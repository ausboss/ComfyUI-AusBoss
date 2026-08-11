"""H.264/AAC encoding for the AusBoss Save Video node."""

from __future__ import annotations

import json
from fractions import Fraction
from pathlib import Path

import av
import numpy as np
import torch

AAC_FRAME_SIZE = 1024


def even_frames(frames: torch.Tensor) -> torch.Tensor:
    """Crop a BHWC batch down to even dimensions as yuv420p requires."""
    height = frames.shape[1] - (frames.shape[1] % 2)
    width = frames.shape[2] - (frames.shape[2] % 2)
    return frames[:, :height, :width, :]


def _fps_fraction(fps: float) -> Fraction:
    if fps <= 0:
        raise ValueError("Save Video needs an fps greater than zero.")
    return Fraction(fps).limit_denominator(10000)


def _prepare_audio(audio: dict | None):
    """Validate and repack AUDIO for AAC; None when there is nothing to mux."""
    if audio is None:
        return None
    waveform = audio.get("waveform")
    sample_rate = int(audio.get("sample_rate") or 0)
    if waveform is None or waveform.numel() == 0 or sample_rate <= 0:
        return None
    data = waveform[0].detach().cpu().float().clamp(-1.0, 1.0).numpy()
    channels = min(data.shape[0], 2)
    data = data[:channels]
    layout = "stereo" if channels == 2 else "mono"
    packed = np.ascontiguousarray(data.T.reshape(1, -1), dtype=np.float32)
    return packed, layout, channels, sample_rate, data.shape[1]


def _encode_audio(container, stream, prepared) -> None:
    packed, layout, channels, sample_rate, total_samples = prepared
    for offset in range(0, total_samples, AAC_FRAME_SIZE):
        chunk = packed[:, offset * channels : (offset + AAC_FRAME_SIZE) * channels]
        frame = av.AudioFrame.from_ndarray(chunk, format="flt", layout=layout)
        frame.sample_rate = sample_rate
        frame.pts = offset
        frame.time_base = Fraction(1, sample_rate)
        for packet in stream.encode(frame):
            container.mux(packet)
    for packet in stream.encode():
        container.mux(packet)


def encode_video(
    path: Path,
    frames: torch.Tensor,
    fps: float,
    audio: dict | None,
    crf: int,
    metadata: dict | None = None,
) -> tuple[int, int, int]:
    """Write an H.264 mp4; returns (width, height, frame_count)."""
    batch = even_frames(frames)
    if batch.ndim != 4 or batch.shape[0] < 1:
        raise ValueError("Save Video expected a BHWC IMAGE batch.")
    height, width = int(batch.shape[1]), int(batch.shape[2])
    rate = _fps_fraction(fps)
    prepared_audio = _prepare_audio(audio)
    with av.open(str(path), "w") as container:
        for key, value in (metadata or {}).items():
            container.metadata[key] = value
        # Every stream must exist before the first mux writes the container
        # header; a stream added later never gets a valid time base and the
        # muxer dies with SIGFPE deep in libav.
        stream = container.add_stream("libx264", rate=rate)
        stream.width = width
        stream.height = height
        stream.pix_fmt = "yuv420p"
        stream.options = {"crf": str(int(crf))}
        audio_stream = None
        if prepared_audio is not None:
            audio_stream = container.add_stream("aac", rate=prepared_audio[3])
            audio_stream.layout = prepared_audio[1]
        for frame in batch:
            array = (
                frame[..., :3].detach().cpu().float().clamp(0.0, 1.0).mul(255.0)
                .round().to(torch.uint8).numpy()
            )
            for packet in stream.encode(av.VideoFrame.from_ndarray(array, format="rgb24")):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
        if audio_stream is not None:
            _encode_audio(container, audio_stream, prepared_audio)
    return width, height, int(batch.shape[0])


def workflow_metadata(prompt, extra_pnginfo) -> dict:
    """The same embed keys core video nodes use, so saves drag back into ComfyUI."""
    metadata: dict[str, str] = {}
    if prompt is not None:
        metadata["prompt"] = json.dumps(prompt)
    for key, value in (extra_pnginfo or {}).items():
        metadata[key] = json.dumps(value)
    return metadata


__all__ = ["encode_video", "even_frames", "workflow_metadata"]
