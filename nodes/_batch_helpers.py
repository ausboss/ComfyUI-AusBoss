"""Small IMAGE batch helpers shared by AusBoss nodes."""

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


__all__ = ["select_one_based_frame"]
