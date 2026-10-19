"""Layout Boxes: what the boxes drawn on the node turn into.

The node face (js/layout_boxes/index.js) keeps the boxes in one hidden text
widget, each box's place as fractions of the canvas. A canvas size that comes
in on a wire (a Latent Size) then never moves a box: it sits at the same
place on whatever size arrives.

The outputs are the ones ComfyUI's own Create Bounding Boxes gives, worked
out the same way, so either node can feed the same nodes after it:

- BOUNDING_BOX: one list of {x, y, width, height} in canvas pixels;
- ARRAY: prompt elements, one per box, {"type": "obj" | "text",
  "bbox": [ymin, xmin, ymax, xmax] on a 0 to 1000 grid, "text" (text boxes
  only), "desc", "color_palette" (up to five colors, when set)}.

After those, a MASK that Create Bounding Boxes does not have: 1 inside every
box (mask_rects), for changing only those places of a picture.

tests/test_layout_boxes_core_parity.py runs both nodes on the same boxes and
compares what they give, and what MOSS-Image Layout Prompt makes of it.

Boxes can also come in on the `bboxes` wire, in any form that node takes:
pixel boxes, prompt elements, or either as JSON text.

No ComfyUI and no torch here, so the offline tests import it as it is.
Pillow is loaded only to draw the preview.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

# Canvas sides, as on Create Bounding Boxes.
DIM_MIN = 64
DIM_MAX = 16384
DIM_STEP = 16
DEFAULT_SIZE = 1024

# A prompt element carries up to five colors.
MAX_COLORS = 5

EMPTY_LAYOUT = '{"v": 1, "boxes": []}'

# The preview's longest side, in pixels.
PREVIEW_LONG_EDGE = 1024
# How bright a background picture stays under the boxes in the preview.
PREVIEW_DIM = 0.45
# Boxes without a color of their own; the canvas draws them in the same one.
PLAIN_BOX = (95, 201, 192)
EMPTY_CANVAS = (30, 33, 33)


class LayoutError(ValueError):
    """Something on the node or its wires that a person can fix."""


# ---------- reading ----------


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _words(value: Any) -> str:
    if value is None:
        return ""
    return value if isinstance(value, str) else str(value)


def _colors(value: Any) -> list[str]:
    """The colors a box keeps, in order: hex strings, empty ones dropped."""
    if isinstance(value, dict):
        value = list(value.values())
    if not isinstance(value, (list, tuple)):
        return []
    return [color for color in value if isinstance(color, str) and color]


def _region(x: float, y: float, w: float, h: float, kind: Any, text: Any, desc: Any, palette: Any) -> dict:
    return {
        "x": x,
        "y": y,
        "w": w,
        "h": h,
        "type": "text" if kind == "text" else "obj",
        "text": _words(text),
        "desc": _words(desc),
        "palette": _colors(palette),
    }


def regions_from_pixel_boxes(boxes: Any, width: int, height: int) -> list[dict]:
    """Pixel boxes ({x, y, width, height, metadata}) as fractions of the canvas.

    The form Create Bounding Boxes keeps its own boxes in, and the form the
    `bboxes` wire is read into.
    """
    if not isinstance(boxes, list):
        return []
    across = width or 1
    down = height or 1
    regions = []
    for box in boxes:
        if not isinstance(box, dict):
            continue
        numbers = [_number(box.get(key, 0)) for key in ("x", "y", "width", "height")]
        if any(number is None for number in numbers):
            continue
        x, y, w, h = numbers
        meta = box.get("metadata")
        meta = meta if isinstance(meta, dict) else {}
        regions.append(_region(
            x / across, y / down, w / across, h / down,
            meta.get("type", "obj"), meta.get("text", ""), meta.get("desc", ""), meta.get("palette", []),
        ))
    return regions


def parse_layout(value: Any, width: int = DEFAULT_SIZE, height: int = DEFAULT_SIZE) -> tuple[list[dict], str]:
    """(boxes, from_input) out of the hidden `layout` widget.

    The canvas writes {"v": 1, "boxes": [{x, y, w, h, type, text, desc,
    palette}], "from_input": "<fingerprint>"}, x to h as fractions of the
    canvas. `from_input` is the fingerprint of the boxes the `bboxes` wire
    last put on the canvas (see input_fingerprint).

    A list in Create Bounding Boxes' own form (pixel boxes with metadata) is
    read too, against width and height, so boxes taken over from that node
    keep their place. A box without four numbers is left out.
    """
    if value is None:
        return [], ""
    data = value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return [], ""
        try:
            data = json.loads(text)
        except ValueError as exc:
            raise LayoutError(
                "Layout Boxes could not read its boxes: the saved layout is not valid JSON. "
                "Press Clear on the node and draw the boxes again."
            ) from exc
    if isinstance(data, list):
        return regions_from_pixel_boxes(data, width, height), ""
    if not isinstance(data, dict):
        raise LayoutError(
            "Layout Boxes could not read its boxes: the saved layout should be "
            '{"v": 1, "boxes": [...]}. Press Clear on the node and draw the boxes again.'
        )
    regions = []
    boxes = data.get("boxes")
    for item in boxes if isinstance(boxes, list) else []:
        if not isinstance(item, dict):
            continue
        numbers = [_number(item.get(key)) for key in ("x", "y", "w", "h")]
        if any(number is None for number in numbers):
            continue
        regions.append(_region(
            *numbers, item.get("type"), item.get("text", ""), item.get("desc", ""), item.get("palette", []),
        ))
    applied = data.get("from_input")
    return regions, applied if isinstance(applied, str) else ""


# ---------- the `bboxes` wire ----------


def _is_element(item: dict) -> bool:
    box = item.get("bbox")
    return isinstance(box, (list, tuple)) and len(box) == 4


def _is_pixel_box(item: dict) -> bool:
    return all(key in item for key in ("x", "y", "width", "height"))


def _pixel_boxes(data: Any) -> list[dict]:
    """Pixel boxes from one box, a list of boxes, or a BOUNDING_BOX value
    (one list of boxes per frame: the first frame is the one used)."""
    if isinstance(data, dict):
        items = [data]
    elif not isinstance(data, list) or not data:
        items = []
    elif isinstance(data[0], dict):
        items = data
    elif isinstance(data[0], list):
        items = data[0]
    else:
        items = []
    boxes = []
    for item in items:
        if not isinstance(item, dict):
            continue
        box = {
            "x": item.get("x", 0),
            "y": item.get("y", 0),
            "width": item.get("width", 0),
            "height": item.get("height", 0),
        }
        if isinstance(item.get("metadata"), dict):
            box["metadata"] = item["metadata"]
        boxes.append(box)
    return boxes


def _element_boxes(elements: list, width: int, height: int) -> list[dict]:
    """Prompt elements ([ymin, xmin, ymax, xmax] on a 0 to 1000 grid) as
    pixel boxes of this canvas."""
    boxes = []
    for element in elements:
        if not isinstance(element, dict):
            continue
        grid = element.get("bbox")
        if not (isinstance(grid, (list, tuple)) and len(grid) == 4):
            raise LayoutError(
                "An element on the bboxes input has no usable 'bbox'. It needs four numbers: "
                "[ymin, xmin, ymax, xmax] on a 0 to 1000 grid."
            )
        try:
            top, left, bottom, right = (float(value) / 1000.0 for value in grid)
        except (TypeError, ValueError) as exc:
            raise LayoutError(
                "An element on the bboxes input has a 'bbox' that is not four numbers. It needs "
                "[ymin, xmin, ymax, xmax] on a 0 to 1000 grid."
            ) from exc
        kind = "text" if element.get("type") == "text" else "obj"
        boxes.append({
            "x": round(min(left, right) * width),
            "y": round(min(top, bottom) * height),
            "width": round(abs(right - left) * width),
            "height": round(abs(bottom - top) * height),
            "metadata": {
                "type": kind,
                "text": element.get("text", "") if kind == "text" else "",
                "desc": element.get("desc", ""),
                "palette": element.get("color_palette", []) or [],
            },
        })
    return boxes


def boxes_from_input(data: Any, width: int, height: int) -> list[dict]:
    """What came in on `bboxes`, as pixel boxes of this canvas.

    Takes what Create Bounding Boxes takes: BOUNDING_BOX values, prompt
    elements, one of either, or the same written as JSON text. Nothing, an
    empty list or empty text gives no boxes. Anything else stops the run with
    a message that says what the input needs.
    """
    if data is None:
        return []
    if isinstance(data, str):
        text = data.strip()
        if not text:
            return []
        try:
            data = json.loads(text)
        except ValueError as exc:
            raise LayoutError(f"The text on the bboxes input is not valid JSON ({exc}).") from exc
    if isinstance(data, dict):
        if _is_element(data):
            return _element_boxes([data], width, height)
        if _is_pixel_box(data):
            return _pixel_boxes(data)
        raise LayoutError(
            "The bboxes input needs a box (x, y, width, height) or a prompt element (with a 'bbox')."
        )
    if not isinstance(data, list):
        raise LayoutError(
            "The bboxes input needs bounding boxes, prompt elements, or the same as JSON text, "
            f"not {type(data).__name__}."
        )
    if not data:
        return []
    first = data[0]
    if isinstance(first, list):
        return _pixel_boxes(data)
    if isinstance(first, dict):
        if _is_element(first):
            return _element_boxes(data, width, height)
        if _is_pixel_box(first):
            return _pixel_boxes(data)
        raise LayoutError(
            "The bboxes input needs boxes (x, y, width, height) or prompt elements (with a 'bbox')."
        )
    raise LayoutError(
        f"The bboxes input needs a list of boxes or prompt elements, not a list of {type(first).__name__}."
    )


def input_fingerprint(data: Any) -> str:
    """A short fingerprint of what came in on `bboxes`.

    The canvas keeps the fingerprint of the boxes the wire last put on it.
    While the wire brings the same value again, the boxes on the canvas (with
    any change made there) are the ones used; a new value fills the canvas
    again. It is taken from the value itself, so a new canvas size alone
    does not count as new boxes.
    """
    try:
        text = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True, default=str)
    except (TypeError, ValueError):
        text = repr(data)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


# ---------- the outputs ----------


def _pixels(region: dict, width: int, height: int) -> dict:
    x, y = region.get("x", 0.0), region.get("y", 0.0)
    w, h = region.get("w", 0.0), region.get("h", 0.0)
    if w < 0:
        x, w = x + w, -w
    if h < 0:
        y, h = y + h, -h
    return {"x": round(x * width), "y": round(y * height), "width": round(w * width), "height": round(h * height)}


def bounding_boxes(regions: list[dict], width: int, height: int) -> list:
    """The BOUNDING_BOX output: one frame holding every box, in pixels.
    No boxes gives an empty list."""
    frame = [_pixels(region, width, height) for region in regions if isinstance(region, dict)]
    return [frame] if frame else []


def _on_grid(value: float) -> int:
    return max(0, min(1000, round(value * 1000)))


def _grid_box(region: dict) -> list[int]:
    x, y = region.get("x", 0.0), region.get("y", 0.0)
    w, h = region.get("w", 0.0), region.get("h", 0.0)
    top, left, bottom, right = _on_grid(y), _on_grid(x), _on_grid(y + h), _on_grid(x + w)
    return [min(top, bottom), min(left, right), max(top, bottom), max(left, right)]


def element_colors(value: Any) -> list[str]:
    """A box's colors as a prompt element writes them: upper case."""
    if isinstance(value, dict):
        value = value.values()
    if not isinstance(value, (list, tuple, type({}.values()))):
        return []
    return [color.upper() for color in value if isinstance(color, str) and color]


def prompt_elements(regions: list[dict]) -> list[dict]:
    """The ARRAY output: one prompt element per box, in the boxes' order."""
    elements = []
    for region in regions:
        if not isinstance(region, dict):
            continue
        kind = "text" if region.get("type") == "text" else "obj"
        element = {"type": kind, "bbox": _grid_box(region)}
        if kind == "text":
            element["text"] = region.get("text", "")
        element["desc"] = region.get("desc", "")
        colors = element_colors(region.get("palette", []))
        if colors:
            element["color_palette"] = colors[:MAX_COLORS]
        elements.append(element)
    return elements


def canvas_boxes(regions: list[dict]) -> list[dict]:
    """Boxes in the form the canvas keeps them, for the node's face."""
    keys = ("x", "y", "w", "h", "type", "text", "desc", "palette")
    return [{key: region[key] for key in keys} for region in regions]


def mask_rects(regions: list[dict], width: int, height: int) -> list[tuple[int, int, int, int]]:
    """Where the MASK output is white: each box as (left, top, right, bottom)
    in whole pixels of a width x height picture, cut to the picture.

    The pixels are rounded as the BOUNDING_BOX output rounds them, so on the
    canvas size the mask is white exactly inside those boxes. A box with no
    area on the picture is left out.
    """
    rects = []
    for region in regions:
        if not isinstance(region, dict):
            continue
        box = _pixels(region, width, height)
        left = max(0, min(width, box["x"]))
        top = max(0, min(height, box["y"]))
        right = max(0, min(width, box["x"] + box["width"]))
        bottom = max(0, min(height, box["y"] + box["height"]))
        if right > left and bottom > top:
            rects.append((left, top, right, bottom))
    return rects


# ---------- the preview ----------


def hex_color(value: Any) -> tuple[int, int, int] | None:
    """#rgb, #rrggbb or #rrggbbaa as an RGB triple; None for anything else."""
    text = value.strip().lstrip("#") if isinstance(value, str) else ""
    if len(text) == 3:
        text = "".join(digit * 2 for digit in text)
    elif len(text) == 8:
        text = text[:6]
    if len(text) != 6:
        return None
    try:
        return tuple(int(text[index:index + 2], 16) for index in (0, 2, 4))
    except ValueError:
        return None


def box_color(region: dict) -> tuple[int, int, int]:
    """The box's first color, or the plain box color."""
    for color in region.get("palette") or []:
        rgb = hex_color(color)
        if rgb is not None:
            return rgb
    return PLAIN_BOX


def box_words(region: dict) -> str:
    """What a box says on the preview: the text in quotes for a text box,
    then the description."""
    desc = str(region.get("desc") or "").strip()
    text = str(region.get("text") or "").strip()
    if region.get("type") == "text" and text:
        return f'"{text}" - {desc}' if desc else f'"{text}"'
    return desc


def _font(size: int):
    from PIL import ImageFont

    try:
        return ImageFont.load_default(size)
    except TypeError:  # Pillow before 10.1 has one fixed size
        return ImageFont.load_default()


def _wrapped(draw, text: str, font, room: float) -> list[str]:
    lines = []
    for paragraph in text.split("\n"):
        line = ""
        for word in paragraph.split():
            longer = f"{line} {word}" if line else word
            if line and draw.textlength(longer, font=font) > room:
                lines.append(line)
                line = word
            else:
                line = longer
        lines.append(line)
    return lines


def _dark_on(rgb: tuple[int, int, int]) -> bool:
    red, green, blue = rgb
    return 0.299 * red + 0.587 * green + 0.114 * blue > 150


def render_preview(regions: list[dict], width: int, height: int, background=None):
    """A picture of the canvas: the background dimmed (or a plain dark
    canvas), each box outlined in its color with its number and words, and
    its colors as a strip along its top edge. Later boxes sit on top.
    Returns a PIL RGB image at most PREVIEW_LONG_EDGE on its longest side."""
    from PIL import Image, ImageDraw, ImageEnhance

    long_edge = max(int(width), int(height), 1)
    scale = min(1.0, PREVIEW_LONG_EDGE / long_edge)
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    if background is not None:
        base = background.convert("RGB").resize(size, Image.LANCZOS)
        base = ImageEnhance.Brightness(base).enhance(PREVIEW_DIM)
    else:
        base = Image.new("RGB", size, EMPTY_CANVAS)
    picture = base.convert("RGBA")
    across, down = size
    line = max(2, round(min(across, down) / 320))
    text_size = max(11, round(down / 48))
    font = _font(text_size)
    tag_font = _font(max(10, text_size - 1))
    for number, region in enumerate(regions, start=1):
        if not isinstance(region, dict):
            continue
        layer = Image.new("RGBA", size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        color = box_color(region)
        pixels = _pixels(region, across, down)
        left = max(0, min(across - 1, pixels["x"]))
        top = max(0, min(down - 1, pixels["y"]))
        right = max(left, min(across - 1, pixels["x"] + pixels["width"]))
        bottom = max(top, min(down - 1, pixels["y"] + pixels["height"]))
        draw.rectangle([left, top, right, bottom], fill=color + (46,), outline=color + (255,), width=line)
        colors = [rgb for rgb in (hex_color(c) for c in region.get("palette") or []) if rgb][:MAX_COLORS]
        if colors and right - left > 4:
            strip = max(4, text_size // 2)
            step = (right - left) / len(colors)
            for index, rgb in enumerate(colors):
                draw.rectangle(
                    [left + round(index * step), top, left + round((index + 1) * step), min(bottom, top + strip)],
                    fill=rgb + (255,),
                )
        tag = str(number)
        tag_width = draw.textlength(tag, font=tag_font)
        draw.rectangle([left, top, left + tag_width + 8, top + text_size + 4], fill=color + (255,))
        draw.text((left + 4, top + 2), tag, font=tag_font, fill=(10, 14, 14, 255) if _dark_on(color) else (255, 255, 255, 255))
        words = box_words(region)
        room = right - left - 10
        if words and room > 8:
            y = top + text_size + 8
            for row in _wrapped(draw, words, font, room):
                if y + text_size > bottom:
                    break
                draw.text((left + 5, y), row, font=font, fill=(244, 248, 248, 255), stroke_width=1, stroke_fill=(0, 0, 0, 220))
                y += text_size + 3
        picture = Image.alpha_composite(picture, layer)
    return picture.convert("RGB")


__all__ = [
    "DEFAULT_SIZE",
    "DIM_MAX",
    "DIM_MIN",
    "DIM_STEP",
    "EMPTY_LAYOUT",
    "LayoutError",
    "MAX_COLORS",
    "bounding_boxes",
    "box_words",
    "boxes_from_input",
    "canvas_boxes",
    "element_colors",
    "hex_color",
    "input_fingerprint",
    "mask_rects",
    "parse_layout",
    "prompt_elements",
    "regions_from_pixel_boxes",
    "render_preview",
]
