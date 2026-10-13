"""Image Compare A/B 🆎: the Erase mix, built from the brush strokes.

In Erase mode one picture lies on top of the other and a brush rubs the top
one away. The browser keeps the strokes, not a painted bitmap, so the mix is
built here at the picture's full size whatever size the panel showed it at.

A stroke is ``{"o": 1 or 0, "d": size, "s": soft, "p": [x0, y0, x1, y1, ...]}``:
``o`` 1 rubs the top picture away and 0 brings it back, ``d`` is the brush's
width in pixels of the picture, ``s`` its softness in percent, and ``p`` the
path in pixels of the picture, measured from its top left corner.

The brush is a round core with a soft edge: the core is drawn first, then
blurred. js/shared/compare_erase.mjs holds the same numbers, and the panel
draws its preview from them (tests/test_compare_erase.py keeps the two equal).

No file name crosses from the browser. A run remembers where its two
previews are and gives the panel a key for them (``remember_pair``); Save
sends that key back, and the mix is written under a fixed name.
"""

from __future__ import annotations

import math
import secrets
import threading
from collections import OrderedDict
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

from ._image_save_helpers import next_free_counter, require_output_path
from ._psd_helpers import PSD_MAX_SIDE, write_psd

ERASE_SIZE = (2, 2000)
ERASE_MAX_STROKES = 400
ERASE_MAX_STROKE_POINTS = 600
ERASE_MAX_POINTS = 40000
# A path may leave the picture while the button is held, but not by miles.
ERASE_OUTSIDE = 4096
# What a saved mix is called: compare_00001.png, in the output folder.
SAVE_NAME = "compare"
COUNTER_WIDTH = 5
# How many runs' pictures can still be saved from: the newest ones.
PAIRS_KEPT = 64
PICTURES_GONE = "The two pictures are no longer on the server. Run the workflow again, then save."

_save_lock = threading.Lock()
_pairs: OrderedDict[str, tuple[Path, Path]] = OrderedDict()
_pairs_lock = threading.Lock()


class CompareSaveError(ValueError):
    """A save that cannot be done, in words for the person at the panel."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def brush_core(size: float, soft: float) -> float:
    """Radius of the brush's solid middle. ``soft`` runs 0 to 1."""
    return (size / 2.0) * (1.0 - soft / 2.0)


def brush_sigma(size: float, soft: float) -> float:
    """How far the edge is blurred: 0 for a hard brush, an eighth of the size at full soft."""
    return soft * size / 8.0


def _number(value, low: float, high: float, source: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise CompareSaveError(f"Image Compare: {source} must be a number.")
    return min(high, max(low, float(value)))


def clean_strokes(raw, width: int, height: int) -> list[dict]:
    """The strokes as sent by the browser, checked and held to the limits.

    Everything in a request is somebody else's text: a wrong shape is
    refused, a number out of range is pulled back into it.
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise CompareSaveError("Image Compare: the strokes must be a list.")
    if len(raw) > ERASE_MAX_STROKES:
        raise CompareSaveError(f"Image Compare: at most {ERASE_MAX_STROKES} strokes in one mix.")
    strokes = []
    total = 0
    for item in raw:
        if not isinstance(item, dict):
            raise CompareSaveError("Image Compare: a stroke must be an object.")
        path = item.get("p")
        if not isinstance(path, list) or len(path) < 2 or len(path) % 2:
            raise CompareSaveError("Image Compare: a stroke needs a path of x, y pairs.")
        if len(path) // 2 > ERASE_MAX_STROKE_POINTS:
            raise CompareSaveError(f"Image Compare: at most {ERASE_MAX_STROKE_POINTS} points in one stroke.")
        total += len(path) // 2
        if total > ERASE_MAX_POINTS:
            raise CompareSaveError(f"Image Compare: at most {ERASE_MAX_POINTS} points in one mix.")
        points = [
            (
                _number(path[index], -ERASE_OUTSIDE, width + ERASE_OUTSIDE, "a stroke's x"),
                _number(path[index + 1], -ERASE_OUTSIDE, height + ERASE_OUTSIDE, "a stroke's y"),
            )
            for index in range(0, len(path), 2)
        ]
        strokes.append({
            "erase": bool(_number(item.get("o", 1), 0, 1, "a stroke's kind")),
            "size": _number(item.get("d"), ERASE_SIZE[0], ERASE_SIZE[1], "a stroke's size"),
            "soft": _number(item.get("s", 0), 0, 100, "a stroke's softness") / 100.0,
            "points": points,
        })
    return strokes


def _core_cover(points, core: float, left: int, top: int, right: int, bottom: int) -> np.ndarray:
    """How much of each pixel the brush's solid middle covers along a path.

    The box is in picture pixels and may reach outside the picture. A pixel
    counts by its centre: fully covered a half pixel inside the brush's rim,
    not at all a half pixel outside it.
    """
    cover = np.zeros((bottom - top, right - left), dtype=np.float32)
    reach = core + 1.0
    last = len(points) - 1
    for index in range(max(1, last)):
        x0, y0 = points[index]
        x1, y1 = points[min(index + 1, last)]
        box_left = max(left, int(math.floor(min(x0, x1) - reach)))
        box_right = min(right, int(math.ceil(max(x0, x1) + reach)))
        box_top = max(top, int(math.floor(min(y0, y1) - reach)))
        box_bottom = min(bottom, int(math.ceil(max(y0, y1) + reach)))
        if box_right <= box_left or box_bottom <= box_top:
            continue
        xs = np.arange(box_left, box_right, dtype=np.float32) + 0.5 - x0
        ys = (np.arange(box_top, box_bottom, dtype=np.float32) + 0.5 - y0)[:, None]
        dx, dy = x1 - x0, y1 - y0
        span = dx * dx + dy * dy
        if span > 0:
            along = np.clip((xs * dx + ys * dy) / span, 0.0, 1.0)
            distance = np.hypot(xs - along * dx, ys - along * dy)
        else:
            distance = np.hypot(xs, ys)
        part = cover[box_top - top:box_bottom - top, box_left - left:box_right - left]
        np.maximum(part, np.clip(core - distance + 0.5, 0.0, 1.0), out=part)
    return cover


def erase_mask(strokes: list[dict], width: int, height: int) -> np.ndarray:
    """How much of the top picture is rubbed away: HxW float32, 0 (all there) to 1 (gone).

    Strokes land in order. One that rubs away covers what is under it; one
    that brings back uncovers it, each by its own soft edge.
    """
    gone = np.zeros((height, width), dtype=np.float32)
    for stroke in strokes:
        core = brush_core(stroke["size"], stroke["soft"])
        sigma = brush_sigma(stroke["size"], stroke["soft"])
        blur = sigma >= 0.25
        # Room for the blur to see the brush where it runs off the picture.
        margin = int(math.ceil(3 * sigma)) + 2 if blur else 0
        reach = core + margin + 1
        xs = [point[0] for point in stroke["points"]]
        ys = [point[1] for point in stroke["points"]]
        left = max(-margin, int(math.floor(min(xs) - reach)))
        right = min(width + margin, int(math.ceil(max(xs) + reach)))
        top = max(-margin, int(math.floor(min(ys) - reach)))
        bottom = min(height + margin, int(math.ceil(max(ys) + reach)))
        if right <= left or bottom <= top:
            continue
        cover = _core_cover(stroke["points"], core, left, top, right, bottom)
        if blur:
            soft = Image.fromarray(np.round(cover * 255.0).astype(np.uint8)).filter(ImageFilter.GaussianBlur(sigma))
            cover = np.asarray(soft, dtype=np.float32) / 255.0
        # The part of the box that lies on the picture.
        in_left, in_right = max(left, 0), min(right, width)
        in_top, in_bottom = max(top, 0), min(bottom, height)
        if in_right <= in_left or in_bottom <= in_top:
            continue
        cover = cover[in_top - top:in_bottom - top, in_left - left:in_right - left]
        part = gone[in_top:in_bottom, in_left:in_right]
        if stroke["erase"]:
            part += cover * (1.0 - part)
        else:
            part *= 1.0 - cover
    return np.clip(gone, 0.0, 1.0, out=gone)


def mix_pictures(top: np.ndarray, under: np.ndarray, gone: np.ndarray) -> np.ndarray:
    """The top picture over the one under it, with ``gone`` rubbed out of the top."""
    weight = gone[:, :, None]
    mixed = top.astype(np.float32) * (1.0 - weight) + under.astype(np.float32) * weight
    return np.clip(np.round(mixed), 0, 255).astype(np.uint8)


def remember_pair(picture_a, picture_b) -> str:
    """Keep where one run's two previews are; returns the key the panel sends back.

    The key is all the browser ever names. It is random, it says nothing
    about the files, and only the newest runs are kept.
    """
    key = secrets.token_urlsafe(16)
    with _pairs_lock:
        _pairs[key] = (Path(picture_a), Path(picture_b))
        while len(_pairs) > PAIRS_KEPT:
            _pairs.popitem(last=False)
    return key


def pair_pictures(key) -> tuple[Path, Path]:
    """The two previews a key stands for, or the error that says to run again."""
    with _pairs_lock:
        pair = _pairs.get(key) if isinstance(key, str) else None
    if pair is None or not all(path.is_file() for path in pair):
        raise CompareSaveError(PICTURES_GONE, status=404)
    return pair


def _load_rgb(path: Path) -> np.ndarray:
    with Image.open(path) as image:
        return np.asarray(image.convert("RGB"))


def save_mix(*, picture_a, picture_b, output_dir, top="A", strokes=None, layers=False) -> dict:
    """Build the mix of two previews and write it to the output folder.

    Writes ``compare_00001.png``. With ``layers`` it also writes
    ``compare_00001.psd`` (the picture underneath, then the top picture with
    the rubbed-out area as its layer mask) and ``compare_00001_mask.png``
    (white where the picture underneath shows). Returns what was written.
    """
    if top not in ("A", "B"):
        raise CompareSaveError("Image Compare: the top picture is A or B.")
    try:
        first = _load_rgb(Path(picture_a))
        with Image.open(Path(picture_b)) as image:
            image = image.convert("RGB")
            height, width = first.shape[:2]
            # The mix is always A's size; a B of another size is fitted to it.
            if image.size != (width, height):
                image = image.resize((width, height), Image.LANCZOS)
            second = np.asarray(image)
    except OSError as error:
        raise CompareSaveError(PICTURES_GONE, status=404) from error
    if max(height, width) > PSD_MAX_SIDE:
        raise CompareSaveError(f"Image Compare: pictures up to {PSD_MAX_SIDE} px a side can be mixed.")

    gone = erase_mask(clean_strokes(strokes, width, height), width, height)
    upper, under = (first, second) if top == "A" else (second, first)
    mixed = mix_pictures(upper, under, gone)

    folder = Path(output_dir)
    with _save_lock:
        folder.mkdir(parents=True, exist_ok=True)
        counter = next_free_counter((entry.name for entry in folder.iterdir()), SAVE_NAME)
        while True:
            stem = f"{SAVE_NAME}_{counter:0{COUNTER_WIDTH}}"
            wanted = [f"{stem}.png"] + ([f"{stem}.psd", f"{stem}_mask.png"] if layers else [])
            if not any((folder / file).exists() for file in wanted):
                break
            counter += 1
        for file in wanted:
            # A name that is a link out of the folder is refused, as Save Image does.
            require_output_path(folder / file, folder)
        Image.fromarray(mixed).save(folder / wanted[0], compress_level=4)
        if layers:
            under_name, upper_name = ("B", "A") if top == "A" else ("A", "B")
            shown = np.round((1.0 - gone) * 255.0).astype(np.uint8)
            write_psd(
                folder / wanted[1],
                [{"name": under_name, "rgb": under}, {"name": upper_name, "rgb": upper, "mask": shown}],
                mixed,
            )
            Image.fromarray(255 - shown).save(folder / wanted[2], compress_level=4)

    return {
        "files": [{"filename": file, "subfolder": "", "type": "output"} for file in wanted],
        "width": width,
        "height": height,
    }


__all__ = [
    "CompareSaveError",
    "ERASE_MAX_POINTS",
    "ERASE_MAX_STROKES",
    "ERASE_MAX_STROKE_POINTS",
    "ERASE_OUTSIDE",
    "ERASE_SIZE",
    "PAIRS_KEPT",
    "SAVE_NAME",
    "brush_core",
    "brush_sigma",
    "clean_strokes",
    "erase_mask",
    "mix_pictures",
    "pair_pictures",
    "remember_pair",
    "save_mix",
]
