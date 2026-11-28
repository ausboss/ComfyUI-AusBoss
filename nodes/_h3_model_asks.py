"""What H3 Prompt Writer asks its small model, and a node's own wording for each.

A node keeps its own wording in one hidden text input, as JSON: {"describe": ..., "next": ..., "heard": ..., "tidy": ...}.
A missing, empty or unreadable entry means the built-in wording, so a workflow saved without it runs as before."""

from __future__ import annotations

import json

from ._h3_cast_helpers import DESCRIBE_PERSON
from ._h3_script_helpers import HEARD, NEXT, fill_words as fill
from ._h3_tidy_helpers import TIDY_SYSTEM

BUILT_IN = {"describe": DESCRIBE_PERSON, "next": NEXT, "heard": HEARD, "tidy": TIDY_SYSTEM}
LONGEST_ASK = 8000


def parse_asks(value):
    """The node's own wordings that are set, by name. Anything else in the text is left out."""
    try:
        found = json.loads(value) if value else {}
    except (TypeError, ValueError, RecursionError):
        return {}
    if not isinstance(found, dict):
        return {}
    asks = {}
    for key in BUILT_IN:
        words = found.get(key)
        if isinstance(words, str) and words.strip():
            asks[key] = words.strip()[:LONGEST_ASK]
    return asks
