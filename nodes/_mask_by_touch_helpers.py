"""Mask by Touch helpers: everything around the search that needs no model.

The search itself is ComfyUI's own SAM 3 Detect, called from the node. Here
is the rest: reading the touches the node's face wrote, the key that ties
them to one picture, the area of a painted stroke, the points a stroke hands
to SAM 3, the words asked of a picture and what is done with their matches,
tidying an answer, the pieces shown for hovering and how they are packed
into pictures, the edge settings and the messages. Torch and the standard
library only, so tests run without ComfyUI.
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
import functools
import hashlib
import json
import math
import re
import threading

import torch
import torch.nn.functional as F

from ._mask_by_name_helpers import MATCHES_MAX
from ._mask_by_name_helpers import NEEDS_SAM3 as _NAME_NEEDS_SAM3
from ._mask_by_name_helpers import NOT_SAM3 as _NAME_NOT_SAM3
from ._mask_helpers import blur_mask, fill_mask_holes, grow_shrink_mask, smooth_mask

# What the touches text may hold. It arrives from the workflow or the API,
# so every size is checked before any work is done with it.
ITEMS_MAX = 200
POINTS_MAX = 20_000
TEXT_MAX = 400_000
VERSION = 1
COORD_MAX = 1_000_000
RADIUS_MAX = 4096.0

# The face's own picture: the long side is at most this.
SMALL_SIDE = 1024

# How a find stroke is asked (find_points, choose_found). Measured on 27
# strokes over three pictures, each drawn 13 slightly different ways: four
# points alone returned the stroked thing in 87 % of 351 tries, two points
# in 79 %, one in 46 %, and six or more returned nothing on some strokes.
# Asking both ways and switching to the two-point answer when it is much
# smaller and still under the stroke gave 91 %.
FIND_MANY = 4
# Four points need room: a stroke shorter than this share of the picture's
# long side is asked with two points only.
FIND_MANY_LENGTH = 0.05
# The two-point answer wins when it covers this much of the stroke ...
FIND_PAIR_COVERS = 0.6
# ... and the four-point answer is at least this many times its size (the
# whole face from a stroke over the hand at the cheek).
FIND_PAIR_TIMES = 2.0

# An island of an answer smaller than this share of the answer is a stray
# speck, unless it lies under the tapped point.
SPECK_SHARE = 0.01
# Islands are told apart on a grid about this many cells along the long side.
ISLAND_GRID = 384

# Fill holes closes a hole only when it has at most this share of the picked
# area's pixels, so a mug's handle and the posters on a picked wall stay open.
HOLE_SHARE = 0.01

# The words a picture is asked about for hovering, in asking order. The first
# tuple is asked before any grid point, the second after the first points.
# Two plain tuples, so the list is easy to change.
WORDS_FIRST = (
    "person", "face", "hair", "hand", "shirt", "t-shirt", "tank top", "jacket", "coat", "sweater", "dress", "skirt",
    "pants", "jeans", "shorts", "shoe", "sneaker", "hat", "eyeglasses", "bag", "backpack", "phone", "cup", "bottle",
    "plate", "food", "chair", "table", "sofa", "bed", "pillow", "lamp", "plant", "flower", "car", "dog", "cat",
    "window", "door", "sign",
)
WORDS_MORE = (
    "arm", "leg", "foot", "eye", "lips", "eyebrow", "beard", "ear", "neck", "sleeve", "shirt collar", "fur collar",
    "bag strap", "scarf", "glove", "sock", "boot", "sandal", "blouse", "hoodie", "vest", "suit", "bra", "swimsuit",
    "belt", "necklace", "earring", "bracelet", "watch", "sunglasses", "handbag", "suitcase", "headphones", "laptop",
    "television", "screen", "book", "drinking glass", "bowl", "fork", "spoon", "knife", "vase", "teddy bear", "toy",
    "chandelier", "neon sign", "vending machine", "mirror", "curtain", "rug", "blanket", "shelf", "cabinet", "desk",
    "tree", "bird", "bicycle", "motorcycle", "truck", "poster", "sky", "wall", "floor",
)
# A word in a `name` touch is cut to this many characters.
WORD_MAX = 60
# What a word may not hold: the text reader's own signs for "several words",
# "how many" and weights.
_WORD_SIGNS = str.maketrans({sign: " " for sign in ",:()[]{}"})

# Pieces for hovering.
PIECES_MAX = 120
PLANE_BITS = 24
# A grid-point piece smaller than this share of the picture is not shown: a
# pointer can hardly hit it, and a click there works without it. A piece
# that has a name is kept however small: a word was pointed at it.
PIECE_MIN_SHARE = 0.002
# A grid-point piece that is nearly the whole picture is not shown either.
PIECE_MAX_SHARE = 0.9
# A named piece that is nearly the whole picture is shown only when SAM 3 is
# this sure of it. The node asks about a hundred words nobody typed, and
# "the whole picture is a mirror" at 0.81 was one of the answers: over every
# spot nothing else covered, the pointer said "mirror". A wall behind a
# small thing, at 0.97, is a wall. A name the user types is never judged so.
# Measured on 22 pictures: of 39 named pieces over 40% of a picture, the 15
# right ones were all 0.958 sure or more, the 24 wrong ones all 0.898 or less.
BIG_NAME_SURE = 0.95
# Two answers that share this much of their joint area are one piece.
PIECE_SAME = 0.8
# Pieces are told apart on a grid about this many cells along the long side.
PIECE_GRID = 256
# A named piece's own point is looked for on a grid of about this many cells.
INNER_GRID = 160

NOTHING_PICKED = (
    "Mask by Touch: nothing is picked yet. Click a thing on the node's "
    "picture, or paint over it, then run again."
)
NOT_TOUCHES = (
    "Mask by Touch could not read what was picked. Press Clear on the node "
    "and pick again."
)
TOO_MUCH = (
    f"Mask by Touch: too much is picked for one node (the limit is {ITEMS_MAX} "
    f"picks and {POINTS_MAX:,} points). Press Clear on the node and pick again "
    "with fewer strokes."
)
NEWER_TOUCHES = (
    "Mask by Touch: these picks were saved by a newer version of the pack. "
    "Update ComfyUI-AusBoss, or press Clear on the node and pick again."
)
NOT_A_PICTURE = "Mask by Touch expected a picture (an IMAGE batch)."
# Mask by Name's own words for a missing or wrong model, with this node's name.
NEEDS_SAM3 = _NAME_NEEDS_SAM3.replace("Mask by Name", "Mask by Touch")
NOT_SAM3 = _NAME_NOT_SAM3.replace("Mask by Name", "Mask by Touch")
NO_TEXT_READER = f"{NOT_SAM3} Nothing is wired into clip."


# ---------------------------------------------------------------------------
# What was picked
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Item:
    """One touch. `kind` is "tap", "name", "all", "find", "paint",
    "subject", "background", or None for a kind this version does not know
    (it is skipped, and still counted in the answer). `quiet` is a `name`
    touch whose word the node's face did not show, because SAM 3 was not
    sure of it: the thing is picked, its word is not given out."""

    kind: str | None = None
    add: bool = True
    x: int = 0
    y: int = 0
    r: float = 0.0
    pts: tuple = ()
    word: str = ""
    quiet: bool = False


@dataclass(frozen=True)
class Touches:
    key: str | None = None
    items: tuple = ()


def touch_stamp(text) -> str:
    """Which touches an answer belongs to: the 32-bit FNV-1a hash of the text
    exactly as it arrived, as eight hex digits. The face works out the same."""
    value = 0x811C9DC5
    for byte in ("" if text is None else str(text)).encode("utf-8"):
        value = ((value ^ byte) * 0x01000193) & 0xFFFFFFFF
    return f"{value:08x}"


def _whole(value) -> int:
    """A coordinate as a whole pixel. Text, a missing value or a number that
    is not finite is an error."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(NOT_TOUCHES)
    if not math.isfinite(value):
        raise ValueError(NOT_TOUCHES)
    return int(max(-COORD_MAX, min(COORD_MAX, round(value))))


def _point(value) -> tuple:
    if not isinstance(value, (list, tuple)) or len(value) < 2:
        raise ValueError(NOT_TOUCHES)
    return (_whole(value[0]), _whole(value[1]))


def clean_word(word) -> str:
    """A word as it is asked of SAM 3: the text reader's own signs out
    (commas, colons, brackets), spaces collapsed, at most WORD_MAX long."""
    text = " ".join(str(word or "").translate(_WORD_SIGNS).split())
    return text[:WORD_MAX].strip()


def word_text(word: str) -> str:
    """The text handed to ComfyUI's SAM 3 text reader for one word.

    A bare word returns one match; ":N" asks for up to N, as Mask by Name
    asks."""
    return f"{word}:{MATCHES_MAX}"


def _item(entry) -> Item:
    if not isinstance(entry, dict):
        raise ValueError(NOT_TOUCHES)
    kind = entry.get("t")
    if kind not in ("tap", "name", "all", "find", "paint", "subject", "background"):
        return Item()
    op = entry.get("op", 1)
    if op not in (0, 1):
        raise ValueError(NOT_TOUCHES)
    add = bool(op)
    if kind in ("subject", "background"):  # the picture's main subject, or everything but it: no point, no word
        return Item(kind, add)
    if kind == "tap":
        return Item("tap", add, _whole(entry.get("x")), _whole(entry.get("y")))
    if kind in ("name", "all"):
        word = entry.get("w")
        if not isinstance(word, str):
            raise ValueError(NOT_TOUCHES)
        if kind == "all":  # every thing of that name: no point
            return Item("all", add, word=clean_word(word))
        quiet = entry.get("q", 0)
        if quiet not in (0, 1, True, False):
            raise ValueError(NOT_TOUCHES)
        return Item("name", add, _whole(entry.get("x")), _whole(entry.get("y")), word=clean_word(word), quiet=bool(quiet))
    radius = entry.get("r", 0)
    if isinstance(radius, bool) or not isinstance(radius, (int, float)) or not math.isfinite(radius) or radius < 0:
        raise ValueError(NOT_TOUCHES)
    points = entry.get("pts")
    if not isinstance(points, (list, tuple)) or not points:
        raise ValueError(NOT_TOUCHES)
    if len(points) > POINTS_MAX:
        raise ValueError(TOO_MUCH)
    return Item(kind, add, r=float(min(radius, RADIUS_MAX)), pts=tuple(_point(point) for point in points))


def parse_touches(text) -> Touches:
    """The touches the face wrote, checked. Empty text is nothing picked.

    Text that is not this JSON, or holds more than the limits, stops the run
    with a plain message (ValueError). A kind of touch this version does not
    know is kept as a skipped item, so the answers still line up one to one.
    """
    text = "" if text is None else str(text)
    if not text.strip():
        return Touches()
    if len(text) > TEXT_MAX:
        raise ValueError(TOO_MUCH)
    try:
        data = json.loads(text)
    except (ValueError, RecursionError) as error:
        raise ValueError(NOT_TOUCHES) from error
    if not isinstance(data, dict):
        raise ValueError(NOT_TOUCHES)
    version = data.get("v", VERSION)
    if isinstance(version, bool) or not isinstance(version, (int, float)):
        raise ValueError(NOT_TOUCHES)
    if version > VERSION:
        raise ValueError(NEWER_TOUCHES)
    key = data.get("key")
    if key is not None and not isinstance(key, str):
        raise ValueError(NOT_TOUCHES)
    entries = data.get("items", [])
    if not isinstance(entries, list):
        raise ValueError(NOT_TOUCHES)
    if len(entries) > ITEMS_MAX:
        raise ValueError(TOO_MUCH)
    items = tuple(_item(entry) for entry in entries)
    if sum(len(item.pts) if item.kind in ("find", "paint") else 1 for item in items) > POINTS_MAX:
        raise ValueError(TOO_MUCH)
    return Touches(key or None, items)


def picture_key(image: torch.Tensor) -> str:
    """The key of one picture: its size and a fingerprint of every pixel.

    The pixels are read as the 8-bit picture they are, so the same picture
    gets the same key on every run and every machine, and a picture that
    differs in one pixel gets another. A batch is known by its first picture.
    """
    if not isinstance(image, torch.Tensor) or image.ndim not in (3, 4) or 0 in image.shape:
        raise ValueError(NOT_A_PICTURE)
    frame = image[0] if image.ndim == 4 else image
    height, width = int(frame.shape[0]), int(frame.shape[1])
    pixels = frame[..., :3].detach().float().mul(255.0).round_().clamp_(0.0, 255.0).to(torch.uint8).cpu().contiguous()
    digest = hashlib.blake2b(pixels.numpy(), digest_size=8).hexdigest()
    return f"{width}x{height}-{digest}"


def read_ask(ask, height: int, width: int) -> tuple:
    """What the node's own face asks of one run: (kind, point).

    "scope" finds pieces for hovering; "scope:x,y" does so starting with
    that pixel of the picture (the pointer's place). Anything else that is
    not empty is "look": show the picture, never stop the run. Empty is an
    ordinary run ("", None). A point outside the picture, or text after
    "scope:" that is not two whole numbers, is plain "scope".
    """
    text = str(ask or "").strip()
    if not text:
        return "", None
    if text == "scope" or text.startswith("scope:"):
        match = re.fullmatch(r"scope:(\d{1,9}),(\d{1,9})", text)
        if match and int(match.group(1)) < int(width) and int(match.group(2)) < int(height):
            return "scope", (int(match.group(1)), int(match.group(2)))
        return "scope", None
    return "look", None


# ---------------------------------------------------------------------------
# Strokes
# ---------------------------------------------------------------------------

# Rows of segments worked out at once while a stroke is drawn: bounds the
# memory a stroke of thousands of long segments can ask for.
_ROWS_AT_ONCE = 1_000_000


def _path(pts) -> list:
    """The stroke's points without the ones that repeat the point before."""
    path = []
    for point in pts:
        point = (float(point[0]), float(point[1]))
        if not path or point != path[-1]:
            path.append(point)
    return path


def stroke_area(pts, radius: float, height: int, width: int) -> torch.Tensor:
    """Exactly the area a round brush covers along a stroke (H x W, bool).

    A pixel is in when it lies within `radius` of the stroke's line, the two
    ends rounded: what a canvas draws with round caps and joins. Each piece
    of the line is worked out row by row as one span, so a long stroke costs
    its own length and not the whole picture per segment.
    """
    height, width = int(height), int(width)
    radius = max(0.5, float(radius))
    path = _path(pts)
    spans = torch.zeros(height, width + 1, dtype=torch.int32)
    if not path or height < 1 or width < 1:
        return spans[:, :width] > 0
    start = torch.tensor(path[:-1] or path, dtype=torch.float64)
    end = torch.tensor(path[1:] or path, dtype=torch.float64)
    top = torch.ceil(torch.minimum(start[:, 1], end[:, 1]) - radius).clamp_(min=0)
    bottom = torch.floor(torch.maximum(start[:, 1], end[:, 1]) + radius).clamp_(max=height - 1)
    counts = (bottom - top + 1).clamp_(min=0).long()
    flat = spans.view(-1)
    sizes = counts.tolist()
    first = 0
    while first < len(sizes):
        last, rows = first + 1, sizes[first]
        while last < len(sizes) and rows + sizes[last] <= _ROWS_AT_ONCE:
            rows += sizes[last]
            last += 1
        _draw_segments(flat, start[first:last], end[first:last], top[first:last], counts[first:last], radius, width)
        first = last
    return spans.cumsum(dim=1)[:, :width] > 0


def _draw_segments(flat, start, end, top, counts, radius, width) -> None:
    """Add the row spans of some segments to the running +1 / -1 marks."""
    total = int(counts.sum())
    if total == 0:
        return
    segment = torch.repeat_interleave(torch.arange(len(counts)), counts)
    offsets = torch.cumsum(counts, 0) - counts
    row = top[segment] + (torch.arange(total) - offsets[segment]).to(torch.float64)
    ax, ay = start[segment, 0], start[segment, 1]
    dx, dy = end[segment, 0] - ax, end[segment, 1] - ay
    length = torch.sqrt(dx * dx + dy * dy)
    level = dy == 0
    safe_dy = torch.where(level, torch.ones_like(dy), dy)
    safe_length = torch.where(length == 0, torch.ones_like(length), length)
    # The part of the segment whose brush circle reaches this row.
    t_one, t_two = (row - radius - ay) / safe_dy, (row + radius - ay) / safe_dy
    t_low = torch.minimum(t_one, t_two).clamp(0.0, 1.0)
    t_high = torch.maximum(t_one, t_two).clamp(0.0, 1.0)
    # Where the brush's edge is tangent to the row: the farthest left and right.
    lean = radius * dx * torch.sign(dy) / safe_length

    def reach(t):
        t = torch.minimum(torch.maximum(t, t_low), t_high)
        away = row - ay - t * dy
        return ax + t * dx, torch.sqrt((radius * radius - away * away).clamp(min=0.0))

    centre, half = reach((row - ay + lean) / safe_dy)
    right = centre + half
    centre, half = reach((row - ay - lean) / safe_dy)
    left = centre - half
    # A level segment: the same half width at both ends.
    away = row - ay
    flat_half = torch.sqrt((radius * radius - away * away).clamp(min=0.0))
    left = torch.where(level, torch.minimum(ax, ax + dx) - flat_half, left)
    right = torch.where(level, torch.maximum(ax, ax + dx) + flat_half, right)
    # Every row here lies within the brush's reach; this only guards rounding.
    reached = (row - ay - torch.where(level, torch.zeros_like(dy), t_low * dy)).abs() <= radius + 1e-9
    first = torch.ceil(left - 1e-9).clamp_(min=0)
    last = torch.floor(right + 1e-9).clamp_(max=width - 1)
    keep = reached & (first <= last)
    if not bool(keep.any()):
        return
    base = row[keep].long() * (width + 1)
    ones = torch.ones(int(keep.sum()), dtype=torch.int32)
    flat.index_add_(0, base + first[keep].long(), ones)
    flat.index_add_(0, base + last[keep].long() + 1, -ones)


def stroke_length(pts) -> float:
    path = _path(pts)
    return sum(math.dist(a, b) for a, b in zip(path, path[1:]))


def along_stroke(pts, count: int, ends: bool = True) -> list:
    """`count` whole-pixel points spread evenly along a stroke by length.

    With `ends` the first and last are the stroke's own ends; without, the
    points sit in the middle of `count` equal parts. One point is the middle.
    """
    path = _path(pts)
    if not path:
        return []
    lengths = [math.dist(a, b) for a, b in zip(path, path[1:])]
    total = sum(lengths)
    if total <= 0 or count <= 1:
        places = [0.5]
    elif ends:
        places = [index / (count - 1) for index in range(count)]
    else:
        places = [(index + 0.5) / count for index in range(count)]
    points = []
    for place in places:
        left = place * total
        spot = path[-1]
        for a, b, length in zip(path, path[1:], lengths):
            if left <= length:
                t = left / length if length else 0.0
                spot = (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
                break
            left -= length
        point = (int(round(spot[0])), int(round(spot[1])))
        if point not in points:
            points.append(point)
    return points


def _inside(points, height: int, width: int) -> list:
    return [(x, y) for x, y in points if 0 <= x < int(width) and 0 <= y < int(height)]


def find_points(pts, height: int, width: int) -> tuple:
    """The two questions a find stroke asks SAM 3: (four points, two points).

    Each is a list of points spread evenly along the stroke's own path, read
    by SAM 3 as one thing; the ends of the stroke, where a hand overshoots,
    are left out. Four points are only asked of a stroke at least 5 % of the
    picture's long side long (an empty list otherwise). A stroke with no
    length is its one point. Only the part of a stroke that lies on the
    picture is used.
    """
    path = _path(pts)
    if len(_inside(path, height, width)) < len(path):
        path = _inside(along_stroke(pts, 129, ends=True), height, width)
    long_enough = stroke_length(path) >= FIND_MANY_LENGTH * max(int(height), int(width))
    many = _inside(along_stroke(path, FIND_MANY, ends=False), height, width) if long_enough else []
    pair = _inside(along_stroke(path, 2, ends=False), height, width)
    return (many if len(many) > len(pair) else []), pair


def choose_found(many, pair, stroke: torch.Tensor):
    """Which of a find stroke's two answers is the thing under it.

    Each answer first loses what the stroke does not touch. The four-point
    answer is taken, unless it is empty, or the two-point answer covers most
    of the stroke and is less than half its size. None when both are empty:
    the stroke's own paint is used then.
    """
    many = None if many is None else keep_touched(many, stroke)
    pair = None if pair is None else keep_touched(pair, stroke)
    many_pixels = 0 if many is None else int(many.sum())
    pair_pixels = 0 if pair is None else int(pair.sum())
    if not many_pixels:
        return pair if pair_pixels else None
    if pair_pixels and many_pixels >= FIND_PAIR_TIMES * pair_pixels:
        if int((pair & stroke).sum()) >= FIND_PAIR_COVERS * int(stroke.sum()):
            return pair
    return many


# ---------------------------------------------------------------------------
# Tidying an answer
# ---------------------------------------------------------------------------


def _grid_factor(height: int, width: int) -> int:
    return max(1, math.ceil(max(height, width) / ISLAND_GRID))


def _cell_counts(mask: torch.Tensor, factor: int) -> torch.Tensor:
    """How many of the mask's pixels lie in each cell of a coarser grid."""
    plane = mask.float()[None, None]
    height, width = mask.shape
    plane = F.pad(plane, (0, (-width) % factor, 0, (-height) % factor))
    return F.avg_pool2d(plane, factor)[0, 0] * float(factor * factor)


def _islands(inside: torch.Tensor) -> torch.Tensor:
    """A number for each cell: cells of one island (touching at a side or a
    corner) share one, 0 is outside.

    Every cell starts with its own number. Each round a cell takes the
    largest number among its eight neighbours, then every unbroken run of
    cells along a row, and along a column, takes its largest. A number
    crosses a whole run at once, so a shape needs a round per bend, not a
    round per cell.
    """
    height, width = inside.shape
    flat = inside.reshape(-1)
    zero = torch.zeros((), dtype=torch.float32, device=inside.device)
    numbers = torch.arange(1, height * width + 1, dtype=torch.float32, device=inside.device)
    labels = torch.where(flat, numbers, zero)

    def runs(grid):
        starts = grid.clone()
        starts[:, 1:] &= ~grid[:, :-1]
        cells = grid.reshape(-1)
        return torch.cumsum(starts.reshape(-1), 0) * cells

    row_run = runs(inside)
    turned = inside.t().contiguous()
    column_run = runs(turned)
    row_best = torch.zeros(int(row_run.max()) + 1, dtype=torch.float32, device=inside.device)
    column_best = torch.zeros(int(column_run.max()) + 1, dtype=torch.float32, device=inside.device)
    while True:
        before = labels
        near = F.max_pool2d(labels.view(1, 1, height, width), 3, stride=1, padding=1).reshape(-1)
        labels = torch.where(flat, near, zero)
        labels = row_best.zero_().scatter_reduce_(0, row_run, labels, "amax")[row_run]
        across = labels.view(height, width).t().reshape(-1)
        across = column_best.zero_().scatter_reduce_(0, column_run, across, "amax")[column_run]
        labels = across.view(width, height).t().reshape(-1)
        if torch.equal(labels, before):
            return labels.view(height, width).long()


def _from_cells(keep: torch.Tensor, factor: int, height: int, width: int) -> torch.Tensor:
    """A choice of coarse cells as a full-size mask."""
    if factor == 1:
        return keep
    return keep.repeat_interleave(factor, dim=0).repeat_interleave(factor, dim=1)[:height, :width]


def drop_specks(answer: torch.Tensor, point=None) -> torch.Tensor:
    """An answer without its stray specks (H x W, bool).

    SAM 3 often returns a thing plus a few far-off dots. An island with less
    than 1 % of the answer's pixels goes, unless it is the biggest one or
    lies under the tapped point. Islands closer together than a grid cell
    count as one.
    """
    answer = answer.bool()
    total = int(answer.sum())
    if total == 0:
        return answer
    height, width = answer.shape
    factor = _grid_factor(height, width)
    counts = _cell_counts(answer, factor)
    labels = _islands(counts > 0)
    sizes = torch.zeros(labels.numel() + 1, dtype=torch.float32).index_add_(0, labels.reshape(-1), counts.reshape(-1))
    keep = sizes >= SPECK_SHARE * total
    keep[int(sizes[1:].argmax()) + 1] = True
    if point is not None and 0 <= point[0] < width and 0 <= point[1] < height:
        keep[int(labels[int(point[1]) // factor, int(point[0]) // factor])] = True
    keep[0] = False
    if bool(keep[labels[counts > 0]].all()):
        return answer
    return answer & _from_cells(keep[labels], factor, height, width)


def keep_touched(answer: torch.Tensor, touch: torch.Tensor) -> torch.Tensor:
    """The islands of an answer that a stroke's area touches (H x W, bool).

    What SAM 3 found far from the stroke does not join it."""
    answer = answer.bool()
    met = answer & touch.bool()
    if not bool(met.any()):
        return torch.zeros_like(answer)
    height, width = answer.shape
    factor = _grid_factor(height, width)
    counts = _cell_counts(answer, factor)
    labels = _islands(counts > 0)
    keep = torch.zeros(labels.numel() + 1, dtype=torch.bool)
    keep[labels[_cell_counts(met, factor) > 0]] = True
    keep[0] = False
    return answer & _from_cells(keep[labels], factor, height, width)


def apply_item(selection: torch.Tensor, area: torch.Tensor, add: bool) -> torch.Tensor:
    """Join an item's area to the selection, or take it away."""
    return (selection | area) if add else (selection & ~area)


# ---------------------------------------------------------------------------
# The matches of a word
# ---------------------------------------------------------------------------


def _piece_factor(height: int, width: int) -> int:
    return max(1, math.ceil(max(int(height), int(width)) / PIECE_GRID))


def _outline(answer: torch.Tensor) -> tuple:
    """An answer on the coarse grid pieces are compared on: (cells, how many
    cells, pixels). Pinholes are closed (grow by one cell, shrink by one), so
    a clean outline and a speckled one of the same thing compare as the same.
    """
    factor = _piece_factor(*answer.shape)
    counts = _cell_counts(answer, factor)
    grown = F.max_pool2d((counts > 0).float()[None, None], 3, stride=1, padding=1)
    cells = (-F.max_pool2d(-grown, 3, stride=1, padding=1))[0, 0] > 0.5
    return cells.reshape(-1), int(cells.sum()), float(counts.sum())


def _alike(cells: torch.Tensor, size: int, other: torch.Tensor, other_size: int) -> bool:
    """Do two outlines share PIECE_SAME or more of their joint area?"""
    # Two answers can only be nearly the same when their sizes are.
    if min(size, other_size) < PIECE_SAME * max(size, other_size):
        return False
    both = int((cells & other).sum())
    return both >= PIECE_SAME * (size + other_size - both)


def tidy_matches(masks: torch.Tensor, scores) -> list:
    """What SAM 3 found for one word, tidied: [(H x W bool, sureness), ...],
    the surest first.

    Each match loses its stray specks. A match that is nearly the same area
    as a surer match of the same word is one thing found twice, and goes.
    Every use of a word's matches starts from this list, so what lights up
    for a word and what a click on it takes are the same areas.
    """
    order = sorted(range(len(scores)), key=lambda index: -float(scores[index]))
    kept, outlines = [], []
    for index in order:
        mask = drop_specks(masks[index])
        if not bool(mask.any()):
            continue
        cells, size, _ = _outline(mask)
        if any(_alike(cells, size, other, other_size) for other, other_size in outlines):
            continue
        kept.append((mask, float(scores[index])))
        outlines.append((cells, size))
    return kept


def match_under(matches: list, point):
    """Which match a `name` touch takes: of the matches that hold the point,
    the smallest (the earlier one when two are the same size). None when no
    match holds it."""
    x, y = int(point[0]), int(point[1])
    best = None
    for index, (mask, _) in enumerate(matches):
        if 0 <= y < mask.shape[0] and 0 <= x < mask.shape[1] and bool(mask[y, x]):
            pixels = int(mask.sum())
            if best is None or pixels < best[0]:
                best = (pixels, index)
    return None if best is None else best[1]


def inner_point(region: torch.Tensor):
    """The pixel of a region that lies deepest inside it, as (x, y); None for
    an empty region.

    The region's edge is peeled off one ring at a time on a coarse grid
    until nothing is left; of the last ring, the cell nearest its middle is
    taken. Only cells that lie wholly inside the region count, so the point
    is inside it.
    """
    x0, y0, x1, y1 = box_of(region)
    if x1 <= x0:
        return None
    crop = region[y0:y1, x0:x1]
    factor = max(1, math.ceil(max(crop.shape) / INNER_GRID))
    while True:
        inside = _cell_counts(crop, factor) >= factor * factor - 0.5
        if factor == 1 or bool(inside.any()):
            break
        factor = max(1, factor // 2)  # a thin region: look closer
    while True:
        outside = F.pad((~inside).float()[None, None], (1, 1, 1, 1), value=1.0)
        peeled = F.max_pool2d(outside, 3, stride=1)[0, 0] < 0.5
        if not bool(peeled.any()):
            break
        inside = peeled
    rows, columns = torch.nonzero(inside, as_tuple=True)
    apart = (rows - rows.float().mean()) ** 2 + (columns - columns.float().mean()) ** 2
    pick = int(apart.argmin())
    return (x0 + int(columns[pick]) * factor + factor // 2, y0 + int(rows[pick]) * factor + factor // 2)


def match_points(matches: list) -> list:
    """For each match of a word, the point that stands for it; None for a
    match no point can stand for.

    The point lies inside the match, as far from its edge as it can, and in
    no smaller match of the same word. So "the smallest match that holds
    the point" (match_under) is this match and no other.
    """
    sizes = [int(mask.sum()) for mask, _ in matches]
    boxes = [box_of(mask) for mask, _ in matches]
    points = []
    for index, (mask, _) in enumerate(matches):
        region = mask
        x0, y0, x1, y1 = boxes[index]
        for other, (other_mask, _) in enumerate(matches):
            if other == index or not (sizes[other] < sizes[index] or (sizes[other] == sizes[index] and other < index)):
                continue
            ox0, oy0, ox1, oy1 = boxes[other]
            if ox0 < x1 and x0 < ox1 and oy0 < y1 and y0 < oy1:
                region = region & ~other_mask
        points.append(inner_point(region))
    return points


# ---------------------------------------------------------------------------
# The small copies the face draws
# ---------------------------------------------------------------------------


def small_size(width: int, height: int) -> tuple:
    """(small width, small height, scale): the long side at most SMALL_SIDE.

    The sizes are scale times the full size rounded half up, which is how a
    browser's Math.round reads the same numbers."""
    scale = min(1.0, SMALL_SIDE / max(int(width), int(height)))
    return (
        max(1, int(math.floor(int(width) * scale + 0.5))),
        max(1, int(math.floor(int(height) * scale + 0.5))),
        scale,
    )


def to_small(mask: torch.Tensor, small_width: int, small_height: int) -> torch.Tensor:
    """A full-size mask at the face's small size (bool): a small pixel is in
    when at least half of what it covers is in."""
    mask = mask.bool()
    if tuple(mask.shape) == (small_height, small_width):
        return mask
    return F.interpolate(mask[None, None].float(), size=(small_height, small_width), mode="area")[0, 0] >= 0.5


def small_picture(image: torch.Tensor, small_width: int, small_height: int) -> torch.Tensor:
    """The first picture at the small size, as 8-bit RGB (h x w x 3)."""
    frame = image[0] if image.ndim == 4 else image
    rgb = frame[..., :3].detach().float().clamp(0.0, 1.0)
    if rgb.shape[-1] == 1:
        rgb = rgb.expand(-1, -1, 3)
    if tuple(rgb.shape[:2]) != (small_height, small_width):
        rgb = F.interpolate(rgb.movedim(-1, 0)[None], size=(small_height, small_width), mode="area")[0].movedim(0, -1)
    return rgb.mul(255.0).round().to(torch.uint8).cpu()


def box_of(mask: torch.Tensor) -> list:
    """[x0, y0, x1, y1] around a mask, the far sides one past the last pixel."""
    rows = torch.nonzero(mask.any(dim=1)).flatten()
    columns = torch.nonzero(mask.any(dim=0)).flatten()
    if rows.numel() == 0:
        return [0, 0, 0, 0]
    return [int(columns[0]), int(rows[0]), int(columns[-1]) + 1, int(rows[-1]) + 1]


# ---------------------------------------------------------------------------
# Pieces for hovering
# ---------------------------------------------------------------------------


@functools.lru_cache(maxsize=16)
def scope_points(width: int, height: int, count: int) -> tuple:
    """About `count` points over the picture, in the order to ask them.

    Rows of evenly spaced points, every other row shifted half a step. The
    order starts in the middle and always takes the point farthest from the
    ones before it, so the picture is covered evenly however early the
    asking stops.
    """
    width, height, count = int(width), int(height), max(1, int(count))
    columns = max(1, round(math.sqrt(count * width / height)))
    rows = max(1, round(count / columns))
    points = []
    for row in range(rows):
        shift = 0.25 if row % 2 == 0 else 0.75
        for column in range(columns):
            x = min(width - 1, int((column + shift) * width / columns))
            y = min(height - 1, int((row + 0.5) * height / rows))
            if (x, y) not in points:
                points.append((x, y))
    spots = torch.tensor(points, dtype=torch.float64)
    middle = torch.tensor([width / 2.0, height / 2.0], dtype=torch.float64)
    index = int(((spots - middle) ** 2).sum(dim=1).argmin())
    nearest = ((spots - spots[index]) ** 2).sum(dim=1)
    order = [index]
    for _ in range(len(points) - 1):
        index = int(nearest.argmax())
        order.append(index)
        nearest = torch.minimum(nearest, ((spots - spots[index]) ** 2).sum(dim=1))
    return tuple(points[index] for index in order)


class PieceSieve:
    """Keeps the distinct pieces of a picture while it is looked at.

    A piece is one match of a word (`name` and `sure` given) or the answer
    at a point. Each is offered once (`offer`) and compared with the pieces
    kept so far, pinholes closed:
    - two named pieces that are nearly the same area are one piece, and the
      word SAM 3 was surer of stays;
    - a point piece that is nearly the same as a named piece goes;
    - of two point pieces that are nearly the same the cleaner one stays.
    A piece inside another is a piece of its own: glasses, a face and a
    person are three. A point piece is passed over when it is a speck or
    nearly the whole picture. A named piece may be a speck, and may be
    nearly the whole picture when SAM 3 is sure of it (BIG_NAME_SURE).

    Looking goes in rounds. `settle` marks what has been shown: a shown
    point piece is not swapped for another point's answer.
    """

    def __init__(self, height: int, width: int):
        self.height, self.width = int(height), int(width)
        self.factor = _piece_factor(self.height, self.width)
        self.kept = []

    def offer(self, point, answer: torch.Tensor, pointed: bool = False, name=None, sure=None) -> bool:
        """True when the answer is kept as a piece of its own.

        `pointed` is for the answer under the pointer: it is kept however
        small it is, because the person is pointing at it."""
        cells, size, pixels = _outline(answer)
        share = pixels / (self.height * self.width)
        if pixels < 1.0:
            return False
        if name is None and (share > PIECE_MAX_SHARE or (share < PIECE_MIN_SHARE and not pointed)):
            return False
        if name is not None and share > PIECE_MAX_SHARE and float(sure) < BIG_NAME_SURE:
            return False
        piece = {
            "name": name, "sure": None if name is None else float(sure),
            "point": (int(point[0]), int(point[1])), "cells": cells, "size": size, "pixels": pixels,
            # How much of its own closed outline the answer leaves empty.
            "empty": 1.0 - pixels / max(1.0, float(size * self.factor * self.factor)),
            "shown": False, "pointed": bool(pointed) and name is None,
        }
        alike = [slot for slot, other in enumerate(self.kept) if _alike(cells, size, other["cells"], other["size"])]
        if name is None:
            if not alike:
                self.kept.append(piece)
                return True
            other = self.kept[alike[0]]
            if all(self.kept[slot]["name"] is None for slot in alike) and not other["shown"] and piece["empty"] < other["empty"]:
                self.kept[alike[0]] = piece
                return True
            return False
        if any(self.kept[slot]["name"] is not None and self.kept[slot]["sure"] >= piece["sure"] for slot in alike):
            return False
        # The words SAM 3 was less sure of, and the point pieces of the same area, go.
        self.kept = [other for slot, other in enumerate(self.kept) if slot not in alike]
        self.kept.append(piece)
        return True

    def settle(self) -> list:
        """The pieces to show, as (name or None, point), and from now on shown.

        Over PIECES_MAX the point pieces go first, the smallest first (what
        the person points at last); then the names SAM 3 was least sure of.
        What is dropped is forgotten.
        """
        over = len(self.kept) - PIECES_MAX
        if over > 0:
            points = sorted((piece for piece in self.kept if piece["name"] is None), key=lambda piece: (piece["pointed"], piece["pixels"]))
            names = sorted((piece for piece in self.kept if piece["name"] is not None), key=lambda piece: (piece["sure"], piece["pixels"]))
            gone = {id(piece) for piece in (points + names)[:over]}
            self.kept = [piece for piece in self.kept if id(piece) not in gone]
        for piece in self.kept:
            piece["shown"], piece["pointed"] = True, False
        return [(piece["name"], piece["point"]) for piece in self.kept]

    def sure_of(self, name, point):
        """How sure SAM 3 was of a kept named piece (None for a point piece)."""
        for piece in self.kept:
            if piece["name"] == name and piece["point"] == tuple(point):
                return piece["sure"]
        return None


def pack_planes(masks) -> list:
    """Pieces packed into pictures a browser canvas reads exactly.

    `masks` is N x h x w (bool), or a list of h x w masks. Piece i is bit
    i % 24 of plane i // 24; a plane is h x w x 3 (uint8) with bits 0-7 in
    red, 8-15 in green and 16-23 in blue. Saved as a PNG without a
    see-through channel, a canvas reads back the same numbers.
    """
    planes = []
    for first in range(0, len(masks), PLANE_BITS):
        plane = torch.zeros(*masks[first].shape, 3, dtype=torch.uint8)
        for bit, mask in enumerate(masks[first:first + PLANE_BITS]):
            plane[..., bit // 8] |= mask.to(torch.uint8) << (bit % 8)
        planes.append(plane)
    return planes


def plane_piece(planes: list, index: int) -> torch.Tensor:
    """One piece back out of its plane (h x w, bool)."""
    bit = index % PLANE_BITS
    return (planes[index // PLANE_BITS][..., bit // 8] & (1 << (bit % 8))) != 0


def unpack_planes(planes: list, count: int) -> torch.Tensor:
    """The pieces back out of their planes (count x h x w, bool)."""
    if not count:
        return torch.zeros(0, 0, 0, dtype=torch.bool)
    return torch.stack([plane_piece(planes, index) for index in range(count)])


# ---------------------------------------------------------------------------
# The edge settings
# ---------------------------------------------------------------------------


def fill_small_holes(mask: torch.Tensor) -> torch.Tensor:
    """Close the pinholes inside each picture's picked area (B x H x W).

    A hole is closed when it has at most 1 % as many pixels as that picture's
    picked area, counted before filling. A bigger opening stays open."""
    frames = []
    height, width = int(mask.shape[-2]), int(mask.shape[-1])
    for frame in mask:
        limit = HOLE_SHARE * float((frame >= 0.5).sum())
        if limit >= 1.0:
            frame = fill_mask_holes(frame[None], 100.0 * limit / (height * width))[0]
        frames.append(frame)
    return torch.stack(frames)


def shape_mask(selection: torch.Tensor, smooth: int = 0, fill_holes: bool = True) -> torch.Tensor:
    """The picked area tidied, still on or off (B x H x W, 0 or 1): small
    holes filled, a ragged outline rounded off."""
    mask = selection.to(torch.float32)
    if fill_holes:
        mask = fill_small_holes(mask)
    return smooth_mask(mask, int(smooth))


def edge_mask(mask: torch.Tensor, grow: int = 0, soften: float = 0.0) -> torch.Tensor:
    """Grow or shrink, then soften. A mask that is already soft (a fine
    edge) keeps its soft values."""
    return blur_mask(grow_shrink_mask(mask, int(grow)), float(soften)).clamp(0.0, 1.0)


def finish_mask(selection: torch.Tensor, grow: int = 0, soften: float = 0.0, smooth: int = 0, fill_holes: bool = True) -> torch.Tensor:
    """The picked area with the edge settings applied (B x H x W, 0..1).

    In this order: fill holes, smooth, grow or shrink, soften."""
    return edge_mask(shape_mask(selection, smooth, fill_holes), grow, soften)


# ---------------------------------------------------------------------------
# What is remembered
# ---------------------------------------------------------------------------


def _packed(mask: torch.Tensor) -> tuple:
    """A mask cut to its own box, to keep: (shape, corner, cut)."""
    x0, y0, x1, y1 = box_of(mask)
    return (tuple(mask.shape), (x0, y0), mask[y0:y1, x0:x1].clone())


def _unpacked(packed: tuple) -> torch.Tensor:
    shape, corner, cut = packed
    mask = torch.zeros(shape, dtype=torch.bool)
    mask[corner[1]:corner[1] + cut.shape[0], corner[0]:corner[0] + cut.shape[1]] = cut
    return mask


class Memory:
    """What SAM 3 answered, kept so the same question is asked once.

    An answer is one area (a point's, a stroke's) or the matches of a word.
    Areas are kept cut to their own box, oldest out first once they hold
    more than `budget` bytes. Pieces are kept for the last few pictures.
    """

    def __init__(self, budget: int = 256 * 1024 * 1024, pictures: int = 4):
        self.budget, self.pictures = int(budget), int(pictures)
        self._answers = OrderedDict()
        self._pieces = OrderedDict()
        self._held = 0
        self._lock = threading.Lock()

    def clear(self) -> None:
        with self._lock:
            self._answers.clear()
            self._pieces.clear()
            self._held = 0

    def _keep(self, key, payload, size: int) -> None:
        with self._lock:
            old = self._answers.pop(key, None)
            if old is not None:
                self._held -= old[1]
            self._answers[key] = (payload, size)
            self._held += size
            while self._held > self.budget and len(self._answers) > 1:
                _, dropped = self._answers.popitem(last=False)
                self._held -= dropped[1]

    def _kept(self, key):
        with self._lock:
            entry = self._answers.get(key)
            if entry is not None:
                self._answers.move_to_end(key)
            return entry

    def has(self, key) -> bool:
        """Was this question asked, and is its answer still kept?"""
        with self._lock:
            return key in self._answers

    def put(self, key, answer) -> None:
        """Remember an answer (H x W bool, or None for nothing found)."""
        if answer is None or not bool(answer.any()):
            self._keep(key, None, 64)
        else:
            packed = _packed(answer)
            self._keep(key, packed, 64 + packed[2].numel())

    def get(self, key) -> tuple:
        """(asked, answer). `asked` is False for a question that was never
        asked or has been dropped; an answer of None means nothing was found."""
        entry = self._kept(key)
        if entry is None:
            return False, None
        return True, None if entry[0] is None else _unpacked(entry[0])

    def put_matches(self, key, matches: list) -> None:
        """Remember the matches of a word: [(H x W bool, sureness), ...]."""
        packed = [(_packed(mask), float(sure)) for mask, sure in matches]
        self._keep(key, packed, 64 + sum(64 + item[0][2].numel() for item in packed))

    def get_matches(self, key) -> tuple:
        """(asked, matches). `asked` is False for a word that was never asked
        of this picture or has been dropped."""
        entry = self._kept(key)
        if entry is None:
            return False, []
        return True, [(_unpacked(packed), sure) for packed, sure in entry[0]]

    def put_pieces(self, key, pieces) -> None:
        with self._lock:
            self._pieces.pop(key, None)
            self._pieces[key] = pieces
            while len(self._pieces) > self.pictures:
                self._pieces.popitem(last=False)

    def get_pieces(self, key):
        with self._lock:
            pieces = self._pieces.get(key)
            if pieces is not None:
                self._pieces.move_to_end(key)
            return pieces


__all__ = [
    "HOLE_SHARE",
    "ITEMS_MAX",
    "Item",
    "MATCHES_MAX",
    "Memory",
    "NEEDS_SAM3",
    "NEWER_TOUCHES",
    "NOTHING_PICKED",
    "NOT_A_PICTURE",
    "NOT_SAM3",
    "NOT_TOUCHES",
    "NO_TEXT_READER",
    "PIECES_MAX",
    "PLANE_BITS",
    "POINTS_MAX",
    "PieceSieve",
    "SMALL_SIDE",
    "TEXT_MAX",
    "TOO_MUCH",
    "Touches",
    "WORDS_FIRST",
    "WORDS_MORE",
    "WORD_MAX",
    "along_stroke",
    "apply_item",
    "box_of",
    "choose_found",
    "clean_word",
    "drop_specks",
    "fill_small_holes",
    "find_points",
    "finish_mask",
    "inner_point",
    "keep_touched",
    "match_points",
    "match_under",
    "pack_planes",
    "parse_touches",
    "picture_key",
    "plane_piece",
    "read_ask",
    "scope_points",
    "small_picture",
    "small_size",
    "stroke_area",
    "stroke_length",
    "tidy_matches",
    "to_small",
    "touch_stamp",
    "unpack_planes",
    "word_text",
]
