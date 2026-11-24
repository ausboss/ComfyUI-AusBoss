"""Read the [project] table of a pyproject.toml.

``tomllib`` is in the standard library only from Python 3.11. Some ComfyUI
installs still run 3.10 (Stability Matrix, older portable builds), and there
a bare ``import tomllib`` stopped the whole pack from loading. So this uses
``tomllib`` when it is there, the ``tomli`` backport when that is installed,
and otherwise a small reader that takes the plain ``key = "value"`` lines of
[project], which is all the pack reads (its name and version).
"""

from __future__ import annotations

import re

try:
    import tomllib as _toml
except ModuleNotFoundError:  # Python 3.10
    try:
        import tomli as _toml
    except ModuleNotFoundError:
        _toml = None

_SECTION = re.compile(r"^\s*\[([^\[\]]+)\]\s*(?:#.*)?$")
_STRING_KEY = re.compile(r"""^\s*([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*(?:#.*)?$""")


def _plain_project(text: str) -> dict:
    """The top-level string keys of [project], without a TOML library."""
    project: dict = {}
    inside = False
    for line in text.splitlines():
        section = _SECTION.match(line)
        if section:
            inside = section.group(1).strip() == "project"
            continue
        if not inside:
            continue
        match = _STRING_KEY.match(line)
        if match and match.group(1) not in project:
            value = match.group(2) if match.group(2) is not None else match.group(3)
            project[match.group(1)] = value
    return project


def project_from_text(text: str) -> dict:
    """The [project] table of pyproject text, or {} when it has none."""
    if _toml is not None:
        project = _toml.loads(text).get("project", {})
        return project if isinstance(project, dict) else {}
    return _plain_project(text)


def read_project(path: str) -> dict:
    """The [project] table of the pyproject.toml at ``path``.

    Raises OSError or a parse error like ``tomllib.load`` does, so callers
    keep their own fallbacks.
    """
    with open(path, "rb") as f:
        raw = f.read()
    # utf-8-sig drops a BOM, which tomllib itself would reject.
    return project_from_text(raw.decode("utf-8-sig"))
