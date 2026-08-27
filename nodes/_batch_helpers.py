"""Small batch-selection helpers shared by AusBoss nodes."""

from __future__ import annotations

import torch


def _require_batch(frames: torch.Tensor, source: str) -> int:
    """Validate a non-empty BHWC batch and return its frame count."""
    if not isinstance(frames, torch.Tensor) or frames.ndim != 4:
        raise ValueError(f"{source} expected a BHWC IMAGE batch.")
    count = int(frames.shape[0])
    if count < 1:
        raise ValueError(f"{source} received an empty IMAGE batch.")
    return count


def select_one_based_frame(frames: torch.Tensor, frame_number: int) -> torch.Tensor:
    """Return one unchanged BHWC frame using a user-facing one-based index.

    Negative numbers count from the end: -1 is the last frame, -2 the one
    before it. 0 is invalid — the contract stays one-based both ways.
    """
    if not isinstance(frames, torch.Tensor) or frames.ndim != 4:
        raise ValueError("Select Frame expected a BHWC IMAGE batch.")
    frame_count = int(frames.shape[0])
    if frame_count < 1:
        raise ValueError("Select Frame received an empty IMAGE batch.")
    number = int(frame_number)
    if number == 0 or number > frame_count or number < -frame_count:
        raise ValueError(
            f"Select Frame requested frame {number}, but this batch contains "
            f"frames 1 through {frame_count} (or -1 through -{frame_count} "
            "counting from the end)."
        )
    index = number - 1 if number > 0 else frame_count + number
    return frames[index : index + 1]


def select_every_nth(frames: torch.Tensor, nth: int, offset: int = 0) -> torch.Tensor:
    """Every nth frame of a BHWC batch, after skipping ``offset`` frames.

    The first kept frame is the one right after the skipped block, so
    nth=2, offset=0 keeps frames 1, 3, 5, ... and offset=1 keeps 2, 4, 6, ...
    (one-based, as the rest of the pack counts frames).
    """
    count = _require_batch(frames, "Select Every Nth")
    step = int(nth)
    skip = int(offset)
    if step < 1:
        raise ValueError("Select Every Nth needs an nth of at least 1.")
    if skip < 0:
        raise ValueError("Select Every Nth needs an offset of 0 or more.")
    if skip >= count:
        raise ValueError(
            f"Select Every Nth skipped {skip} frames, but this batch only "
            f"contains {count}."
        )
    return frames[skip::step]


def split_batch(frames: torch.Tensor, index: int) -> tuple[torch.Tensor, torch.Tensor]:
    """Split a BHWC batch after the one-based frame ``index``.

    Frames 1 through index become the first batch, the rest the second. Both
    sides must end up non-empty: a zero-frame IMAGE batch is invalid on any
    downstream wire, so an index that would create one is refused with the
    valid range instead.
    """
    count = _require_batch(frames, "Split Batch")
    number = int(index)
    if count < 2:
        raise ValueError(
            f"Split Batch needs at least 2 frames to split, but this batch contains {count}."
        )
    if number < 1 or number >= count:
        raise ValueError(
            f"Split Batch cannot split after frame {number}: with {count} "
            f"frames the split point must be between 1 and {count - 1} so "
            "neither side is empty."
        )
    return frames[:number], frames[number:]


MERGE_MISMATCH_MODES = ("resize to a", "resize to b", "error")


def _resize_bhwc(frames: torch.Tensor, height: int, width: int) -> torch.Tensor:
    """Bilinear-resize a BHWC batch (interpolate wants BCHW, so round-trip)."""
    moved = frames.permute(0, 3, 1, 2)
    resized = torch.nn.functional.interpolate(
        moved, size=(height, width), mode="bilinear", align_corners=False
    )
    return resized.permute(0, 2, 3, 1).contiguous()


def merge_batches(
    batch_a: torch.Tensor,
    batch_b: torch.Tensor,
    on_mismatch: str = "resize to a",
) -> torch.Tensor:
    """Concatenate two BHWC batches, a's frames first.

    ``on_mismatch`` decides what happens when the two resolutions differ:
    resize b's frames to a's size, resize a's frames to b's size, or refuse
    with both sizes named. Channel counts must already match — silently
    dropping or inventing an alpha channel is not this node's call to make.
    """
    _require_batch(batch_a, "Merge Batches")
    _require_batch(batch_b, "Merge Batches")
    if on_mismatch not in MERGE_MISMATCH_MODES:
        raise ValueError(
            f"Merge Batches does not know the mismatch policy {on_mismatch!r}; "
            f"expected one of {', '.join(MERGE_MISMATCH_MODES)}."
        )
    channels_a, channels_b = int(batch_a.shape[3]), int(batch_b.shape[3])
    if channels_a != channels_b:
        raise ValueError(
            f"Merge Batches cannot join {channels_a}-channel and "
            f"{channels_b}-channel images; convert them to match first."
        )
    merged_a = batch_a
    merged_b = batch_b.to(device=batch_a.device, dtype=batch_a.dtype)
    size_a = (int(batch_a.shape[1]), int(batch_a.shape[2]))
    size_b = (int(merged_b.shape[1]), int(merged_b.shape[2]))
    if size_a != size_b:
        if on_mismatch == "error":
            raise ValueError(
                f"Merge Batches received different sizes: a is "
                f"{size_a[1]}x{size_a[0]} and b is {size_b[1]}x{size_b[0]}. "
                "Pick a resize policy to join them."
            )
        if on_mismatch == "resize to a":
            merged_b = _resize_bhwc(merged_b, *size_a)
        else:
            merged_a = _resize_bhwc(merged_a, *size_b)
    return torch.cat((merged_a, merged_b), dim=0)


__all__ = [
    "MERGE_MISMATCH_MODES",
    "merge_batches",
    "select_every_nth",
    "select_one_based_frame",
    "split_batch",
]
