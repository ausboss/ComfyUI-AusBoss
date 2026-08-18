"""Temp-folder previews for nodes that want to show their own result.

A node does not have to be an OUTPUT_NODE to put a picture on its own face:
returning ``{"ui": {"images": [...]}, "result": (...)}`` is enough, because
ComfyUI sends an ``executed`` message for any node that returns a ui payload
(execution.py, "if len(output_ui) > 0"). The frontend hangs those images on
the node, which is what the AusBoss preview panel then draws.

The images land in ComfyUI's temp folder, the same place PreviewImage writes,
so they are swept up with the rest of the session's scratch files.
"""

from __future__ import annotations

import random
import string
from pathlib import Path

import torch
from PIL import Image

try:
    import folder_paths
except ImportError:  # Offline tests import these modules without ComfyUI.
    folder_paths = None


def temp_prefix(node: str) -> str:
    """A temp filename prefix unique to one node instance.

    Two copies of the same node in one workflow write previews at the same
    moment; without a per-instance prefix the second would overwrite the
    first and both panels would show the same picture.
    """
    return f"ausboss_{node}_" + "".join(random.choices(string.ascii_lowercase, k=5))


def first_frame_to_pil(image: torch.Tensor, source: str = "Preview") -> Image.Image:
    """First frame of a BHWC float batch as a PIL image, ready to save.

    A single-channel frame becomes an 8-bit grayscale image rather than a
    1-channel RGB one, which is how a mask arrives here once its BHW shape has
    been unsqueezed into BHWC.
    """
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError(f"{source} expected a BHWC IMAGE batch.")
    if int(image.shape[0]) < 1:
        raise ValueError(f"{source} received an empty IMAGE batch.")
    frame = image[0].detach().cpu().float().clamp(0.0, 1.0).mul(255.0).round().to(torch.uint8)
    array = frame.numpy()
    if array.shape[-1] == 1:
        array = array[..., 0]
    elif array.shape[-1] > 3:
        # Drop alpha: the panel composites onto its own dark stage, so a
        # transparent preview would read as a hole rather than as coverage.
        array = array[..., :3]
    return Image.fromarray(array)


def mask_to_preview_batch(mask: torch.Tensor, source: str = "Preview") -> torch.Tensor:
    """A BHW MASK seen as a one-channel BHWC batch, for first_frame_to_pil."""
    if not isinstance(mask, torch.Tensor) or mask.ndim != 3:
        raise ValueError(f"{source} expected a BHW MASK.")
    return mask.unsqueeze(-1)


def save_temp_preview(image: torch.Tensor, prefix: str, source: str = "Preview") -> dict:
    """Write one preview PNG to the temp folder; returns its ui.images entry."""
    if folder_paths is None:
        raise RuntimeError(f"{source} requires ComfyUI's folder_paths at runtime.")
    preview = first_frame_to_pil(image, source)
    full_output_folder, filename, counter, subfolder, _prefix = (
        folder_paths.get_save_image_path(
            prefix,
            folder_paths.get_temp_directory(),
            preview.width,
            preview.height,
        )
    )
    file = f"{filename}_{counter:05}_.png"
    preview.save(Path(full_output_folder) / file, compress_level=4)
    return {
        "filename": file,
        "subfolder": subfolder,
        "type": "temp",
        "width": preview.width,
        "height": preview.height,
    }


def preview_payload(image: torch.Tensor, prefix: str, source: str, result: tuple) -> dict:
    """The node return that carries both a preview and the real outputs.

    A preview is a convenience, never the job: if writing it fails - a full
    disk, a temp folder someone cleaned mid-run - the node still returns its
    outputs and only the panel goes quiet.
    """
    try:
        images = [save_temp_preview(image, prefix, source)]
    except Exception as exc:  # noqa: BLE001 - any failure here is non-fatal
        detail = str(exc).encode("ascii", "replace").decode("ascii")
        print(f"[AusBoss] {source}: preview unavailable ({detail}).")
        return {"result": result}
    return {"ui": {"images": images}, "result": result}


__all__ = [
    "first_frame_to_pil",
    "mask_to_preview_batch",
    "preview_payload",
    "save_temp_preview",
    "temp_prefix",
]
