"""Image Compare A/B 🆎: the Erase mix, built from the brush strokes.

In Erase mode one picture lies on top of the other and a brush rubs the top
one away. The browser keeps the strokes, not a painted bitmap, so the mix is
built here at the picture's full size whatever size the panel showed it at.

A stroke is ``{"o": 1 or 0, "d": size, "s": soft, "p": [x0, y0, x1, y1, ...]}``:
``o`` 1 rubs the top picture away and 0 brings it back, ``d`` is the brush's
width in pixels of the picture, ``s`` its softness in percent, and ``p`` the
path in pixels of the picture, measured from its top left corner.

The brush is the pack's shared one (``_brush_helpers.py``): a round core with
a soft edge, the core drawn first, then blurred. js/shared/brush.mjs holds
the same numbers, and the panel draws its preview from them
(tests/test_compare_erase.py keeps the two equal).

The browser never names a file to read. A run remembers where its two
previews are and gives the panel a key for them (``remember_pair``); Save
sends that key back. What Save may send is a name for the new files: plain
text with no folder in it, checked by ``clean_save_name``. The files always
go straight into the output folder.
"""

from __future__ import annotations

import logging
import math
import re
import secrets
import threading
from collections import OrderedDict
from pathlib import Path

import numpy as np
import torch
from PIL import Image

from ._brush_helpers import brush_core, brush_sigma, stroke_cover  # noqa: F401 - the brush's numbers are read from here too
from ._image_save_helpers import next_free_counter, require_output_path, strip_image_extension
from ._psd_helpers import PSD_MAX_SIDE, write_psd
from ._realign_helpers import crop_if_shift, measure, warp_to_source

ERASE_SIZE = (2, 2000)
ERASE_MAX_STROKES = 400
ERASE_MAX_STROKE_POINTS = 600
ERASE_MAX_POINTS = 40000
# A path may leave the picture while the button is held, but not by miles.
ERASE_OUTSIDE = 4096
# What a saved mix is called when no name is given: compare_00001.png.
SAVE_NAME = "compare"
SAVE_NAME_MAX = 80
# A name is letters, digits, spaces, dots, dashes and underscores: nothing a
# folder or a drive is written with.
_NAME_RULE = re.compile(r"[\w][\w .\-]*")
_NOT_IN_A_NAME = re.compile(r"[^\w .\-]+")
SAVE_NAME_HELP = (
    "Image Compare: a file name takes letters, digits, spaces, dots, dashes and underscores, "
    f"up to {SAVE_NAME_MAX} of them. It goes into the output folder; a folder cannot be part of it."
)
COUNTER_WIDTH = 5
# How many runs' pictures can still be saved from: the newest ones.
PAIRS_KEPT = 64
PICTURES_GONE = "The two pictures are no longer on the server. Run the workflow again, then save."
# Align: Realign to Source's measuring, on the two previews. A zoom past this
# fraction is not trusted (Realign's own default), and a B that is off by
# less than this many pixels everywhere already lines up.
ALIGN_MAX_ZOOM = 0.2
ALIGN_SETTLED = 0.5
ALIGN_GONE = "The two pictures are no longer on the server. Run the workflow again, then align."
ALIGN_FAILED = (
    "Align could not line the pictures up. They may differ too much, "
    "or have too little detail to measure."
)

_save_lock = threading.Lock()
_pairs: OrderedDict[str, tuple[Path, Path, str]] = OrderedDict()
_pairs_lock = threading.Lock()


class CompareSaveError(ValueError):
    """A save that cannot be done, in words for the person at the panel."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


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


def erase_mask(strokes: list[dict], width: int, height: int) -> np.ndarray:
    """How much of the top picture is rubbed away: HxW float32, 0 (all there) to 1 (gone).

    Strokes land in order. One that rubs away covers what is under it; one
    that brings back uncovers it, each by its own soft edge.
    """
    gone = np.zeros((height, width), dtype=np.float32)
    for stroke in strokes:
        covered = stroke_cover(stroke["points"], stroke["size"], stroke["soft"], width, height)
        if covered is None:
            continue
        left, top, cover = covered
        part = gone[top:top + cover.shape[0], left:left + cover.shape[1]]
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


def clean_save_name(name) -> str:
    """The name typed on the node for the saved files, checked. Empty is the default name.

    It comes with the Save request, so it is somebody else's text: anything
    that is not a plain name is refused, never repaired into one.
    """
    if name is None:
        return SAVE_NAME
    if not isinstance(name, str):
        raise CompareSaveError(SAVE_NAME_HELP)
    typed = name.strip()
    if not typed:
        return SAVE_NAME
    text = strip_image_extension(typed).strip(" .")
    if not text or len(text) > SAVE_NAME_MAX or not _NAME_RULE.fullmatch(text) or ".." in text:
        raise CompareSaveError(SAVE_NAME_HELP)
    return text


def tidy_save_name(name) -> str:
    """A name wired into the node, made into a plain file name. Empty when there is none.

    A wire often carries a source picture's file name, folder and extension
    included (``sets/a/photo 12.jpg``): the last part is kept, the extension
    goes, and anything a file name cannot hold becomes an underscore. A run
    is never stopped over a name.
    """
    if not isinstance(name, str):
        return ""
    last = name.replace("\\", "/").rsplit("/", 1)[-1]
    text = _NOT_IN_A_NAME.sub("_", strip_image_extension(last.strip())).replace("..", "_").strip(" ._")
    return text[:SAVE_NAME_MAX].strip(" ._")


def remember_pair(picture_a, picture_b, name: str = "") -> str:
    """Keep where one run's two previews are; returns the key the panel sends back.

    The key is all the browser ever names of them. It is random, it says
    nothing about the files, and only the newest runs are kept. ``name`` is
    the save name the run was wired with, already tidied, or empty.
    """
    key = secrets.token_urlsafe(16)
    with _pairs_lock:
        _pairs[key] = (Path(picture_a), Path(picture_b), str(name or ""))
        while len(_pairs) > PAIRS_KEPT:
            _pairs.popitem(last=False)
    return key


def pair_pictures(key) -> tuple[Path, Path, str]:
    """The two previews a key stands for and the run's wired name, or the error that says to run again."""
    with _pairs_lock:
        pair = _pairs.get(key) if isinstance(key, str) else None
    if pair is None or not all(path.is_file() for path in pair[:2]):
        raise CompareSaveError(PICTURES_GONE, status=404)
    return pair


def align_pair(*, picture_a, picture_b, temp_root, name: str = "") -> dict:
    """Line B up with A when a model drew it a little moved or zoomed.

    Measures B against A the way Realign to Source does, then writes B,
    lined up and at A's size, beside B's own preview in the temp folder.
    Where B was moved off its edge, A fills the gap, so a mix shows A there.
    Returns ``aligned`` and a ``message`` for the person; when B was moved,
    also the new ``file`` and the ``pair`` key that stands for A with it.
    """
    try:
        first = _load_rgb(Path(picture_a))
        second = _load_rgb(Path(picture_b))
    except OSError as error:
        raise CompareSaveError(ALIGN_GONE, status=404) from error
    source = torch.from_numpy(np.array(first)).float() / 255.0
    edit = torch.from_numpy(np.array(second)).float() / 255.0
    result = measure(source, edit, "zoom + shift", ALIGN_MAX_ZOOM)
    if not result.reliable:
        logging.info("[AusBoss] Image Compare: Align left B as it is: %s", result.reason)
        return {"aligned": False, "message": ALIGN_FAILED}
    off = result.worst_corner
    if off < ALIGN_SETTLED:
        return {"aligned": False, "message": "B already lines up with A."}
    height, width = first.shape[:2]
    lined = crop_if_shift(edit, result.matrix, width, height)
    if lined is None:
        lined, _empty = warp_to_source(edit, result.matrix, width, height, "source", source)
    target = Path(picture_b).with_name(f"{Path(picture_b).stem}_aligned.png")
    try:
        require_output_path(target, Path(temp_root))
    except ValueError as error:
        raise CompareSaveError("Image Compare: the previews are not in ComfyUI's temp folder. Run the workflow again.") from error
    pixels = np.round(lined.numpy() * 255.0).clip(0, 255).astype(np.uint8)
    Image.fromarray(pixels).save(target, compress_level=1)
    return {
        "aligned": True,
        "file": target,
        "width": int(width),
        "height": int(height),
        "pair": remember_pair(picture_a, target, name),
        "message": f"B now lines up with A. It was off by up to {max(1, round(off))} px.",
    }


def _load_rgb(path: Path) -> np.ndarray:
    with Image.open(path) as image:
        return np.asarray(image.convert("RGB"))


def save_mix(*, picture_a, picture_b, output_dir, top="A", strokes=None, layers=False, name=SAVE_NAME) -> dict:
    """Build the mix of two previews and write it to the output folder.

    Writes ``<name>_00001.png``. With ``layers`` it also writes
    ``<name>_00001.psd`` (the picture underneath, then the top picture with
    the rubbed-out area as its layer mask) and ``<name>_00001_mask.png``
    (white where the picture underneath shows). ``name`` is a plain name
    from ``clean_save_name`` or ``tidy_save_name``. Returns what was written.
    """
    if top not in ("A", "B"):
        raise CompareSaveError("Image Compare: the top picture is A or B.")
    name = clean_save_name(name)
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
        counter = next_free_counter((entry.name for entry in folder.iterdir()), name)
        while True:
            stem = f"{name}_{counter:0{COUNTER_WIDTH}}"
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
    "ALIGN_FAILED",
    "ALIGN_GONE",
    "CompareSaveError",
    "ERASE_MAX_POINTS",
    "ERASE_MAX_STROKES",
    "ERASE_MAX_STROKE_POINTS",
    "ERASE_OUTSIDE",
    "ERASE_SIZE",
    "PAIRS_KEPT",
    "SAVE_NAME",
    "SAVE_NAME_MAX",
    "align_pair",
    "brush_core",
    "brush_sigma",
    "clean_save_name",
    "clean_strokes",
    "erase_mask",
    "mix_pictures",
    "pair_pictures",
    "remember_pair",
    "save_mix",
    "tidy_save_name",
]
