"""Planning and batched execution for Frame Interpolate.

The planner is pure: it turns (frame count, source fps, target fps) into a
list of FrameJob entries that either copy a source frame or interpolate
between two adjacent ones. Execution happens strictly after planning, in
batches that upload only the unique source frames each batch needs.
"""

from __future__ import annotations

import hashlib
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Iterable, NamedTuple, Sequence
from urllib.parse import urlparse

import torch
import torch.nn.functional as functional

from ._lama_helpers import comfy_torch_device

BLEND_METHOD = "blend"
FLOW_METHOD = "optical flow (requires cached RAFT weights)"
METHOD_CHOICES = [BLEND_METHOD, FLOW_METHOD]

PASSTHROUGH_EPSILON = 0.01
_SNAP_EPSILON = 1e-6
_FLOW_PAD_MULTIPLE = 8
# RAFT's correlation pyramid needs feature maps of at least 16 px, and the
# encoder downsamples by 8, so inputs are padded up to 128 px per side.
_FLOW_MIN_SIZE = 128


class FrameJob(NamedTuple):
    """One planned output frame.

    ``src_a`` and ``src_b`` are zero-based source indices and ``t`` is the
    blend position in [0, 1). ``t == 0`` or ``src_a == src_b`` marks a direct
    copy of ``src_a`` that never touches the interpolation path.
    """

    output_index: int
    src_a: int
    src_b: int
    t: float

    @property
    def is_copy(self) -> bool:
        return self.t == 0.0 or self.src_a == self.src_b


def is_passthrough(source_fps: float, target_fps: float) -> bool:
    """True when the rates are close enough that no resampling is needed."""
    return abs(float(source_fps) - float(target_fps)) < PASSTHROUGH_EPSILON


def output_frame_count(frame_count: int, source_fps: float, target_fps: float) -> int:
    """Output length that keeps the clip duration: round(N / source * target)."""
    duration = int(frame_count) / float(source_fps)
    return max(1, round(duration * float(target_fps)))


def plan_frame_jobs(
    frame_count: int, source_fps: float, target_fps: float
) -> list[FrameJob]:
    """Map every output frame to a source pair and blend position.

    Output frame ``i`` sits at source position ``i * source / target``. Whole
    positions become direct copies; the tail past the last frame holds it.
    """
    count = int(frame_count)
    if count < 1:
        raise ValueError("Frame Interpolate received an empty IMAGE batch.")
    source = float(source_fps)
    target = float(target_fps)
    if source <= 0.0 or target <= 0.0:
        raise ValueError("Frame Interpolate needs source and target fps above zero.")
    step = source / target
    jobs: list[FrameJob] = []
    for index in range(output_frame_count(count, source, target)):
        position = index * step
        first = int(math.floor(position))
        offset = position - first
        if offset < _SNAP_EPSILON:
            offset = 0.0
        elif offset > 1.0 - _SNAP_EPSILON:
            first += 1
            offset = 0.0
        if first >= count - 1:
            jobs.append(FrameJob(index, count - 1, count - 1, 0.0))
        elif offset == 0.0:
            jobs.append(FrameJob(index, first, first, 0.0))
        else:
            jobs.append(FrameJob(index, first, first + 1, offset))
    return jobs


def adjacent_frame_differences(
    frames: torch.Tensor, chunk_size: int = 32
) -> list[float]:
    """Mean absolute difference for every adjacent frame pair, chunked."""
    total = int(frames.shape[0])
    differences: list[float] = []
    for start in range(0, total - 1, chunk_size):
        end = min(start + chunk_size, total - 1)
        first = frames[start:end].float()
        second = frames[start + 1 : end + 1].float()
        # abs_ in place: the subtraction already allocated this chunk's
        # temporary, and a second full-chunk copy (796 MB at a 32-frame
        # 1080p chunk) bought nothing.
        differences.extend((second - first).abs_().mean(dim=(1, 2, 3)).tolist())
    return differences


def detect_scene_cuts(differences: Sequence[float], threshold: float) -> set[int]:
    """Indices a where (a, a+1) is a hard cut. A threshold of 0 disables."""
    level = float(threshold)
    if level <= 0.0:
        return set()
    return {index for index, value in enumerate(differences) if value > level}


def apply_scene_cuts(
    jobs: Iterable[FrameJob], cut_starts: set[int]
) -> list[FrameJob]:
    """Turn interpolations across a cut into holds of the frame before it."""
    if not cut_starts:
        return list(jobs)
    adjusted: list[FrameJob] = []
    for job in jobs:
        if not job.is_copy and job.src_a in cut_starts:
            adjusted.append(FrameJob(job.output_index, job.src_a, job.src_a, 0.0))
        else:
            adjusted.append(job)
    return adjusted


def weighted_blend(
    frames_a: torch.Tensor, frames_b: torch.Tensor, t: torch.Tensor
) -> torch.Tensor:
    """Lerp two aligned stacks; shared by the blend and optical flow paths."""
    return frames_a + (frames_b - frames_a) * t


def backward_warp(images: torch.Tensor, flow: torch.Tensor) -> torch.Tensor:
    """Sample every output pixel x at x + flow(x) with border padding.

    ``images`` is BCHW; ``flow`` is (B, 2, H, W) in pixels with the
    horizontal displacement first.
    """
    height, width = images.shape[-2:]
    dtype = images.dtype
    ys = torch.arange(height, device=images.device, dtype=dtype)
    xs = torch.arange(width, device=images.device, dtype=dtype)
    grid_y, grid_x = torch.meshgrid(ys, xs, indexing="ij")
    sample_x = grid_x.unsqueeze(0) + flow[:, 0]
    sample_y = grid_y.unsqueeze(0) + flow[:, 1]
    norm_x = sample_x * (2.0 / max(width - 1, 1)) - 1.0
    norm_y = sample_y * (2.0 / max(height - 1, 1)) - 1.0
    grid = torch.stack((norm_x, norm_y), dim=-1)
    return functional.grid_sample(
        images, grid, mode="bilinear", padding_mode="border", align_corners=True
    )


def method_uses_optical_flow(method: str) -> bool:
    name = str(method).strip().lower()
    if name.startswith("optical flow"):
        return True
    if name == BLEND_METHOD:
        return False
    raise ValueError(
        f"Frame Interpolate does not know the method '{method}'. "
        f"Choose '{BLEND_METHOD}' or '{FLOW_METHOD}'."
    )


def raft_checkpoint_path(weights, hub_dir: str | Path | None = None) -> Path:
    """Expected local checkpoint path for a torchvision weights enum.

    Resolving this path never downloads anything. The optical-flow loader
    checks it directly so executing a ComfyUI graph cannot start outbound
    network activity or an unapproved model download.
    """
    url = str(getattr(weights, "url", ""))
    filename = Path(urlparse(url).path).name
    if not filename:
        raise RuntimeError("Torchvision did not publish a RAFT checkpoint URL.")
    root = Path(hub_dir) if hub_dir is not None else Path(torch.hub.get_dir())
    return root / "checkpoints" / filename


def _verify_checkpoint_hash(path: Path) -> None:
    """Check the hash prefix embedded in torchvision checkpoint filenames."""
    match = re.search(r"-([0-9a-fA-F]{8,64})\.[^.]+$", path.name)
    if match is None:
        return
    digest = hashlib.sha256()
    with path.open("rb") as checkpoint:
        for chunk in iter(lambda: checkpoint.read(1024 * 1024), b""):
            digest.update(chunk)
    expected = match.group(1).lower()
    if not digest.hexdigest().startswith(expected):
        raise RuntimeError(
            f"Frame Interpolate found a corrupt RAFT checkpoint at '{path}': "
            f"its SHA-256 does not start with the expected {expected}."
        )


@lru_cache(maxsize=1)
def _load_raft_model():
    """Load RAFT-small from the local torch cache without network access."""
    try:
        from torchvision.models.optical_flow import Raft_Small_Weights, raft_small
    except ImportError as exc:
        raise RuntimeError(
            "Frame Interpolate's optical flow method needs torchvision, which "
            "is not available in this Python environment. Switch the method "
            "to 'blend', or install torchvision matching your torch build."
        ) from exc
    weights = Raft_Small_Weights.DEFAULT
    checkpoint = raft_checkpoint_path(weights)
    if not checkpoint.is_file():
        raise RuntimeError(
            "Frame Interpolate's optical flow method will not download model "
            "weights automatically. Download the RAFT-small checkpoint only "
            "after approving that model download, then place it at "
            f"'{checkpoint}', or switch the method to 'blend'. Source URL: "
            f"{weights.url}"
        )
    try:
        _verify_checkpoint_hash(checkpoint)
        state_dict = torch.load(checkpoint, map_location="cpu", weights_only=True)
        model = raft_small(weights=None, progress=False)
        model.load_state_dict(state_dict)
    except Exception as exc:
        detail = str(exc).encode("ascii", "replace").decode("ascii")
        raise RuntimeError(
            "Frame Interpolate could not load the RAFT-small optical flow "
            f"weights from '{checkpoint}'. Replace the cached file with the "
            f"official checkpoint or switch to 'blend'. Original error: {detail}"
        ) from exc
    model.eval()
    return model


def _estimate_flow(
    model, first_rgb: torch.Tensor, second_rgb: torch.Tensor
) -> torch.Tensor:
    """RAFT flow in pixels from the first stack to the second."""
    height, width = first_rgb.shape[-2:]
    pad_h = max(height + (-height) % _FLOW_PAD_MULTIPLE, _FLOW_MIN_SIZE) - height
    pad_w = max(width + (-width) % _FLOW_PAD_MULTIPLE, _FLOW_MIN_SIZE) - width
    if pad_h or pad_w:
        first_rgb = functional.pad(first_rgb, (0, pad_w, 0, pad_h), mode="replicate")
        second_rgb = functional.pad(second_rgb, (0, pad_w, 0, pad_h), mode="replicate")
    with torch.inference_mode():
        # RAFT expects inputs normalized to [-1, 1] and returns per-iteration
        # flow refinements; the last entry is the final estimate.
        flows = model(first_rgb * 2.0 - 1.0, second_rgb * 2.0 - 1.0)
    flow = flows[-1] if isinstance(flows, (list, tuple)) else flows
    return flow[..., :height, :width].float()


def _render_blend(
    sources: torch.Tensor,
    a_indices: torch.Tensor,
    b_indices: torch.Tensor,
    t_values: torch.Tensor,
) -> torch.Tensor:
    weights = t_values.view(-1, 1, 1, 1)
    return weighted_blend(
        sources.index_select(0, a_indices),
        sources.index_select(0, b_indices),
        weights,
    )


def _render_optical_flow(
    model,
    sources: torch.Tensor,
    a_indices: torch.Tensor,
    b_indices: torch.Tensor,
    t_values: torch.Tensor,
    pair_keys: Sequence[tuple[int, int]],
    flow_cache: dict[tuple[int, int], tuple[torch.Tensor, torch.Tensor]],
) -> tuple[torch.Tensor, dict[tuple[int, int], tuple[torch.Tensor, torch.Tensor]]]:
    """Warp both frames of each pair toward time t and blend the warps.

    Flow is estimated once per unique GLOBAL (src_a, src_b) pair - not once
    per batch it appears in. ``pair_keys`` names each job's pair in source
    frame numbers, and ``flow_cache`` carries the previous batch's flows:
    batches are pair-grouped, so a pair can only ever straddle two
    consecutive batches, and one batch of carryover is enough to make every
    solve unique. The returned cache holds exactly this batch's pairs, so
    the extra memory stays bounded by the batch, never the clip.
    """
    order: list[tuple[int, int]] = []
    first_job: dict[tuple[int, int], int] = {}
    for job_index, key in enumerate(pair_keys):
        if key not in first_job:
            first_job[key] = job_index
            order.append(key)
    position = {key: index for index, key in enumerate(order)}
    inverse = torch.tensor(
        [position[key] for key in pair_keys], dtype=torch.long, device=sources.device
    )
    chw = sources.permute(0, 3, 1, 2)
    rgb = chw[:, :3]
    flows = {key: flow_cache[key] for key in order if key in flow_cache}
    misses = [key for key in order if key not in flows]
    if misses:
        first_local = torch.tensor(
            [int(a_indices[first_job[key]]) for key in misses],
            dtype=torch.long,
            device=sources.device,
        )
        second_local = torch.tensor(
            [int(b_indices[first_job[key]]) for key in misses],
            dtype=torch.long,
            device=sources.device,
        )
        first = rgb.index_select(0, first_local)
        second = rgb.index_select(0, second_local)
        forward = _estimate_flow(model, first, second)
        backward = _estimate_flow(model, second, first)
        for index, key in enumerate(misses):
            flows[key] = (forward[index], backward[index])
    flow_forward = torch.stack([flows[key][0] for key in order])
    flow_backward = torch.stack([flows[key][1] for key in order])
    weights = t_values.view(-1, 1, 1, 1)
    warped_a = backward_warp(
        chw.index_select(0, a_indices),
        flow_forward.index_select(0, inverse) * -weights,
    )
    warped_b = backward_warp(
        chw.index_select(0, b_indices),
        flow_backward.index_select(0, inverse) * -(1.0 - weights),
    )
    blended = weighted_blend(warped_a, warped_b, weights).permute(0, 2, 3, 1)
    return blended, flows


def _raise_if_interrupted() -> None:
    try:
        from comfy.model_management import throw_exception_if_processing_interrupted
    except ImportError:  # Offline tests run without ComfyUI.
        return
    throw_exception_if_processing_interrupted()


def _progress_bar(total: int):
    try:
        from comfy.utils import ProgressBar
    except ImportError:  # Offline tests run without ComfyUI.
        return None
    return ProgressBar(total)


def _validate_frames(frames: torch.Tensor) -> None:
    if not isinstance(frames, torch.Tensor) or frames.ndim != 4:
        raise ValueError("Frame Interpolate expected frames in BHWC format.")
    if frames.shape[0] < 1:
        raise ValueError("Frame Interpolate received an empty IMAGE batch.")
    if frames.shape[-1] < 3:
        raise ValueError("Frame Interpolate requires RGB frames.")
    if not torch.isfinite(frames).all():
        raise ValueError("Frame Interpolate received non-finite frame values.")


def _pair_grouped_batches(
    jobs: Sequence[FrameJob], step: int
) -> list[list[FrameJob]]:
    """Chunk jobs so a source pair's jobs share a batch wherever possible.

    Greedy: whole (src_a, src_b) groups are packed up to ``step`` jobs per
    batch; only a group bigger than ``step`` is split, so the memory bound
    the caller advertises still holds."""
    groups: dict[tuple[int, int], list[FrameJob]] = {}
    for job in jobs:
        groups.setdefault((job.src_a, job.src_b), []).append(job)
    batches: list[list[FrameJob]] = []
    current: list[FrameJob] = []
    for group in groups.values():
        for start in range(0, len(group), step):
            piece = group[start : start + step]
            if current and len(current) + len(piece) > step:
                batches.append(current)
                current = []
            current.extend(piece)
    if current:
        batches.append(current)
    return batches


def _execute_jobs(
    frames: torch.Tensor,
    jobs: Sequence[FrameJob],
    batch_size: int,
    device: torch.device,
    flow_model,
) -> torch.Tensor:
    """Fill a preallocated CPU output tensor plan-first, batch by batch."""
    total_out = len(jobs)
    height, width, channels = frames.shape[1:]
    output = torch.empty(
        (total_out, height, width, channels), dtype=frames.dtype, device="cpu"
    )
    copy_jobs = [job for job in jobs if job.is_copy]
    blend_jobs = [job for job in jobs if not job.is_copy]

    step = max(1, int(batch_size))

    # Copied frames go over in the same batches the blends use. Gathering all
    # of them at once was the one allocation batch_size could not bound: a
    # 300-frame 1080p clip doubled to 48 fps copies 301 frames, which is a
    # 7.5 GB transient on the frames device - VRAM, if that is where the batch
    # already lives - on top of the input and the output.
    for start in range(0, len(copy_jobs), step):
        _raise_if_interrupted()
        batch = copy_jobs[start : start + step]
        source_indices = torch.tensor(
            [job.src_a for job in batch], dtype=torch.long, device=frames.device
        )
        output_indices = torch.tensor(
            [job.output_index for job in batch], dtype=torch.long
        )
        output[output_indices] = frames.index_select(0, source_indices).to("cpu")

    progress = _progress_bar(total_out)
    completed = len(copy_jobs)
    if progress is not None:
        progress.update_absolute(completed, total_out)
    # Batches take whole (src_a, src_b) groups, so every output frame between
    # one source pair lands in the same batch and its flow is estimated once.
    # Slicing blend_jobs blindly split those groups: the same RAFT solve was
    # repeated in every batch the pair leaked into - 4x the flow work at
    # batch_size=1 for 24 -> 120 fps, where each pair feeds four blends.
    # Output order is irrelevant here; every job writes to its own
    # output_index. A group larger than the step still splits, keeping
    # batch_size an honest memory bound - the one-batch flow_cache below is
    # what keeps even a split pair at a single solve. Blend-only runs are
    # unaffected because a lerp has no per-pair work to save.
    flow_cache: dict[tuple[int, int], tuple[torch.Tensor, torch.Tensor]] = {}
    for batch in _pair_grouped_batches(blend_jobs, step):
        _raise_if_interrupted()
        unique_sources = sorted(
            {index for job in batch for index in (job.src_a, job.src_b)}
        )
        local = {source: position for position, source in enumerate(unique_sources)}
        gather = torch.tensor(unique_sources, dtype=torch.long, device=frames.device)
        sources = frames.index_select(0, gather).to(device=device, dtype=torch.float32)
        a_indices = torch.tensor(
            [local[job.src_a] for job in batch], dtype=torch.long, device=device
        )
        b_indices = torch.tensor(
            [local[job.src_b] for job in batch], dtype=torch.long, device=device
        )
        t_values = torch.tensor(
            [job.t for job in batch], dtype=torch.float32, device=device
        )
        if flow_model is None:
            rendered = _render_blend(sources, a_indices, b_indices, t_values)
        else:
            rendered, flow_cache = _render_optical_flow(
                flow_model,
                sources,
                a_indices,
                b_indices,
                t_values,
                [(job.src_a, job.src_b) for job in batch],
                flow_cache,
            )
        output_indices = torch.tensor(
            [job.output_index for job in batch], dtype=torch.long
        )
        output[output_indices] = (
            rendered.clamp(0.0, 1.0).to("cpu", dtype=frames.dtype)
        )
        del sources, rendered, a_indices, b_indices, t_values
        completed += len(batch)
        if progress is not None:
            progress.update_absolute(completed, total_out)
    return output


def interpolate_frames(
    frames: torch.Tensor,
    source_fps: float,
    target_fps: float,
    method: str,
    scene_cut_threshold: float,
    batch_size: int,
    device: torch.device | None = None,
) -> tuple[torch.Tensor, float]:
    """Resample a BHWC batch from source_fps to target_fps.

    Returns the resampled frames plus the actual output fps, which can
    differ slightly from the request when the output count is rounded to
    keep the clip duration.
    """
    _validate_frames(frames)
    source = float(source_fps)
    target = float(target_fps)
    uses_flow = method_uses_optical_flow(method)
    if source <= 0.0 or target <= 0.0:
        raise ValueError("Frame Interpolate needs source and target fps above zero.")
    if is_passthrough(source, target):
        return frames, source

    total_frames = int(frames.shape[0])
    jobs = plan_frame_jobs(total_frames, source, target)
    threshold = float(scene_cut_threshold)
    if threshold > 0.0 and any(not job.is_copy for job in jobs):
        cuts = detect_scene_cuts(adjacent_frame_differences(frames), threshold)
        jobs = apply_scene_cuts(jobs, cuts)

    if device is None:
        device = comfy_torch_device()
    model = _load_raft_model() if uses_flow else None
    if model is not None:
        model.to(device)
    try:
        output = _execute_jobs(frames, jobs, batch_size, device, model)
    finally:
        if model is not None and device.type != "cpu":
            model.to(torch.device("cpu"))
    actual_fps = len(jobs) * source / total_frames
    return output, actual_fps


__all__ = [
    "BLEND_METHOD",
    "FLOW_METHOD",
    "METHOD_CHOICES",
    "FrameJob",
    "adjacent_frame_differences",
    "apply_scene_cuts",
    "backward_warp",
    "detect_scene_cuts",
    "interpolate_frames",
    "is_passthrough",
    "method_uses_optical_flow",
    "output_frame_count",
    "plan_frame_jobs",
    "raft_checkpoint_path",
    "weighted_blend",
]
