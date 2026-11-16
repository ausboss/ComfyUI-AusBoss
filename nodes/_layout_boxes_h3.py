"""Layout Boxes' `h3_prompt` output: the boxes as a MiniMax H3 Image prompt.

H3 Image places things from words, and it reads its pictures as
<Picture 1>, <Picture 2>, ... in the order they are wired. So every box
becomes one sentence that says where it is in plain words: left or right,
high or low, how much of the frame it takes, and who stands beside it. An
object box with no description stands for the person in the next reference
picture, with their face, hair and clothes.

The prompt never holds coordinates. Written as numbers they come back drawn
on the picture as text (tried on H3 Image: 6 renders of 6), so places and
sizes are said in words only, and nothing in the prompt talks about boxes,
lines or frames either.

With a picture on `background`, that picture is the scene: <Picture 1>, the
one H3 Image changes, and the subjects start at <Picture 2>. Without one the
subjects start at <Picture 1>.
"""

from __future__ import annotations

from typing import Any

from ._layout_boxes_helpers import _turned_extent, angle_of, element_desc

# Fractions of the frame, said as words.
SHARES = (
    (0.15, "a tenth"),
    (0.29, "a quarter"),
    (0.42, "a third"),
    (0.58, "half"),
    (0.71, "two thirds"),
    (0.88, "three quarters"),
)
# A name for the box beside it, from its description: at most this many words.
NAME_WORDS = 8


def _extent(region: dict, shape: tuple[float, float]) -> tuple[float, float, float, float]:
    """(left, top, right, bottom) as fractions of the frame, cut to it."""
    if angle_of(region):
        left, top, right, bottom = _turned_extent(region, shape)
    else:
        x, y = float(region.get("x", 0.0)), float(region.get("y", 0.0))
        w, h = float(region.get("w", 0.0)), float(region.get("h", 0.0))
        left, right = sorted((x, x + w))
        top, bottom = sorted((y, y + h))
    return tuple(min(1.0, max(0.0, value)) for value in (left, top, right, bottom))


def share_words(part: float) -> str:
    """0.5 -> "half", 0.34 -> "a third", 0.95 -> "all"."""
    for upto, words in SHARES:
        if part < upto:
            return words
    return "all"


def across_words(middle: float) -> str:
    if middle < 0.2:
        return "at the far left of the frame"
    if middle < 0.4:
        return "on the left of the frame"
    if middle <= 0.6:
        return "in the middle of the frame"
    if middle <= 0.8:
        return "on the right of the frame"
    return "at the far right of the frame"


def high_or_low(top: float, bottom: float) -> str:
    """ "high " or "low " in front of the place across, when it says something."""
    middle = (top + bottom) / 2
    if bottom - top >= 0.6:
        return ""
    if middle < 0.34:
        return "high "
    if middle > 0.66:
        return "low "
    return ""


def size_words(left: float, top: float, right: float, bottom: float) -> str:
    tall, wide = share_words(bottom - top), share_words(right - left)
    of_height = "the frame's full height" if tall == "all" else f"{tall} of the frame's height"
    of_width = "all of its width" if wide == "all" else f"{wide} of its width"
    return f"taking up about {of_height} and {of_width}"


def _short_name(desc: str) -> str:
    """A box's description cut to a name to place another box by."""
    first = desc.strip().split(",")[0].split(".")[0].strip()
    words = first.split()
    if not words:
        return ""
    name = " ".join(words[:NAME_WORDS])
    return name[:1].lower() + name[1:] if not name[:2].isupper() else name


def _beside_words(gap: float, name: str, in_front: bool) -> str:
    """Where a box is against its neighbour on the left."""
    if gap < 0:
        return f"partly {'in front of' if in_front else 'behind'} {name}"
    if gap < 0.05:
        return f"right beside {name}, on its right"
    if gap < 0.15:
        return f"a little to the right of {name}"
    return f"well to the right of {name}"


def _overlap_down(one: dict, other: dict) -> bool:
    return one["extent"][1] < other["extent"][3] and other["extent"][1] < one["extent"][3]


def _subjects(regions: list[dict], shape: tuple[float, float], first_picture: int) -> list[dict]:
    """One entry per box worth a sentence, in the boxes' order."""
    items = []
    picture = first_picture
    for order, region in enumerate(regions):
        if not isinstance(region, dict):
            continue
        desc = element_desc(region).strip()
        kind = "text" if region.get("type") == "text" else "obj"
        item = {"order": order, "kind": kind, "desc": desc, "extent": _extent(region, shape), "picture": 0}
        if kind == "text":
            item["text"] = str(region.get("text", "") or "").strip()
            if not item["text"] and not desc:
                continue
            item["name"] = f'the words "{item["text"]}"' if item["text"] else _short_name(desc)
        elif desc:
            item["name"] = _short_name(desc)
        else:
            item["picture"] = picture
            item["name"] = f"the person from <Picture {picture}>"
            picture += 1
        items.append(item)
    return items


def _place(item: dict, beside: str) -> str:
    left, top, right, bottom = item["extent"]
    parts = [high_or_low(top, bottom) + across_words((left + right) / 2)]
    if beside:
        parts.append(beside)
    parts.append(size_words(left, top, right, bottom))
    return ", ".join(parts)


def _sentence(item: dict, beside: str) -> str:
    place = _place(item, beside)
    if item["kind"] == "text":
        words = f'The words "{item["text"]}" are written' if item["text"] else "Writing is"
        look = f" The lettering: {item['desc'].rstrip('.')}." if item["desc"] else ""
        return f"{words} {place}.{look}"
    if item["picture"]:
        n = item["picture"]
        # "Exactly as in <Picture N>" made H3 Image copy that whole picture,
        # backdrop and all, over the scene: name only what to keep.
        return f"The person from <Picture {n}>, with the same face, hair and clothes as in <Picture {n}>. Placed {place}."
    desc = item["desc"].rstrip(".")
    return f"{desc[:1].upper()}{desc[1:]}. Placed {place}."


def h3_prompt(regions: list[dict], shape: tuple[float, float] | None = None, scene: bool = False) -> str:
    """The `h3_prompt` output. `shape` is the (width, height) of the canvas
    the boxes were drawn on; `scene` is True when a picture is on
    `background`, which is then <Picture 1>. No boxes give an empty text."""
    shape = shape or (1.0, 1.0)
    items = _subjects(regions, shape, 2 if scene else 1)
    if not items:
        return ""
    # Each object is placed against the object on its left, when the two
    # share some height; words in the picture are placed by the frame only.
    beside = {}
    things = [item for item in items if item["kind"] == "obj"]
    by_across = sorted(things, key=lambda item: (item["extent"][0] + item["extent"][2]) / 2)
    for before, item in zip(by_across, by_across[1:]):
        if not _overlap_down(before, item):
            continue
        gap = item["extent"][0] - before["extent"][2]
        beside[item["order"]] = _beside_words(gap, before["name"], item["order"] > before["order"])
    if scene:
        opening = (
            "One photograph of the scene in <Picture 1>, kept as it is: the same place, the same "
            "background and the same light, seen from the same camera."
        )
    else:
        opening = "One photograph, seen from one camera, in one light."
    opening += " Everything below is together in this one picture, not in separate pictures side by side."
    lines = [opening]
    lines += [_sentence(item, beside.get(item["order"], "")) for item in items]
    lines.append(
        "Everyone and everything in the picture shares the same ground and the same light, with "
        "matching shadows. It is a plain photograph: only the scene, what is in it, and the light."
    )
    return "\n\n".join([lines[0], "\n".join(lines[1:-1]), lines[-1]])
