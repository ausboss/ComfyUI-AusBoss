"""Image Folder helpers: which pictures a folder holds, which of them are picked,
and how one is loaded.

Everything here works on plain paths, so tests run without ComfyUI. The node
hands in ComfyUI's input or output folder as the root. A folder name comes
from a widget or a route, so it is attacker-controlled: it is only ever read
as a path below that root, and anything that leaves it is refused.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from collections import OrderedDict
from io import BytesIO
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageOps

SOURCES = ("input", "output")
SORTS = ("name", "newest first", "oldest first")
RUNS = ("all in one run", "one per run")
AT_THE_END = ("stop the run", "start over")
# What the editor does with Picture once a run is queued. A run itself loads what Picture says.
AFTER_RUN = ("next", "stay", "random")
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff")
# A folder this full is listed up to here; the gallery says so.
MAX_PICTURES = 5000
# Core Load Image hands out a 64 x 64 mask of zeros for a picture with no
# see-through part. The pack's mask nodes know that stand-in ("no mask").
NO_MASK_SIZE = (64, 64)

OUTSIDE = "Image Folder reads only folders inside ComfyUI's input or output folder."
NO_FOLDER = 'Image Folder: there is no folder "{folder}" in ComfyUI\'s {source} folder.'
NO_PICTURES = 'Image Folder: no pictures in "{folder}". Add some, or choose another folder.'
NONE_LEFT = "Image Folder: none of the picked pictures are in the folder anymore. Pick again on the node."
NONE_PICKED = "Image Folder: no picture is picked. Tick at least one on the node, or press All."
BAD_PICKS = "Image Folder: the list of picked pictures cannot be read. Pick again on the node."
THE_END = (
    "Image Folder: that was the last picture ({count} of {count}). "
    "Set Picture back to 1 to go through them again."
)


def shown_folder(folder: str, source: str = "input") -> str:
    """The folder the way a message names it: the top folder has no name of its own."""
    text = clean_folder(folder)
    return text or f"the {source} folder"


def clean_folder(folder) -> str:
    """A folder name with forward slashes and no stray separators. Raises when
    it points anywhere but below the root."""
    text = str(folder or "").strip().replace("\\", "/")
    if text.startswith("/") or text.startswith("~") or re.match(r"^[A-Za-z]:", text):
        raise ValueError(OUTSIDE)
    parts = [part for part in text.split("/") if part not in ("", ".")]
    if any(part == ".." for part in parts):
        raise ValueError(OUTSIDE)
    return "/".join(parts)


def safe_folder(root, folder, source: str = "input") -> Path:
    """The folder as a real path below `root`. A link that leads out of the
    root is refused like any other way out."""
    relative = clean_folder(folder)
    top = Path(root).resolve()
    target = top.joinpath(*relative.split("/")).resolve() if relative else top
    if target != top and top not in target.parents:
        raise ValueError(OUTSIDE)
    if not target.is_dir():
        raise ValueError(NO_FOLDER.format(folder=relative, source=source))
    return target


def natural_key(name: str):
    """photo_2 before photo_10, upper and lower case together."""
    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", str(name))]


def list_folders(root, folder, source: str = "input") -> list[str]:
    """The folders directly inside `folder`, for the Browse list."""
    base = safe_folder(root, folder, source)
    names = []
    for entry in base.iterdir():
        if entry.name.startswith(".") or entry.is_symlink() or not entry.is_dir():
            continue
        names.append(entry.name)
    return sorted(names, key=natural_key)


def list_pictures(root, folder, subfolders: bool = False, sort: str = "name", source: str = "input",
                  limit: int = MAX_PICTURES) -> list[dict]:
    """Every picture in the folder: {"name": path below the folder, "path",
    "mtime", "size"}, in the chosen order. Hidden files, links that lead out
    of the root and anything that is not a picture are left out."""
    base = safe_folder(root, folder, source)
    top = Path(root).resolve()
    found: list[dict] = []
    if subfolders:
        walker = os.walk(base, followlinks=False)
    else:
        walker = [(str(base), [], sorted(os.listdir(base)))]
    for directory, folders, files in walker:
        folders[:] = sorted(name for name in folders if not name.startswith("."))
        for name in files:
            if name.startswith(".") or not name.lower().endswith(IMAGE_EXTENSIONS):
                continue
            path = Path(directory) / name
            try:
                real = path.resolve()
                if top not in real.parents or not real.is_file():
                    continue
                stat = real.stat()
            except OSError:
                continue
            found.append({
                "name": path.relative_to(base).as_posix(),
                "path": real,
                "mtime": float(stat.st_mtime),
                "size": int(stat.st_size),
            })
            if len(found) >= limit:
                break
        if len(found) >= limit:
            break
    if sort == "newest first":
        found.sort(key=lambda item: (-item["mtime"], natural_key(item["name"])))
    elif sort == "oldest first":
        found.sort(key=lambda item: (item["mtime"], natural_key(item["name"])))
    else:
        found.sort(key=lambda item: natural_key(item["name"]))
    return found


def parse_picked(text) -> list[str] | None:
    """The picked pictures from the widget: None means every picture."""
    raw = str(text or "").strip()
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except ValueError as error:
        raise ValueError(BAD_PICKS) from error
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(BAD_PICKS)
    names = [item.replace("\\", "/") for item in value]
    return list(dict.fromkeys(names))


def choose(pictures: list[dict], picked: list[str] | None) -> list[dict]:
    """The picked pictures in the folder's order. Picked names are only ever
    compared with what the folder holds, never opened as paths."""
    if picked is None:
        return list(pictures)
    if not picked:
        raise ValueError(NONE_PICKED)
    wanted = set(picked)
    chosen = [item for item in pictures if item["name"] in wanted]
    if not chosen:
        raise ValueError(NONE_LEFT)
    return chosen


def which(count: int, position, run: str, at_the_end: str) -> list[int]:
    """Which of `count` picked pictures this run loads, counted from 0."""
    if run != "one per run":
        return list(range(count))
    place = max(1, int(position))
    if place > count:
        if at_the_end == "start over":
            return [(place - 1) % count]
        raise RuntimeError(THE_END.format(count=count))
    return [place - 1]


def output_name(name: str) -> str:
    """The name a result is saved under: the file name without its ending. A
    picture from a folder inside carries that folder in front, so two files
    with one name never land on each other."""
    stem = name.rsplit(".", 1)[0] if "." in name.rsplit("/", 1)[-1] else name
    return stem.replace("/", "_")


def _has_see_through(frame: Image.Image) -> bool:
    return frame.mode in ("RGBA", "LA", "PA") or (frame.mode == "P" and "transparency" in frame.info)


def load_picture(path) -> tuple[torch.Tensor, torch.Tensor]:
    """(1 x H x W x 3 image, mask). The mask is white where the picture is
    see-through, as core Load Image has it, and the 64 x 64 stand-in when the
    picture has no see-through part."""
    with Image.open(path) as source:
        frame = ImageOps.exif_transpose(source)
        if frame.mode == "I":
            frame = frame.point(lambda value: value * (1 / 255))
        see_through = _has_see_through(frame)
        rgba = np.asarray(frame.convert("RGBA"), dtype=np.float32) / 255.0
    image = torch.from_numpy(rgba[..., :3].copy()).unsqueeze(0)
    if see_through:
        mask = (1.0 - torch.from_numpy(rgba[..., 3].copy())).unsqueeze(0)
    else:
        mask = torch.zeros((1, *NO_MASK_SIZE), dtype=torch.float32)
    return image, mask


def fingerprint(pictures: list[dict]) -> str:
    """Changes when a picked file is added, removed or rewritten."""
    digest = hashlib.sha1()
    for item in pictures:
        digest.update(f"{item['name']}|{item['mtime']}|{item['size']}\n".encode("utf-8"))
    return digest.hexdigest()


# --- thumbnails for the gallery -------------------------------------------------
_THUMBS: "OrderedDict[tuple, bytes]" = OrderedDict()
_THUMBS_LOCK = threading.Lock()
_THUMBS_BYTES = 24 * 1024 * 1024
_thumbs_size = 0
THUMB_BACK = (27, 35, 38)


def thumbnail(path, edge: int = 160) -> bytes:
    """A small JPEG of the picture. A see-through part shows on the gallery's
    dark tile. Kept in a small cache keyed by the file's state."""
    global _thumbs_size
    edge = max(48, min(512, int(edge)))
    real = Path(path)
    stat = real.stat()
    key = (str(real), int(stat.st_mtime_ns), int(stat.st_size), edge)
    with _THUMBS_LOCK:
        hit = _THUMBS.get(key)
        if hit is not None:
            _THUMBS.move_to_end(key)
            return hit
    with Image.open(real) as source:
        source.draft("RGB", (edge * 2, edge * 2))        # a JPEG decodes small straight away
        frame = ImageOps.exif_transpose(source)
        if frame.mode == "I":
            frame = frame.point(lambda value: value * (1 / 255))
        if _has_see_through(frame):
            rgba = frame.convert("RGBA")
            rgba.thumbnail((edge, edge), Image.Resampling.LANCZOS)
            small = Image.new("RGB", rgba.size, THUMB_BACK)
            small.paste(rgba, (0, 0), rgba)
        else:
            small = frame.convert("RGB")
            small.thumbnail((edge, edge), Image.Resampling.LANCZOS)
    out = BytesIO()
    small.save(out, format="JPEG", quality=82)
    data = out.getvalue()
    with _THUMBS_LOCK:
        if key not in _THUMBS:
            _THUMBS[key] = data
            _thumbs_size += len(data)
            while _thumbs_size > _THUMBS_BYTES and len(_THUMBS) > 1:
                _, old = _THUMBS.popitem(last=False)
                _thumbs_size -= len(old)
    return data


__all__ = [
    "AFTER_RUN",
    "AT_THE_END",
    "BAD_PICKS",
    "IMAGE_EXTENSIONS",
    "MAX_PICTURES",
    "NONE_LEFT",
    "NONE_PICKED",
    "NO_FOLDER",
    "NO_MASK_SIZE",
    "NO_PICTURES",
    "OUTSIDE",
    "RUNS",
    "SORTS",
    "SOURCES",
    "THE_END",
    "choose",
    "clean_folder",
    "fingerprint",
    "list_folders",
    "list_pictures",
    "load_picture",
    "natural_key",
    "output_name",
    "parse_picked",
    "safe_folder",
    "shown_folder",
    "thumbnail",
    "which",
]
