"""Naming, policy, and encoding for the AusBoss Save Image node.

The naming and collision logic is pure so tests can drive it without a
filesystem; the two encoders (PNG, JPEG XL) sit at the bottom and are the
only functions that touch PIL.
"""

from __future__ import annotations

import json
from pathlib import Path, PurePosixPath, PureWindowsPath

import numpy as np
import torch
from PIL import Image

# Extensions recognized (and stripped) on an exact filename, so pairing a
# save with "photo123.jpg" under png format yields photo123.png, not
# photo123.jpg.png. Anything else after a dot is part of the name.
IMAGE_EXTENSIONS = {
    ".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".jxl",
    ".png", ".tif", ".tiff", ".webp",
}

IMAGE_FORMATS = ("png", "jxl lossless")
EXISTING_POLICIES = ("overwrite", "skip", "error")

FORMAT_EXTENSIONS = {"png": "png", "jxl lossless": "jxl"}


def metadata_disabled() -> bool:
    """True when ComfyUI was launched with --disable-metadata.

    That flag is the server owner's decision that no save embeds workflows,
    so it overrides the node's own toggle. Fail-soft outside ComfyUI.
    """
    try:
        from comfy.cli_args import args

        return bool(getattr(args, "disable_metadata", False))
    except Exception:
        return False


def jxl_available() -> bool:
    """True when the optional pillow-jxl-plugin can register the codec."""
    try:
        import pillow_jxl  # noqa: F401
    except Exception:
        return False
    return True


def strip_image_extension(name: str) -> str:
    """Drop one trailing image extension; other suffixes stay part of the name."""
    text = str(name or "").strip()
    suffix = PurePosixPath(text).suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        return text[: -len(suffix)]
    return text


def sanitize_exact_name(name: str) -> str:
    """Normalize an exact name into a safe relative subpath.

    Widget values are attacker-controlled: parent traversal, drive letters,
    and rooted paths are rejected rather than silently rewritten, so the
    save always lands inside the chosen output root. Forward and backward
    slashes both separate subfolders.
    """
    text = str(name or "").strip().replace("\\", "/")
    if not text:
        return ""
    if PureWindowsPath(text).drive or text.startswith("/"):
        raise ValueError("Save Image: exact_name must be a relative name, not a rooted path.")
    parts = [part for part in text.split("/") if part not in ("", ".")]
    if any(part == ".." for part in parts):
        raise ValueError("Save Image: exact_name may not contain '..'.")
    if not parts:
        return ""
    return "/".join(parts)


def resolve_output_root(output_dir: str, default_root: str | Path) -> Path:
    """'' -> the default root; relative -> under it; absolute -> as given."""
    text = str(output_dir or "").strip()
    default = Path(default_root)
    if not text:
        return default
    candidate = Path(text).expanduser()
    if candidate.is_absolute():
        return candidate
    resolved = (default / candidate).resolve()
    if default.resolve() not in resolved.parents and resolved != default.resolve():
        raise ValueError("Save Image: a relative output_dir may not escape the output folder.")
    return resolved


def plan_exact_names(base: str, extension: str, count: int) -> list[str]:
    """One exact filename, or numbered siblings for a batch.

    A single image gets exactly ``base.ext`` — the whole point of exact
    mode. A batch cannot share one name, so frames become base_001.ext …
    in a stable width that sorts correctly.
    """
    if count <= 0:
        return []
    if count == 1:
        return [f"{base}.{extension}"]
    width = max(3, len(str(count)))
    return [f"{base}_{index:0{width}}.{extension}" for index in range(1, count + 1)]


def existing_action(exists: bool, policy: str) -> str:
    """'write' or 'skip'; the error policy raises so the run stops loudly."""
    if policy not in EXISTING_POLICIES:
        raise ValueError(f"Save Image: on_existing must be one of {EXISTING_POLICIES}.")
    if not exists:
        return "write"
    if policy == "overwrite":
        return "write"
    if policy == "skip":
        return "skip"
    raise ValueError("Save Image: the file already exists and on_existing is 'error'.")


def sidecar_path(image_path: Path) -> Path:
    """The caption .txt sharing the image's exact basename."""
    return image_path.with_suffix(".txt")


def frame_to_pil(frame: torch.Tensor) -> Image.Image:
    array = np.clip(frame.detach().cpu().numpy() * 255.0, 0, 255).astype(np.uint8)
    return Image.fromarray(array)


def _png_info(metadata: dict | None):
    if not metadata:
        return None
    from PIL.PngImagePlugin import PngInfo

    info = PngInfo()
    for key, value in metadata.items():
        info.add_text(key, value)
    return info


def _jxl_exif(metadata: dict | None) -> bytes | None:
    """Workflow JSON in EXIF, mirroring core's animated-webp convention
    (prompt in Make, workflow and friends in ImageDescription)."""
    if not metadata:
        return None
    exif = Image.Exif()
    prompt = metadata.get("prompt")
    if prompt is not None:
        exif[0x010F] = "prompt:" + prompt
    rest = {key: value for key, value in metadata.items() if key != "prompt"}
    if rest:
        exif[0x010E] = json.dumps({key: json.loads(value) for key, value in rest.items()})
    return exif.tobytes()


def encode_image(path: Path, frame: torch.Tensor, format_name: str, metadata: dict | None) -> None:
    """Write one frame; metadata=None saves clean."""
    image = frame_to_pil(frame)
    if format_name == "png":
        image.save(path, format="PNG", pnginfo=_png_info(metadata), compress_level=4)
        return
    if format_name == "jxl lossless":
        if not jxl_available():
            raise RuntimeError(
                "Save Image: JPEG XL needs the optional pillow-jxl-plugin "
                "(pip install pillow-jxl-plugin into ComfyUI's python)."
            )
        kwargs = {"format": "JXL", "lossless": True}
        exif = _jxl_exif(metadata)
        if exif is not None:
            kwargs["exif"] = exif
        try:
            image.save(path, **kwargs)
        except TypeError:
            # A plugin build without exif passthrough: the pixels still save.
            kwargs.pop("exif", None)
            image.save(path, **kwargs)
        return
    raise ValueError(f"Save Image: unknown format '{format_name}'.")


__all__ = [
    "EXISTING_POLICIES",
    "FORMAT_EXTENSIONS",
    "IMAGE_EXTENSIONS",
    "IMAGE_FORMATS",
    "encode_image",
    "existing_action",
    "frame_to_pil",
    "jxl_available",
    "metadata_disabled",
    "plan_exact_names",
    "resolve_output_root",
    "sanitize_exact_name",
    "sidecar_path",
    "strip_image_extension",
]
