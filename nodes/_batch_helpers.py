"""Small batch-selection helpers shared by AusBoss nodes."""

from __future__ import annotations

import torch


def select_one_based_frame(frames: torch.Tensor, frame_number: int) -> torch.Tensor:
    """Return one unchanged BHWC frame using a user-facing one-based index."""
    if not isinstance(frames, torch.Tensor) or frames.ndim != 4:
        raise ValueError("Select Frame expected a BHWC IMAGE batch.")
    frame_count = int(frames.shape[0])
    if frame_count < 1:
        raise ValueError("Select Frame received an empty IMAGE batch.")
    number = int(frame_number)
    if number < 1 or number > frame_count:
        raise ValueError(
            f"Select Frame requested frame {number}, but this batch contains "
            f"frames 1 through {frame_count}."
        )
    return frames[number - 1 : number]


def select_one_based_frame_range(
    frames: torch.Tensor, start_frame: int, frame_count: int
) -> torch.Tensor:
    """Return an unchanged BHWC sub-batch using a one-based start frame.

    A ``frame_count`` of 0 means "through the last frame". Any explicit count
    that would run past the end raises with the available range instead of
    silently clamping, matching select_one_based_frame's philosophy.
    """
    if not isinstance(frames, torch.Tensor) or frames.ndim != 4:
        raise ValueError("Select Frame Range expected a BHWC IMAGE batch.")
    total = int(frames.shape[0])
    if total < 1:
        raise ValueError("Select Frame Range received an empty IMAGE batch.")
    start = int(start_frame)
    if start < 1 or start > total:
        raise ValueError(
            f"Select Frame Range requested start frame {start}, but this batch "
            f"contains frames 1 through {total}."
        )
    count = int(frame_count)
    if count < 0:
        raise ValueError(
            "Select Frame Range needs a frame_count of 0 or more "
            "(0 means through the last frame)."
        )
    remaining = total - start + 1
    if count == 0:
        count = remaining
    elif count > remaining:
        raise ValueError(
            f"Select Frame Range requested {count} frames from frame {start}, "
            f"but only {remaining} remain through frame {total}. Use 0 to run "
            f"through the last frame."
        )
    return frames[start - 1 : start - 1 + count]


__all__ = ["select_one_based_frame", "select_one_based_frame_range"]
