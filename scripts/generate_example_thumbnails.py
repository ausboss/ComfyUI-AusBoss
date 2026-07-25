#!/usr/bin/env python
"""Regenerate the matching workflow-template thumbnails."""

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent.parent / "example_workflows"


def font(size: int, bold: bool = False):
    windows = Path(os.environ.get("WINDIR", "")) / "Fonts"
    candidates = [
        windows / ("segoeuib.ttf" if bold else "segoeui.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf"),
    ]
    for path in candidates:
        if path.is_file():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def render(filename: str, kind: str, subtitle: str) -> None:
    image = Image.new("RGB", (600, 338), "#0f1214")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((18, 18, 582, 320), 24, fill="#171b1f", outline="#344047", width=2)
    draw.rounded_rectangle((42, 46, 160, 86), 18, fill="#123d3b")
    draw.text((62, 55), kind, font=font(20, bold=True), fill="#77e2da")
    draw.text((42, 126), "Crop + Rotate + Pad", font=font(36, bold=True), fill="#f4f6f7")
    draw.text((44, 181), subtitle, font=font(21), fill="#b7bec4")
    draw.line((44, 248, 555, 248), fill="#39444b", width=2)
    draw.rectangle((44, 273, 164, 282), fill="#4bd8ef")
    draw.polygon(((220, 268), (230, 278), (220, 288), (210, 278)), fill="#ff9d42")
    draw.ellipse((274, 268, 294, 288), fill="#73e36a")
    image.save(ROOT / filename, quality=92)


render("image_crop_rotate_pad.jpg", "IMAGE", "Full-screen precision controls")
render("video_crop_rotate_pad.jpg", "VIDEO", "Exact-frame timeline and transform")
