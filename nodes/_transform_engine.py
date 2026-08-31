"""Pure rotate, crop, and pad processing shared by the AusBoss loaders."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image, ImageFilter
import torch

from ._color_helpers import parse_fill_color


MAX_DIMENSION = 65536
MAX_PADDING = 32768


@dataclass(frozen=True)
class TransformSpec:
    rotation_degrees: float = 0.0
    crop_aspect_ratio: str = "free"
    crop_x: int = 0
    crop_y: int = 0
    crop_width: int = 0
    crop_height: int = 0
    pad_left: int = 0
    pad_top: int = 0
    pad_right: int = 0
    pad_bottom: int = 0
    feather: int = 0
    canvas_multiple: int = 1
    fill_color: str = "#808080"

    def normalized(self) -> "TransformSpec":
        angle = ((float(self.rotation_degrees) + 180.0) % 360.0) - 180.0
        if abs(angle) < 0.00005:
            angle = 0.0
        return TransformSpec(
            rotation_degrees=round(angle, 4),
            crop_aspect_ratio=normalize_aspect_ratio(self.crop_aspect_ratio),
            crop_x=max(0, int(self.crop_x)),
            crop_y=max(0, int(self.crop_y)),
            crop_width=max(0, int(self.crop_width)),
            crop_height=max(0, int(self.crop_height)),
            pad_left=_bounded_padding(self.pad_left, "pad_left"),
            pad_top=_bounded_padding(self.pad_top, "pad_top"),
            pad_right=_bounded_padding(self.pad_right, "pad_right"),
            pad_bottom=_bounded_padding(self.pad_bottom, "pad_bottom"),
            feather=max(0, min(int(self.feather), 4096)),
            canvas_multiple=max(1, min(int(self.canvas_multiple), 4096)),
            fill_color=normalize_fill_color(self.fill_color),
        )


@dataclass(frozen=True)
class TransformGeometry:
    rotated_width: int
    rotated_height: int
    crop_x: int
    crop_y: int
    crop_width: int
    crop_height: int
    pad_left: int
    pad_top: int
    pad_right: int
    pad_bottom: int
    output_width: int
    output_height: int


def _bounded_padding(value: int, name: str) -> int:
    value = int(value)
    if value < 0 or value > MAX_PADDING:
        raise ValueError(
            f"Transform: input '{name}' expected 0..{MAX_PADDING}, received {value}."
        )
    return value


def normalize_fill_color(value: str) -> str:
    return "#" + "".join(f"{channel:02x}" for channel in parse_fill_color(value))


def fill_rgb(value: str) -> tuple[int, int, int]:
    return parse_fill_color(value)


def normalize_aspect_ratio(value: str) -> str:
    text = str(value or "free").strip().lower()
    if text in {"free", "source"}:
        return text
    try:
        width, height = (int(part) for part in text.split(":", 1))
    except (TypeError, ValueError) as exc:
        raise ValueError(
            "Transform: input 'crop_aspect_ratio' expected free, source, or W:H."
        ) from exc
    if width < 1 or height < 1:
        raise ValueError("Transform: crop aspect ratio values must be positive.")
    common = math.gcd(width, height)
    return f"{width // common}:{height // common}"


def _ceil_to_multiple(value: int, multiple: int) -> int:
    return int(math.ceil(value / multiple) * multiple)


def _validate_source(image: Image.Image) -> None:
    width, height = image.size
    if width < 1 or height < 1:
        raise ValueError("Transform: source image must contain at least one pixel.")
    if width > MAX_DIMENSION or height > MAX_DIMENSION:
        raise ValueError(
            f"Transform: source dimensions must be at most {MAX_DIMENSION} pixels per side."
        )


def _rotate_rgba(image: Image.Image, spec: TransformSpec) -> Image.Image:
    rgba = image.convert("RGBA")
    if spec.rotation_degrees == 0.0:
        return rgba.copy()
    color = fill_rgb(spec.fill_color)
    return rgba.rotate(
        -spec.rotation_degrees,
        resample=Image.Resampling.BICUBIC,
        expand=True,
        fillcolor=(*color, 0),
    )


def _geometry(rotated: Image.Image, spec: TransformSpec) -> TransformGeometry:
    rotated_width, rotated_height = rotated.size
    crop_x = min(spec.crop_x, rotated_width - 1)
    crop_y = min(spec.crop_y, rotated_height - 1)
    available_width = rotated_width - crop_x
    available_height = rotated_height - crop_y
    crop_width = available_width if spec.crop_width <= 0 else min(spec.crop_width, available_width)
    crop_height = available_height if spec.crop_height <= 0 else min(spec.crop_height, available_height)
    crop_width = max(1, crop_width)
    crop_height = max(1, crop_height)
    if spec.crop_aspect_ratio != "free":
        if spec.crop_aspect_ratio == "source":
            ratio_width, ratio_height = rotated_width, rotated_height
        else:
            ratio_width, ratio_height = (int(part) for part in spec.crop_aspect_ratio.split(":"))
        scale = min(crop_width / ratio_width, crop_height / ratio_height)
        crop_width = max(1, min(available_width, int(math.floor(ratio_width * scale))))
        crop_height = max(1, min(available_height, int(math.floor(ratio_height * scale))))

    requested_width = crop_width + spec.pad_left + spec.pad_right
    requested_height = crop_height + spec.pad_top + spec.pad_bottom
    output_width = _ceil_to_multiple(requested_width, spec.canvas_multiple)
    output_height = _ceil_to_multiple(requested_height, spec.canvas_multiple)
    if output_width > MAX_DIMENSION or output_height > MAX_DIMENSION:
        raise ValueError(
            "Transform: requested crop and padding exceed the 65536-pixel output limit."
        )

    return TransformGeometry(
        rotated_width=rotated_width,
        rotated_height=rotated_height,
        crop_x=crop_x,
        crop_y=crop_y,
        crop_width=crop_width,
        crop_height=crop_height,
        pad_left=spec.pad_left,
        pad_top=spec.pad_top,
        pad_right=spec.pad_right + output_width - requested_width,
        pad_bottom=spec.pad_bottom + output_height - requested_height,
        output_width=output_width,
        output_height=output_height,
    )


def transform_pil(image: Image.Image, spec: TransformSpec) -> tuple[Image.Image, Image.Image, TransformGeometry]:
    """Apply rotate -> crop -> pad and return opaque RGB, BHW-style mask image, and geometry."""
    _validate_source(image)
    spec = spec.normalized()
    rotated = _rotate_rgba(image, spec)
    geometry = _geometry(rotated, spec)
    crop_box = (
        geometry.crop_x,
        geometry.crop_y,
        geometry.crop_x + geometry.crop_width,
        geometry.crop_y + geometry.crop_height,
    )
    cropped = rotated.crop(crop_box)

    alpha = cropped.getchannel("A")
    fill = fill_rgb(spec.fill_color)
    filled_crop = Image.new("RGB", cropped.size, fill)
    filled_crop.paste(cropped.convert("RGB"), mask=alpha)

    output = Image.new("RGB", (geometry.output_width, geometry.output_height), fill)
    output.paste(filled_crop, (geometry.pad_left, geometry.pad_top))

    generated_crop = Image.fromarray(255 - np.asarray(alpha, dtype=np.uint8))
    mask = Image.new("L", output.size, 255)
    mask.paste(generated_crop, (geometry.pad_left, geometry.pad_top))
    if spec.feather > 0:
        original = np.asarray(mask, dtype=np.uint8)
        blurred = np.asarray(
            mask.filter(ImageFilter.GaussianBlur(spec.feather)), dtype=np.uint16
        )
        # A blurred step edge sits at ~50% exactly on the boundary, so using
        # the blur directly (or max() with it) leaves a visible 255->127 seam.
        # Doubling and clipping pins the generated side at 255 and starts a
        # smooth ramp exactly at the edge; max() keeps thin generated slivers
        # fully masked.
        feathered = np.maximum(original, np.minimum(blurred * 2, 255).astype(np.uint8))
        mask = Image.fromarray(feathered)
        # Fade the visible output into the fill color across the same ramp so
        # the image blends into the padding instead of ending at a hard cut.
        # The band lies inside the mask, so samplers regenerate it anyway.
        weight = (feathered.astype(np.float32) / 255.0)[..., None]
        rgb = np.asarray(output, dtype=np.float32)
        fill_pixel = np.asarray(fill, dtype=np.float32)
        output = Image.fromarray(
            (rgb * (1.0 - weight) + fill_pixel * weight).round().astype(np.uint8)
        )

    return output, mask, geometry


def transform_pil_batch(
    images: Iterable[Image.Image], spec: TransformSpec
) -> tuple[torch.Tensor, torch.Tensor, TransformGeometry]:
    frames: list[torch.Tensor] = []
    masks: list[torch.Tensor] = []
    first_geometry: TransformGeometry | None = None
    for index, image in enumerate(images):
        output, mask, geometry = transform_pil(image, spec)
        if first_geometry is None:
            first_geometry = geometry
        elif output.size != (first_geometry.output_width, first_geometry.output_height):
            raise ValueError(
                f"Transform: frame {index} produced dimensions that differ from frame 0."
            )
        image_array = np.asarray(output, dtype=np.float32) / 255.0
        mask_array = np.asarray(mask, dtype=np.float32) / 255.0
        frames.append(torch.from_numpy(image_array.copy()))
        masks.append(torch.from_numpy(mask_array.copy()))

    if not frames or first_geometry is None:
        raise ValueError("Transform: source contained no decodable frames.")
    return torch.stack(frames, dim=0), torch.stack(masks, dim=0), first_geometry


def transform_tensor_batch(
    image: torch.Tensor, spec: TransformSpec, source_mask: torch.Tensor | None = None
) -> tuple[torch.Tensor, torch.Tensor, TransformGeometry]:
    if not isinstance(image, torch.Tensor) or image.ndim != 4 or image.shape[-1] not in (3, 4):
        received = tuple(image.shape) if isinstance(image, torch.Tensor) else type(image).__name__
        raise ValueError(
            "Transform: input 'image' expected BHWC with 3 or 4 channels, "
            f"received {received}."
        )
    if source_mask is not None:
        if not isinstance(source_mask, torch.Tensor) or tuple(source_mask.shape) != tuple(image.shape[:3]):
            raise ValueError(
                "Transform: input 'source_mask' expected BHW matching the image batch."
            )

    device = image.device
    dtype = image.dtype
    pil_frames: list[Image.Image] = []
    image_cpu = image.detach().to(device="cpu", dtype=torch.float32).clamp(0.0, 1.0)
    mask_cpu = None if source_mask is None else source_mask.detach().to(device="cpu", dtype=torch.float32).clamp(0.0, 1.0)
    for index in range(image_cpu.shape[0]):
        rgb = (image_cpu[index, ..., :3].numpy() * 255.0).round().astype(np.uint8)
        if image_cpu.shape[-1] == 4:
            alpha = (image_cpu[index, ..., 3].numpy() * 255.0).round().astype(np.uint8)
        else:
            alpha = np.full(image_cpu.shape[1:3], 255, dtype=np.uint8)
        if mask_cpu is not None:
            alpha = np.minimum(alpha, ((1.0 - mask_cpu[index].numpy()) * 255.0).round().astype(np.uint8))
        pil_frames.append(Image.fromarray(np.dstack((rgb, alpha))))

    output, mask, geometry = transform_pil_batch(pil_frames, spec)
    return output.to(device=device, dtype=dtype), mask.to(device=device, dtype=dtype), geometry


def stable_file_fingerprint(path: str | os.PathLike[str], inputs: dict[str, object]) -> str:
    normalized_path = str(Path(path).resolve()).casefold()
    try:
        stat = os.stat(path)
        file_state: dict[str, object] = {
            "path": normalized_path,
            "mtime_ns": stat.st_mtime_ns,
            "size": stat.st_size,
        }
    except OSError:
        file_state = {"path": normalized_path, "missing": True}
    payload = {"file": file_state, "inputs": inputs}
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def scale_to_megapixels(
    width: int, height: int, megapixels: float, steps: int = 1
) -> tuple[int, int]:
    """Target size whose pixel count is ~megapixels, aspect preserved.

    Mirrors core ImageScaleToTotalPixels semantics so the two stay
    interchangeable in a workflow: the budget is megapixels * 1024 * 1024,
    and each dimension rounds independently to the nearest multiple of
    steps (never below one step)."""
    source_width = max(1, int(width))
    source_height = max(1, int(height))
    total = max(1.0, float(megapixels) * 1024 * 1024)
    scale = (total / (source_width * source_height)) ** 0.5
    step = max(1, int(steps))
    scaled_width = max(step, round(source_width * scale / step) * step)
    scaled_height = max(step, round(source_height * scale / step) * step)
    return int(scaled_width), int(scaled_height)


def resize_batch_to_megapixels(output, mask, megapixels, method, steps):
    """Resize the transform's BHWC image (and BHW mask) to a pixel budget.

    The image uses the chosen method; the mask always resizes bilinear -
    it is a soft coverage map, and ringing methods (lanczos/bicubic) would
    push it outside 0..1 at the feather edge."""
    import comfy.utils

    height = int(output.shape[1])
    width = int(output.shape[2])
    target_width, target_height = scale_to_megapixels(width, height, megapixels, steps)
    if (target_width, target_height) == (width, height):
        return output, mask
    samples = output.movedim(-1, 1)
    samples = comfy.utils.common_upscale(
        samples, target_width, target_height, str(method), "disabled"
    )
    output = samples.movedim(1, -1).clamp(0.0, 1.0)
    mask_samples = mask.unsqueeze(1)
    mask_samples = comfy.utils.common_upscale(
        mask_samples, target_width, target_height, "bilinear", "disabled"
    )
    mask = mask_samples.squeeze(1).clamp(0.0, 1.0)
    return output, mask
