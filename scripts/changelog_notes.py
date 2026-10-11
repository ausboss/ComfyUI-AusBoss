#!/usr/bin/env python3
"""A version's entries in CHANGELOG.md, as the short notes the Registry shows.

    python scripts/changelog_notes.py                  # the pyproject version
    python scripts/changelog_notes.py --version 2.9.0
    python scripts/changelog_notes.py --github-env     # for the publish workflow

Every entry of the version becomes one line: its bold opening, and for a new
node or example the sentence that says what it does. So a release reads

    - New: Mask by Name (Mask). Type the name of a thing in the picture and get its mask.
    - A file dropped anywhere on a loader node loads into it.

`--github-env` writes the notes to the file GitHub names in GITHUB_ENV, as
COMFY_NODE_CHANGELOG. comfy-cli reads that name when it publishes, and the
Registry stores the text with the version. A version without a section, or
with an empty one, is an error: the release check catches it before anything
is uploaded.

Standard library only.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
# The Registry shows the notes in a small box: a long release is cut to its
# first lines, with a pointer to the rest.
LIMIT = 3000
SIGNATURE = "\U0001f18e"  # the pack's mark after a node's name


def section(text: str, version: str) -> str | None:
    """The body under `## <version>` (with or without its date), or None."""
    found = re.search(
        rf"^## {re.escape(version)}(?:[ \t]+-[ \t]+\S+)?[ \t]*\n(.*?)(?=^## |\Z)",
        text,
        re.MULTILINE | re.DOTALL,
    )
    return found.group(1) if found else None


def _plain(words: str) -> str:
    """Markdown marks off, the pack's signature off, one space between words."""
    words = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", words)
    words = words.replace("**", "").replace("`", "").replace(SIGNATURE, "")
    return " ".join(words.split()).replace(" (", " (").replace(" .", ".").replace(" ,", ",")


def _first_sentence(words: str) -> str:
    return re.split(r"(?<=[.!?])\s", words.strip(), maxsplit=1)[0]


def entry_line(entry: str) -> str:
    """One entry of the changelog as one line of notes."""
    flat = " ".join(entry.split())
    opening = re.match(r"\*\*(.+?)\*\*\s*(.*)", flat)
    if not opening:
        return _plain(_first_sentence(flat))
    lead, rest = opening.group(1).strip(), opening.group(2).strip()
    line = lead
    if lead.lower().startswith("new"):
        # "New: Callout (Utility). A note whose text fills its box." The group
        # in brackets is kept, then the first real sentence.
        group = re.match(r"(\([^)]*\)\.?)\s*(.*)", rest)
        if group:
            line = f"{lead} {group.group(1).rstrip('.')}."
            rest = group.group(2)
        elif not lead.endswith((".", "!", "?")):
            line = lead + "."
        if rest:
            line = f"{line} {_first_sentence(rest)}"
    return _plain(line)


def notes_for(version: str, text: str) -> str:
    """The notes for `version`. Raises ValueError when there are none."""
    body = section(text, version)
    if body is None:
        raise ValueError(f"CHANGELOG.md has no section '## {version}'")
    entries = re.split(r"^- ", body, flags=re.MULTILINE)[1:]
    lines = [f"- {entry_line(entry)}" for entry in entries if entry.strip()]
    if not lines:
        raise ValueError(f"the CHANGELOG.md section for {version} has no entries")
    kept = []
    for count, line in enumerate(lines):
        if sum(len(item) + 1 for item in kept) + len(line) > LIMIT:
            kept.append(f"- and {len(lines) - count} more: see CHANGELOG.md in the repository")
            break
        kept.append(line)
    return "\n".join(kept)


def pyproject_version() -> str:
    raw = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    found = re.search(r'^version\s*=\s*"([^"]+)"', raw, re.MULTILINE)
    if not found:
        raise ValueError('pyproject.toml has no version = "..." line')
    return found.group(1)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--version", help="the version to read; the pyproject version when left out")
    parser.add_argument("--github-env", action="store_true", help="write COMFY_NODE_CHANGELOG to $GITHUB_ENV")
    args = parser.parse_args(argv)
    try:
        version = args.version or pyproject_version()
        notes = notes_for(version, (ROOT / "CHANGELOG.md").read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"ERROR {exc}", file=sys.stderr)
        return 1
    if args.github_env:
        target = os.environ.get("GITHUB_ENV")
        if not target:
            print("ERROR GITHUB_ENV is not set: --github-env is for the publish workflow", file=sys.stderr)
            return 1
        marker = "AUSBOSS_NOTES_END"
        while marker in notes:
            marker += "_"
        with open(target, "a", encoding="utf-8") as handle:
            handle.write(f"COMFY_NODE_CHANGELOG<<{marker}\n{notes}\n{marker}\n")
        print(f"Notes for {version}: {len(notes.splitlines())} line(s), {len(notes)} characters.")
        return 0
    sys.stdout.buffer.write((notes + "\n").encode("utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
