#!/usr/bin/env python3
"""Regenerate the repository's release badge from pyproject.toml."""

from pathlib import Path
import re

from changelog_notes import pyproject_version

ROOT = Path(__file__).resolve().parent.parent
BADGE_PATH = "assets/readme/release.svg"


def badge_svg(version: str) -> str:
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError(f"invalid release version: {version!r}")
    label = f"v{version}"
    value_width = max(54, len(label) * 7 + 8)
    width = 48 + value_width
    center = 48 + value_width / 2
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="20" role="img" aria-label="release: {label}">
  <title>release: {label}</title>
  <path fill="#555" d="M0 0h48v20H0z"/>
  <path fill="#00b4aa" d="M48 0h{value_width}v20H48z"/>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="24" y="14">release</text>
    <text x="{center:g}" y="14">{label}</text>
  </g>
</svg>
'''


if __name__ == "__main__":
    target = ROOT / BADGE_PATH
    target.write_text(badge_svg(pyproject_version()), encoding="utf-8")
    print(f"Updated {BADGE_PATH}")
