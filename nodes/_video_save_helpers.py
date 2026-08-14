"""H.264/AAC encoding for the AusBoss Save Video node."""

from __future__ import annotations

import json
import math
from fractions import Fraction
from pathlib import Path

import av
import numpy as np
import torch
from av.video.reformatter import ColorRange, Colorspace

AAC_FRAME_SIZE = 1024

# Rates closer than this render to the same 0.01-step fps widget value, so
# they are the same rate as far as the user is concerned.
FPS_EPSILON = 1e-3

# AVCOL_PRI_BT709 / AVCOL_TRC_BT709 / AVCOL_SPC_BT709 all happen to be 1.
_BT709 = 1
_RANGE_MPEG = 1  # AVCOL_RANGE_MPEG: limited/tv range, standard for yuv420p


def even_frames(frames: torch.Tensor) -> torch.Tensor:
    """Crop a BHWC batch down to even dimensions as yuv420p requires."""
    height = frames.shape[1] - (frames.shape[1] % 2)
    width = frames.shape[2] - (frames.shape[2] % 2)
    return frames[:, :height, :width, :]


def _fps_fraction(fps: float) -> Fraction:
    if fps <= 0:
        raise ValueError("Save Video needs an fps greater than zero.")
    return Fraction(fps).limit_denominator(10000)


def resolve_encode_fps(widget_fps: float, video_fps: float | None) -> tuple[float, str | None]:
    """Rate to encode at, plus one log line when the two sources disagree.

    A connected VIDEO carries the rate its own frames were cut at, so it wins
    over the fps widget: replaying those frames at a stale widget rate would
    drift the picture away from the audio muxed beside it. The message is
    None when there is no video, or when the widget already agrees, so an
    ordinary save stays silent.
    """
    widget = float(widget_fps)
    if video_fps is None:
        return widget, None
    resolved = float(video_fps)
    if not math.isfinite(resolved) or resolved <= 0.0:
        return widget, None
    if abs(resolved - widget) <= FPS_EPSILON:
        return resolved, None
    return resolved, (
        f"[AusBoss] Save Video: encoding at the connected video's {resolved:.3f} fps, "
        f"not the fps widget's {widget:.3f}."
    )


def video_components(video):
    """(frames, audio, fps) from a connected core VIDEO; None when unconnected.

    Duck-typed on purpose, the same fail-soft seam Load Video uses: the pack
    never imports comfy_api's VIDEO type, so a core without that API still
    loads every node and simply leaves this socket unconnectable.
    """
    if video is None:
        return None
    read_components = getattr(video, "get_components", None)
    if not callable(read_components):
        raise ValueError("Save Video's video input expects a ComfyUI core VIDEO object.")
    components = read_components()
    frames = getattr(components, "images", None)
    if frames is None:
        raise ValueError("Save Video: the connected video carries no frames.")
    rate = getattr(components, "frame_rate", None)
    return frames, getattr(components, "audio", None), None if rate is None else float(rate)


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
    # Same movflags core uses: metadata tags survive the mp4 muxer and the
    # moov atom lands up front so previews start immediately.
    with av.open(str(path), "w", options={"movflags": "use_metadata_tags+faststart"}) as container:
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
        # Tag the stream bt709 so players do not guess (and shift) colors;
        # x264 copies these into the bitstream VUI and the muxer writes the
        # matching colr atom.
        stream.codec_context.color_primaries = _BT709
        stream.codec_context.color_trc = _BT709
        stream.codec_context.colorspace = _BT709
        stream.codec_context.color_range = _RANGE_MPEG
        audio_stream = None
        if prepared_audio is not None:
            audio_stream = container.add_stream("aac", rate=prepared_audio[3])
            audio_stream.layout = prepared_audio[1]
        for frame in batch:
            array = (
                frame[..., :3].detach().cpu().float().clamp(0.0, 1.0).mul(255.0)
                .round().to(torch.uint8).numpy()
            )
            # Convert RGB->YUV with the bt709 matrix ourselves; the implicit
            # conversion inside encode() would use the bt601 default and
            # contradict the stream tags.
            video_frame = av.VideoFrame.from_ndarray(array, format="rgb24").reformat(
                format="yuv420p",
                dst_colorspace=Colorspace.ITU709,
                dst_color_range=ColorRange.MPEG,
            )
            for packet in stream.encode(video_frame):
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


__all__ = [
    "encode_video",
    "even_frames",
    "resolve_encode_fps",
    "video_components",
    "workflow_metadata",
]
