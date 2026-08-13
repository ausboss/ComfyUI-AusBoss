"""Tolerant fill-color parsing shared by the transform nodes.

Precedence (keep in sync with js/shared/fill_color.mjs):
  1. Hex: #RGB / #RRGGBB, and bare hex when unambiguous (6 digits, or a
     3-char form containing a-f). A bare 3-digit number like "128" is
     grayscale, not short hex.
  2. Numbers: "R, G, B" (commas or spaces) or one bare grayscale value.
     When every value is <= 1 they read as 0..1 floats, otherwise 0-255.
  3. CSS color names via PIL.ImageColor.
  4. Anything else warns once (ASCII) and falls back to mid-gray.
"""

from __future__ import annotations

import math
import re

from PIL import ImageColor

FALLBACK_RGB = (128, 128, 128)

_HEX_PATTERN = re.compile(r"^#?([0-9a-f]{3}|[0-9a-f]{6})$")
_NUMBER_PATTERN = re.compile(r"^-?\d+(\.\d+)?$")

_warned_values: set[str] = set()


def _warn_once(text: str) -> None:
    if text in _warned_values:
        return
    if len(_warned_values) > 256:
        _warned_values.clear()
    _warned_values.add(text)
    safe = text.encode("ascii", "backslashreplace").decode("ascii")
    print(f"[AusBoss] Transform: could not parse fill_color '{safe}'; using mid-gray 128,128,128.")


def _channels_from_numbers(numbers: list[float]) -> tuple[int, int, int]:
    if all(number <= 1.0 for number in numbers):
        numbers = [number * 255.0 for number in numbers]
    if len(numbers) == 1:
        numbers = numbers * 3
    # floor(x + 0.5) matches JavaScript's Math.round, keeping the editor
    # preview and the backend byte-identical on .5 boundaries.
    return tuple(max(0, min(255, math.floor(number + 0.5))) for number in numbers)


def parse_fill_color(value: object) -> tuple[int, int, int]:
    """Parse a fill color leniently; never raises, falls back to mid-gray."""
    text = str("" if value is None else value).strip()
    lowered = text.lower()

    match = _HEX_PATTERN.match(lowered)
    if match:
        digits = match.group(1)
        unambiguous = lowered.startswith("#") or len(digits) == 6 or any(
            character in "abcdef" for character in digits
        )
        if unambiguous:
            if len(digits) == 3:
                digits = "".join(character * 2 for character in digits)
            return tuple(int(digits[index : index + 2], 16) for index in (0, 2, 4))

    parts = [part for part in lowered.replace(",", " ").split() if part]
    if len(parts) in (1, 3) and all(_NUMBER_PATTERN.match(part) for part in parts):
        return _channels_from_numbers([float(part) for part in parts])

    if text:
        try:
            rgb = ImageColor.getrgb(text)
            return tuple(int(channel) for channel in rgb[:3])
        except ValueError:
            pass

    _warn_once(text)
    return FALLBACK_RGB


__all__ = ["FALLBACK_RGB", "parse_fill_color"]
