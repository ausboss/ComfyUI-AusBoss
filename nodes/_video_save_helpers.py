"""Encoding for the AusBoss Save Video node."""

from __future__ import annotations

import json
import math
from fractions import Fraction
from pathlib import Path
from typing import NamedTuple

import av
import numpy as np
import torch
from av.video.reformatter import ColorRange, Colorspace

from ._execution_helpers import advance_progress, frame_progress, raise_if_interrupted

AAC_FRAME_SIZE = 1024
OPUS_SAMPLE_RATE = 48000  # libopus encodes at 48 kHz; other rates resample.


class VideoFormat(NamedTuple):
    """One entry of the format widget.

    A NamedTuple rather than a plain dict so ``VIDEO_FORMATS[name][0]`` keeps
    naming the output file the way it always did, while the fields the encoder
    branches on can be read by name.

    ``video_codec`` empty marks the still-image path: gif and webp are written
    frame by frame through Pillow, which picks an adaptive palette per frame,
    where libav's gif encoder would flatten everything onto one fixed 256-entry
    web palette. Neither carries audio.
    """

    extension: str
    video_codec: str
    audio_codec: str | None
    pix_fmt: str
    # yuv420p and yuv422p10le halve the chroma horizontally, so the picture has
    # to arrive with even dimensions; planar RGB and the Pillow path do not.
    needs_even: bool
    # Only meaningful for the YUV codecs: planar RGB carries no matrix to tag.
    tag_bt709: bool


# Ordered as the dropdown reads: the everywhere-plays default first, the
# hardware encoders beside their software twins, then the archival and
# short-clip formats.
VIDEO_FORMATS = {
    "mp4 h264": VideoFormat("mp4", "libx264", "aac", "yuv420p", True, True),
    "mp4 h265": VideoFormat("mp4", "libx265", "aac", "yuv420p", True, True),
    "mp4 h264 nvenc": VideoFormat("mp4", "h264_nvenc", "aac", "yuv420p", True, True),
    "mp4 h265 nvenc": VideoFormat("mp4", "hevc_nvenc", "aac", "yuv420p", True, True),
    "webm vp9": VideoFormat("webm", "libvpx-vp9", "libopus", "yuv420p", True, True),
    "webm av1": VideoFormat("webm", "libsvtav1", "libopus", "yuv420p", True, True),
    "mov prores": VideoFormat("mov", "prores_ks", "pcm_s16le", "yuv422p10le", True, True),
    "mkv ffv1": VideoFormat("mkv", "ffv1", "flac", "bgr0", False, False),
    "gif": VideoFormat("gif", "", None, "", False, False),
    "webp": VideoFormat("webp", "", None, "", False, False),
}

# Quality dials by codec. crf is the widget every format shares; what it means
# locally is decided here so the node keeps one number to explain.
def stream_options(video_codec: str, crf: int) -> dict[str, str]:
    """libav options for one video codec at the requested crf."""
    quality = str(int(crf))
    if video_codec == "libx265":
        # x265 prints a banner per encode; keep the console quiet.
        return {"crf": quality, "x265-params": "log-level=error"}
    if video_codec == "libvpx-vp9":
        # b=0 switches vp9 into constant-quality mode; row-mt uses the
        # thread pool it otherwise leaves idle.
        return {"crf": quality, "b": "0", "row-mt": "1"}
    if video_codec == "libsvtav1":
        # preset 8 is SVT's balanced default; without it the encoder is far
        # slower than everything else in this list for no visible gain.
        return {"crf": quality, "preset": "8"}
    if video_codec in {"h264_nvenc", "hevc_nvenc"}:
        # NVENC has no crf. cq is its constant-quality dial and only takes
        # effect once the bitrate target is released with b=0.
        return {"rc": "vbr", "cq": quality, "b": "0"}
    if video_codec == "ffv1":
        # Lossless by definition, so crf has nothing to say. Level 3 with
        # per-slice CRCs is the archival configuration.
        return {"level": "3", "coder": "1", "context": "1", "slices": "4", "slicecrc": "1"}
    if video_codec == "prores_ks":
        # Profile 3 is ProRes HQ; the format's own quality ladder replaces crf.
        return {"profile": "3"}
    return {"crf": quality}


def pingpong_frames(frames: torch.Tensor) -> torch.Tensor:
    """Frames followed by the same frames reversed, endpoints not repeated.

    Dropping the first and last of the reversed half is what makes the seam
    invisible: keeping them would show the turnaround frames twice each and
    the loop would visibly hitch at both ends. Fewer than three frames have no
    interior to bounce through, so they come back untouched.
    """
    if not isinstance(frames, torch.Tensor) or frames.shape[0] < 3:
        return frames
    return torch.cat([frames, frames.flip(0)[1:-1]], dim=0)

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


def _resample_audio(prepared, target_rate: int):
    """The prepared tuple resampled to ``target_rate``; unchanged when equal."""
    packed, layout, channels, sample_rate, _total = prepared
    if sample_rate == target_rate:
        return prepared
    from av.audio.resampler import AudioResampler

    resampler = AudioResampler(format="flt", layout=layout, rate=target_rate)
    frame = av.AudioFrame.from_ndarray(packed, format="flt", layout=layout)
    frame.sample_rate = sample_rate
    frame.pts = 0
    frame.time_base = Fraction(1, sample_rate)
    pieces = [chunk.to_ndarray() for chunk in resampler.resample(frame)]
    pieces.extend(chunk.to_ndarray() for chunk in resampler.resample(None))
    if not pieces:
        return None
    joined = np.ascontiguousarray(np.concatenate(pieces, axis=1), dtype=np.float32)
    return joined, layout, channels, target_rate, joined.shape[1] // channels


def _encode_audio(container, stream, prepared) -> None:
    packed, layout, channels, sample_rate, total_samples = prepared
    # The waveform is already in memory, so the frame total is known here
    # the same way the batch size is known for the picture.
    frame_size = int(getattr(stream.codec_context, "frame_size", 0) or AAC_FRAME_SIZE)
    chunk_total = math.ceil(total_samples / frame_size)
    progress = frame_progress(chunk_total)
    for encoded, offset in enumerate(range(0, total_samples, frame_size), start=1):
        # One audio frame of latency - tens of ms - between cancelling
        # the queue and unwinding; the container still closes cleanly.
        raise_if_interrupted()
        chunk = packed[:, offset * channels : (offset + frame_size) * channels]
        frame = av.AudioFrame.from_ndarray(chunk, format="flt", layout=layout)
        frame.sample_rate = sample_rate
        frame.pts = offset
        frame.time_base = Fraction(1, sample_rate)
        for packet in stream.encode(frame):
            container.mux(packet)
        advance_progress(progress, encoded, chunk_total)
    # Flushing drains whatever the encoder still holds: the packet count is
    # only known once it stops yielding, so there is no honest fraction to
    # report and this loop takes the interrupt check alone.
    for packet in stream.encode():
        raise_if_interrupted()
        container.mux(packet)


def _rgb_uint8(frame: torch.Tensor) -> np.ndarray:
    return (
        frame[..., :3].detach().cpu().float().clamp(0.0, 1.0).mul(255.0)
        .round().to(torch.uint8).numpy()
    )


def _encode_animation(
    path: Path, batch: torch.Tensor, fps: float, crf: int, extension: str
) -> None:
    """Write an animated gif or webp through Pillow.

    Both formats are palette or still-image codecs with no audio and no
    streaming encoder, so every frame has to be resident before the first byte
    is written - which is why the node's tooltip points them at short clips.
    GIF frames are quantized individually so each carries its own adaptive
    palette rather than sharing one flattened web palette.
    """
    from PIL import Image

    # A gif/webp frame duration is whole milliseconds, so the playback rate is
    # quantized here whatever fps asked for; 1 ms is the floor players honour.
    duration_ms = max(1, int(round(1000.0 / float(fps))))
    frame_count = int(batch.shape[0])
    progress = frame_progress(frame_count)
    images = []
    for encoded, frame in enumerate(batch, start=1):
        raise_if_interrupted()
        image = Image.fromarray(_rgb_uint8(frame), "RGB")
        if extension == "gif":
            image = image.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
        images.append(image)
        advance_progress(progress, encoded, frame_count)
    head, *tail = images
    shared = {
        "save_all": True,
        "append_images": tail,
        "duration": duration_ms,
        "loop": 0,  # 0 means forever
    }
    if extension == "gif":
        # disposal 2 clears each frame before the next, so a per-frame palette
        # never bleeds through the one after it.
        head.save(path, **shared, disposal=2, optimize=False)
    else:
        # webp's quality runs the opposite way to crf: 0 is worst, 100 best.
        quality = max(0, min(100, int(round(100.0 - int(crf) * 100.0 / 51.0))))
        head.save(path, **shared, quality=quality, method=4)


def encode_video(
    path: Path,
    frames: torch.Tensor,
    fps: float,
    audio: dict | None,
    crf: int,
    metadata: dict | None = None,
    video_format: str = "mp4 h264",
) -> tuple[int, int, int]:
    """Write the encoded file; returns (width, height, frame_count)."""
    if video_format not in VIDEO_FORMATS:
        raise ValueError(
            f"Save Video format must be one of {tuple(VIDEO_FORMATS)}, "
            f"not '{video_format}'."
        )
    spec = VIDEO_FORMATS[video_format]
    batch = even_frames(frames) if spec.needs_even else frames
    if batch.ndim != 4 or batch.shape[0] < 1:
        raise ValueError("Save Video expected a BHWC IMAGE batch.")
    height, width = int(batch.shape[1]), int(batch.shape[2])
    frame_count = int(batch.shape[0])
    rate = _fps_fraction(fps)
    if not spec.video_codec:
        _encode_animation(path, batch, fps, crf, spec.extension)
        return width, height, frame_count
    prepared_audio = _prepare_audio(audio)
    if prepared_audio is not None and spec.audio_codec == "libopus":
        prepared_audio = _resample_audio(prepared_audio, OPUS_SAMPLE_RATE)
    # The batch is already in memory, so the total is always known here.
    progress = frame_progress(frame_count)
    # Same movflags core uses: without use_metadata_tags the isobmff muxers
    # drop every custom key, so the embedded workflow simply would not be
    # there, and faststart puts the moov atom up front so previews start
    # immediately. mov needs it exactly as much as mp4 does. Matroska and
    # webm write tags natively (uppercasing the keys) and take no options.
    container_options = (
        {"movflags": "use_metadata_tags+faststart"}
        if spec.extension in {"mp4", "mov"}
        else {}
    )
    with av.open(str(path), "w", options=container_options) as container:
        for key, value in (metadata or {}).items():
            container.metadata[key] = value
        # Every stream must exist before the first mux writes the container
        # header; a stream added later never gets a valid time base and the
        # muxer dies with SIGFPE deep in libav.
        stream = _add_video_stream(container, spec, rate, width, height, crf)
        audio_stream = None
        if prepared_audio is not None:
            audio_stream = container.add_stream(spec.audio_codec, rate=prepared_audio[3])
            audio_stream.layout = prepared_audio[1]
        for encoded, frame in enumerate(batch, start=1):
            # One frame of latency between cancelling the queue and unwinding;
            # the container still closes cleanly on the way out.
            raise_if_interrupted()
            video_frame = av.VideoFrame.from_ndarray(_rgb_uint8(frame), format="rgb24")
            if spec.tag_bt709:
                # Convert RGB->YUV with the bt709 matrix ourselves; the implicit
                # conversion inside encode() would use the bt601 default and
                # contradict the stream tags.
                video_frame = video_frame.reformat(
                    format=spec.pix_fmt,
                    dst_colorspace=Colorspace.ITU709,
                    dst_color_range=ColorRange.MPEG,
                )
            else:
                # Planar RGB: no matrix is applied, so the samples reach ffv1
                # exactly as they left the tensor and the file is truly lossless.
                video_frame = video_frame.reformat(format=spec.pix_fmt)
            for packet in stream.encode(video_frame):
                container.mux(packet)
            advance_progress(progress, encoded, frame_count)
        for packet in stream.encode():
            container.mux(packet)
        if audio_stream is not None:
            _encode_audio(container, audio_stream, prepared_audio)
    return width, height, frame_count


def _add_video_stream(container, spec: VideoFormat, rate, width: int, height: int, crf: int):
    """The configured video stream, or a clear error naming what is missing.

    The NVENC encoders exist in the libav build whether or not there is an
    NVIDIA card behind it, so they only fail here, at open time, with a message
    from deep inside the driver. Catching it is the difference between "pick a
    different format" and a stack trace.
    """
    try:
        stream = container.add_stream(spec.video_codec, rate=rate)
    except Exception as exc:
        raise RuntimeError(
            f"Save Video could not start the '{spec.video_codec}' encoder: {exc}. "
            "The nvenc formats need an NVIDIA GPU with a working driver; "
            "pick a software format such as 'mp4 h264' instead."
        ) from exc
    stream.width = width
    stream.height = height
    stream.pix_fmt = spec.pix_fmt
    stream.options = stream_options(spec.video_codec, crf)
    if spec.tag_bt709:
        # Tag the stream bt709 so players do not guess (and shift) colors;
        # the encoders copy these into the bitstream and the muxer writes the
        # matching color metadata.
        stream.codec_context.color_primaries = _BT709
        stream.codec_context.color_trc = _BT709
        stream.codec_context.colorspace = _BT709
        stream.codec_context.color_range = _RANGE_MPEG
    return stream


def workflow_metadata(prompt, extra_pnginfo) -> dict:
    """The same embed keys core video nodes use, so saves drag back into ComfyUI."""
    metadata: dict[str, str] = {}
    if prompt is not None:
        metadata["prompt"] = json.dumps(prompt)
    for key, value in (extra_pnginfo or {}).items():
        metadata[key] = json.dumps(value)
    return metadata


__all__ = [
    "VIDEO_FORMATS",
    "VideoFormat",
    "encode_video",
    "even_frames",
    "pingpong_frames",
    "resolve_encode_fps",
    "stream_options",
    "video_components",
    "workflow_metadata",
]
