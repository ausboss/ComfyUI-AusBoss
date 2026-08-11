"""Dependency-light TorchScript LaMa inference for AusBoss nodes."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import torch
import torch.nn.functional as functional

try:
    import folder_paths
except ImportError:  # Offline tests import this module without ComfyUI.
    folder_paths = None


MODEL_FOLDER = "lama"
MODEL_EXTENSIONS = {".pt", ".pth"}
DEFAULT_MODEL_NAME = "big-lama.pt"


def register_lama_model_folder() -> None:
    """Expose ComfyUI/models/lama without creating or downloading files."""
    if folder_paths is None:
        return
    model_directory = str(Path(folder_paths.models_dir, MODEL_FOLDER))
    existing = folder_paths.folder_names_and_paths.get(MODEL_FOLDER)
    if existing is None:
        folder_paths.folder_names_and_paths[MODEL_FOLDER] = (
            [model_directory],
            set(MODEL_EXTENSIONS),
        )
        return
    paths, extensions = existing
    if model_directory not in paths:
        paths.append(model_directory)
    extensions.update(MODEL_EXTENSIONS)


def list_lama_models() -> list[str]:
    register_lama_model_folder()
    if folder_paths is None:
        return [DEFAULT_MODEL_NAME]
    models = folder_paths.get_filename_list(MODEL_FOLDER)
    return models or [DEFAULT_MODEL_NAME]


def resolve_lama_model(model_name: str) -> Path:
    register_lama_model_folder()
    if folder_paths is None:
        path = Path(model_name).expanduser().resolve()
        if path.is_file():
            return path
    else:
        resolved = folder_paths.get_full_path(MODEL_FOLDER, model_name)
        if resolved:
            return Path(resolved).resolve()
    raise FileNotFoundError(
        f"LaMa model '{model_name}' was not found. Place the TorchScript "
        f"checkpoint at ComfyUI/models/lama/{DEFAULT_MODEL_NAME}, then refresh "
        "the node's model list."
    )


def comfy_torch_device() -> torch.device:
    try:
        from comfy.model_management import get_torch_device

        return torch.device(get_torch_device())
    except ImportError:
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")


@lru_cache(maxsize=2)
def load_lama_model(model_path: str):
    # Cached on CPU so ComfyUI's VRAM stays free between runs; run_lama_inpaint
    # moves the module to the compute device only for the duration of a batch.
    model = torch.jit.load(model_path, map_location="cpu")
    model.eval()
    return model


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


def _validate_images(images: torch.Tensor) -> None:
    if not isinstance(images, torch.Tensor) or images.ndim != 4:
        raise ValueError("LaMa Inpaint expected images in BHWC format.")
    if images.shape[0] < 1 or images.shape[-1] < 3:
        raise ValueError("LaMa Inpaint requires at least one RGB image.")
    if not torch.isfinite(images).all():
        raise ValueError("LaMa Inpaint received non-finite image values.")


def _normalized_masks(
    masks: torch.Tensor, image_count: int, height: int, width: int
) -> torch.Tensor:
    if isinstance(masks, torch.Tensor) and masks.ndim == 2:
        masks = masks.unsqueeze(0)
    if not isinstance(masks, torch.Tensor) or masks.ndim != 3:
        raise ValueError("LaMa Inpaint expected masks in BHW format.")
    if masks.shape[0] not in {1, image_count}:
        raise ValueError(
            "LaMa Inpaint needs one mask for the whole image batch or one mask "
            "per image."
        )
    if not torch.isfinite(masks).all():
        raise ValueError("LaMa Inpaint received non-finite mask values.")
    normalized = masks.float().clamp(0.0, 1.0)
    if tuple(normalized.shape[-2:]) != (height, width):
        normalized = functional.interpolate(
            normalized.unsqueeze(1),
            size=(height, width),
            mode="bilinear",
            align_corners=False,
        ).squeeze(1)
    if normalized.shape[0] == 1 and image_count > 1:
        normalized = normalized.expand(image_count, -1, -1)
    return normalized


def _first_tensor(model_output) -> torch.Tensor:
    if isinstance(model_output, torch.Tensor):
        return model_output
    if isinstance(model_output, (tuple, list)) and model_output:
        return _first_tensor(model_output[0])
    if isinstance(model_output, dict):
        for key in ("inpainted", "image", "output"):
            if key in model_output:
                return _first_tensor(model_output[key])
    raise RuntimeError("The selected LaMa model returned an unsupported output.")


def inpaint_with_model(
    images: torch.Tensor,
    masks: torch.Tensor,
    model,
    device: torch.device,
) -> torch.Tensor:
    """Run one frame at a time and preserve pixels where the mask is zero."""
    _validate_images(images)
    image_count, height, width, _channels = images.shape
    normalized_masks = _normalized_masks(masks, image_count, height, width)
    outputs: list[torch.Tensor] = []
    progress = _progress_bar(image_count)

    for index in range(image_count):
        _raise_if_interrupted()
        source = images[index].float().clamp(0.0, 1.0)
        rgb = source[..., :3].permute(2, 0, 1).unsqueeze(0).to(device)
        soft_mask = normalized_masks[index].unsqueeze(0).unsqueeze(0).to(device)
        model_mask = (soft_mask > 0.0).to(dtype=rgb.dtype)

        pad_height = (-height) % 8
        pad_width = (-width) % 8
        if pad_height or pad_width:
            rgb = functional.pad(rgb, (0, pad_width, 0, pad_height), mode="replicate")
            model_mask = functional.pad(model_mask, (0, pad_width, 0, pad_height))

        with torch.inference_mode():
            generated = _first_tensor(model(rgb, model_mask)).float()
        if generated.ndim != 4 or generated.shape[0] != 1 or generated.shape[1] < 3:
            raise RuntimeError(
                "The selected LaMa model did not return a BCHW RGB image batch."
            )
        generated = torch.nan_to_num(
            generated[:, :3, :height, :width], nan=0.0, posinf=1.0, neginf=0.0
        )
        original_rgb = rgb[:, :3, :height, :width]
        blend_mask = soft_mask[:, :, :height, :width]
        blended = generated * blend_mask + original_rgb * (1.0 - blend_mask)
        output_rgb = blended.squeeze(0).permute(1, 2, 0).to(source.device)
        if source.shape[-1] > 3:
            output_rgb = torch.cat((output_rgb, source[..., 3:]), dim=-1)
        outputs.append(output_rgb.to(dtype=images.dtype).clamp(0.0, 1.0))
        if progress is not None:
            progress.update(1)

    return torch.stack(outputs, dim=0)


def run_lama_inpaint(
    images: torch.Tensor, masks: torch.Tensor, model_name: str
) -> torch.Tensor:
    model_path = resolve_lama_model(model_name)
    device = comfy_torch_device()
    model = load_lama_model(str(model_path))
    model.to(device)
    try:
        return inpaint_with_model(images, masks, model, device)
    finally:
        if device.type != "cpu":
            model.to(torch.device("cpu"))


register_lama_model_folder()

__all__ = [
    "DEFAULT_MODEL_NAME",
    "inpaint_with_model",
    "list_lama_models",
    "resolve_lama_model",
    "run_lama_inpaint",
]
