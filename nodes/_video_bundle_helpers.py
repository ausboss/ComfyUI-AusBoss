"""Build, edit, and unpack AUSBOSS_VIDEO bundles.

An AUSBOSS_VIDEO value is a plain dict carrying one video's worth of data
on a single wire:

    {
        "frames": BHWC float tensor,
        "audio": AUDIO dict or None,
        "fps": float,
        "frame_count": int,   # derived from frames
        "width": int,         # derived from frames
        "height": int,        # derived from frames
        "duration": float,    # derived from frame_count / fps
    }

The derived fields are recomputed every time a bundle is built or edited,
so they can never drift from the tensor they describe.
"""

from __future__ import annotations

import torch

BUNDLE_TYPE = "AUSBOSS_VIDEO"


def derive_video_fields(frames: torch.Tensor, fps: float) -> dict:
    """Compute the fields a bundle derives from its frames tensor and fps."""
    if not isinstance(frames, torch.Tensor) or frames.ndim != 4:
        raise ValueError("Video Bundle expected a BHWC IMAGE batch for frames.")
    fps_value = float(fps)
    if not fps_value > 0:
        raise ValueError("Video Bundle fps must be greater than zero.")
    frame_count = int(frames.shape[0])
    return {
        "fps": fps_value,
        "frame_count": frame_count,
        "width": int(frames.shape[2]),
        "height": int(frames.shape[1]),
        "duration": frame_count / fps_value,
    }


def build_video_bundle(frames: torch.Tensor, fps: float, audio=None) -> dict:
    """Assemble a fresh bundle; audio is optional and may stay None."""
    bundle = {"frames": frames, "audio": audio}
    bundle.update(derive_video_fields(frames, fps))
    return bundle


def edit_video_bundle(bundle: dict, frames=None, audio=None, fps=None) -> dict:
    """Copy a bundle, overriding only the parts that were provided.

    A None argument keeps the original value, so unconnected node inputs
    leave the bundle untouched. Derived fields are recomputed whenever the
    frames or fps that feed them change.
    """
    require_video_bundle(bundle)
    return build_video_bundle(
        bundle["frames"] if frames is None else frames,
        bundle.get("fps") if fps is None else fps,
        bundle.get("audio") if audio is None else audio,
    )


def unbundle_video(bundle: dict) -> tuple:
    """Unpack to (frames, audio, fps, frame_count, width, height, duration).

    audio is None when the bundle was built without an audio track. The
    derived fields are recomputed from the tensor so even a hand-built
    bundle dict unpacks consistently.
    """
    require_video_bundle(bundle)
    fields = derive_video_fields(bundle["frames"], bundle.get("fps", 0.0))
    return (
        bundle["frames"],
        bundle.get("audio"),
        fields["fps"],
        fields["frame_count"],
        fields["width"],
        fields["height"],
        fields["duration"],
    )


def require_video_bundle(bundle) -> None:
    if not isinstance(bundle, dict) or "frames" not in bundle:
        raise ValueError(
            "Expected an AUSBOSS_VIDEO bundle from Video Bundle."
        )


__all__ = [
    "BUNDLE_TYPE",
    "build_video_bundle",
    "derive_video_fields",
    "edit_video_bundle",
    "require_video_bundle",
    "unbundle_video",
]
