"""Pick one choice from each {a|b|c} set in a prompt, decided by a seed.

Only a set that holds a ``|`` is a choice. Braces without one are left as
they are, so a JSON prompt passes through unchanged. Sets can sit inside
other sets; the innermost ones are picked first.
"""

from __future__ import annotations

import random
import re

# An innermost {...} that holds at least one "|", with the one space in
# front of it, so an empty pick does not leave two spaces behind.
_CHOICE = re.compile(r"( ?)\{([^{}]*\|[^{}]*)\}")


def pick_variations(text: str, seed: int) -> tuple[str, list[str]]:
    """Return the prompt with every choice set replaced, and the picks in order."""
    rng = random.Random(int(seed))
    picks: list[str] = []

    def choose(match: re.Match) -> str:
        options = [option.strip() for option in match.group(2).split("|")]
        pick = rng.choice(options)
        picks.append(pick)
        return match.group(1) + pick if pick else ""

    while True:
        text, count = _CHOICE.subn(choose, text)
        if not count:
            return text, picks


__all__ = ["pick_variations"]
