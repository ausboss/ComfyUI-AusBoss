"""Cut a block of text into the items Text Lines runs one at a time.

Pure text handling with no ComfyUI imports, so it runs under the
standard-library tests.
"""

from __future__ import annotations

import re

SPLIT_EACH_LINE = "each line"
SPLIT_BLANK_LINE = "blank line"
SPLIT_MODES = (SPLIT_EACH_LINE, SPLIT_BLANK_LINE)

# The words a list writer puts before an item's number: "Prompt 3:", "Shot 2 -".
# Not "image" or "picture": an edit prompt may open with "Image 1: ...".
_LABEL = r"(?:prompt|shot|scene|line|step|item)"

# A marker at the start of an item that only counts or bullets it. A bare
# number needs punctuation after it, and that punctuation must not be followed
# by a digit, so "2 women on a beach", "1.5x zoom" and "10:30 at night" stay
# whole. A bullet needs a space after it, so "*bold* text" stays whole.
_MARKER = re.compile(
    r"""^\s*(?:
        [\[【(]\s*(?:%(label)s[\s_#-]*)?\d+\s*[\]】)]\s*[:.\-–—]?   # [prompt 1]  (2)
      | %(label)s[\s_#-]*\d+\s*[:.)\-–—]                                    # Prompt 1:  Shot 2 -
      | \#?\d+\s*[.):](?!\d)                                                          # 1.  2)  #3:
      | [-*•·–—](?=\s|$)                                            # - bullet
    )\s*"""
    % {"label": _LABEL},
    re.IGNORECASE | re.VERBOSE,
)

_BLANK_LINE = re.compile(r"\n[ \t]*(?:\n[ \t]*)+")


def strip_marker(item: str) -> str:
    """Take one leading number or bullet off an item."""
    return _MARKER.sub("", item, count=1).strip()


def split_items(text, split=SPLIT_EACH_LINE, remove_numbering=True, limit=0) -> list[str]:
    """The items of `text`, in order, with empty ones left out.

    `split` picks where one item ends: at every line break, or only at an
    empty line (so an item can hold several lines). `remove_numbering` takes
    a leading "1." or "-" off each item. `limit` keeps the first so many;
    0 keeps them all.
    """
    text = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    if split == SPLIT_BLANK_LINE:
        parts = _BLANK_LINE.split(text)
    else:
        parts = text.split("\n")

    items = []
    for part in parts:
        item = part.strip()
        if remove_numbering:
            item = strip_marker(item)
        if item:
            items.append(item)

    limit = int(limit or 0)
    if limit > 0:
        items = items[:limit]
    return items
