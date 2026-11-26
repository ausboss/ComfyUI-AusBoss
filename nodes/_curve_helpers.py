"""Strength Curve: a drawn curve as a per-step schedule.

The curve is a few points from the start of a run (0) to its end (1), joined
by a smooth line that never overshoots them (a monotone cubic, Fritsch and
Carlson 1980). It leaves the node as core's FLOATS type: CURVE_SAMPLES values
spread evenly from start to end, the same reading core's own Create Hook
Keyframes From Floats gives a list. Nodes that take a schedule turn it into
core hook keyframes, so every one of them reads "where in the run" the way
core does: by the noise level of the step, not by its number.

Everything above `hook_keyframes` is plain Python, testable without torch.
"""

from __future__ import annotations

import json
import math
from typing import Any

CURVE_SAMPLES = 101
MAX_POINTS = 32
DEFAULT_POINTS = "[[0, 1], [1, 1]]"
SCHEDULE_LIMIT = 10.0
# Strengths closer than this are one keyframe: core rebuilds a LoRA's weights
# each time the keyframe changes, and a step that moves by less is not worth it.
_KEYFRAME_STEP = 1e-4


def _number(value: Any, what: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"Strength Curve: {what} must be a number, got {value!r}.") from None
    if not math.isfinite(number):
        raise ValueError(f"Strength Curve: {what} must be a finite number.")
    return number


def parse_points(raw: Any) -> list[tuple[float, float]]:
    """Clean, sorted points that start at 0 and end at 1.

    Accepts the saved JSON text or a list of [where, value] pairs (or
    {"x", "y"} objects). Both coordinates are held to 0..1; two points at
    the same place keep the later one. A curve that does not reach an end
    is carried flat to it. An empty value is a flat line at 1.
    """
    data = raw
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        data = json.loads(DEFAULT_POINTS)
    elif isinstance(raw, str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Strength Curve: the points are not valid JSON ({exc.msg}).") from None
    if not isinstance(data, list):
        raise ValueError("Strength Curve: the points must be a list of [where, value] pairs.")
    if len(data) > MAX_POINTS:
        raise ValueError(f"Strength Curve: at most {MAX_POINTS} points, got {len(data)}.")
    found: dict[float, float] = {}
    for index, entry in enumerate(data, start=1):
        if isinstance(entry, dict):
            entry = [entry.get("x"), entry.get("y")]
        if not isinstance(entry, (list, tuple)) or len(entry) != 2:
            raise ValueError(f"Strength Curve: point {index} must be a [where, value] pair.")
        x = min(1.0, max(0.0, _number(entry[0], f"point {index}'s place")))
        y = min(1.0, max(0.0, _number(entry[1], f"point {index}'s value")))
        found[x] = y
    if not found:
        return [(0.0, 1.0), (1.0, 1.0)]
    points = sorted(found.items())
    if points[0][0] > 0.0:
        points.insert(0, (0.0, points[0][1]))
    if points[-1][0] < 1.0:
        points.append((1.0, points[-1][1]))
    return points


def _slopes(xs: list[float], ys: list[float]) -> list[float]:
    """Tangents that keep each piece inside its two points (Fritsch-Carlson)."""
    count = len(xs)
    secants = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(count - 1)]
    slopes = [secants[0], *[0.0] * (count - 2), secants[-1]]
    for i in range(1, count - 1):
        before, after = secants[i - 1], secants[i]
        slopes[i] = 0.0 if before * after <= 0 else (before + after) / 2
    for i, secant in enumerate(secants):
        if secant == 0:
            slopes[i] = slopes[i + 1] = 0.0
            continue
        a, b = slopes[i] / secant, slopes[i + 1] / secant
        length = a * a + b * b
        if length > 9:
            scale = 3 / math.sqrt(length)
            slopes[i], slopes[i + 1] = scale * a * secant, scale * b * secant
    return slopes


def curve_values(points: list[tuple[float, float]], places: list[float]) -> list[float]:
    """The curve's value (0..1) at each place (0..1)."""
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    if len(points) < 2:
        return [ys[0] if ys else 1.0 for _ in places]
    slopes = _slopes(xs, ys)
    out = []
    piece = 0
    for place in places:
        place = min(1.0, max(0.0, float(place)))
        piece = 0
        while piece < len(xs) - 2 and place > xs[piece + 1]:
            piece += 1
        width = xs[piece + 1] - xs[piece]
        t = (place - xs[piece]) / width
        t2, t3 = t * t, t * t * t
        value = ((2 * t3 - 3 * t2 + 1) * ys[piece] + (t3 - 2 * t2 + t) * width * slopes[piece]
                 + (-2 * t3 + 3 * t2) * ys[piece + 1] + (t3 - t2) * width * slopes[piece + 1])
        out.append(min(1.0, max(0.0, value)))
    return out


def build_schedule(points: Any, low: float = 0.0, high: float = 1.0, count: int = CURVE_SAMPLES) -> list[float]:
    """The curve as `count` evenly spread values, its 0 at `low` and its 1 at `high`."""
    low = _number(low, "Bottom")
    high = _number(high, "Top")
    places = [i / (count - 1) for i in range(count)]
    return [low + (high - low) * y for y in curve_values(parse_points(points), places)]


def as_schedule(value: Any) -> list[float] | None:
    """A schedule from a FLOATS link: a list of numbers, or one number for a flat line.

    None stays None (nothing linked). Values are held to 0..SCHEDULE_LIMIT.
    """
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        items = [value]
    else:
        try:
            items = [float(item) for item in value]
        except (TypeError, ValueError):
            raise ValueError("The curve input takes a list of numbers (FLOATS), like Strength Curve's output.") from None
    if not items:
        return None
    out = []
    for item in items:
        number = float(item)
        if not math.isfinite(number):
            raise ValueError("The curve input holds a value that is not a finite number.")
        out.append(min(SCHEDULE_LIMIT, max(0.0, number)))
    return out


def schedule_at(values: list[float], place: float) -> float:
    """The schedule's value at `place` (0 = start of the run, 1 = end), read straight between samples."""
    if not values:
        return 1.0
    if len(values) == 1:
        return float(values[0])
    spot = min(1.0, max(0.0, float(place))) * (len(values) - 1)
    left = min(int(spot), len(values) - 2)
    t = spot - left
    return float(values[left] * (1 - t) + values[left + 1] * t)


def keyframe_plan(values: list[float], count: int = CURVE_SAMPLES) -> list[tuple[float, float]]:
    """(start percent, strength) pairs for core hook keyframes.

    The schedule is read at `count` evenly spread places so a short list
    still changes smoothly, and a run of equal strengths keeps one keyframe:
    core rebuilds hooked weights only where the strength moves.
    """
    plan: list[tuple[float, float]] = []
    for i in range(count):
        percent = i / (count - 1)
        strength = round(schedule_at(values, percent), 4)
        if plan and abs(plan[-1][1] - strength) < _KEYFRAME_STEP:
            continue
        plan.append((percent, strength))
    return plan


def hook_keyframes(values: list[float]):
    """A core HookKeyframeGroup that follows the schedule over the run.

    Core turns each start percent into a noise level once the model is known
    and, at every step, takes the last keyframe the run has reached.
    """
    import comfy.hooks

    group = comfy.hooks.HookKeyframeGroup()
    for index, (percent, strength) in enumerate(keyframe_plan(values)):
        group.add(comfy.hooks.HookKeyframe(strength=strength, start_percent=percent,
                                           guarantee_steps=1 if index == 0 else 0))
    return group
