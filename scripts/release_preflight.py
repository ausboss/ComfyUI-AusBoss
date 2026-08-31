#!/usr/bin/env python
"""Release preflight checks - no ComfyUI required.

Run from anywhere:  python scripts/release_preflight.py

Checks:
  1. pyproject.toml has no UTF-8 BOM. tomllib rejects a BOM, and both
     ComfyUI-Manager and the Comfy Registry parse the file with it, so a
     BOM breaks installs silently.
  2. AUSBOSS_JS_VERSION in js/shared/index.mjs equals the pyproject
     version, so the stale-browser warning never fires on a fresh install.
  3. The README release badge names the pyproject version, so the repo
     front page never advertises a stale release (1.0.0 sat there through
     two releases before this check existed).

Exit code 0 = ready to release, 1 = problems printed below.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
errors = []

# --- 1. pyproject.toml is BOM-free and carries a version ---------------------
pyproject_version = None
try:
    raw = (ROOT / "pyproject.toml").read_bytes()
except OSError as exc:
    errors.append(f"could not read pyproject.toml: {exc}")
    raw = b""

if raw.startswith(b"\xef\xbb\xbf"):
    errors.append("pyproject.toml starts with a UTF-8 BOM; save it without one")

match = re.search(rb'^version\s*=\s*"([^"]+)"', raw, re.MULTILINE)
if match:
    pyproject_version = match.group(1).decode("ascii", "replace")
else:
    errors.append('pyproject.toml has no version = "..." line')

# --- 2. the frontend version constant matches --------------------------------
js_version = None
try:
    shared = (ROOT / "js" / "shared" / "index.mjs").read_text(encoding="utf-8")
    js_match = re.search(r'AUSBOSS_JS_VERSION\s*=\s*"([^"]+)"', shared)
    if js_match:
        js_version = js_match.group(1)
    else:
        errors.append("js/shared/index.mjs does not define AUSBOSS_JS_VERSION")
except OSError as exc:
    errors.append(f"could not read js/shared/index.mjs: {exc}")

if pyproject_version and js_version and pyproject_version != js_version:
    errors.append(
        f"version mismatch: pyproject.toml says {pyproject_version} but "
        f"AUSBOSS_JS_VERSION is {js_version}"
    )

# --- 3. the README release badge matches -------------------------------------
readme_version = None
try:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    badge = re.search(r"badge/release-(\d+\.\d+\.\d+)-", readme)
    if badge:
        readme_version = badge.group(1)
    else:
        errors.append("README.md has no release badge (badge/release-X.Y.Z-...)")
except OSError as exc:
    errors.append(f"could not read README.md: {exc}")

if pyproject_version and readme_version and pyproject_version != readme_version:
    errors.append(
        f"version mismatch: pyproject.toml says {pyproject_version} but the "
        f"README release badge says {readme_version}"
    )

# --- report ------------------------------------------------------------------
for error in errors:
    print(f"ERROR {error}")

if errors:
    print(f"\n{len(errors)} problem(s) found.")
    sys.exit(1)

print(f"OK - release preflight passed for version {pyproject_version}.")
