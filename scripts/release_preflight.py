#!/usr/bin/env python
"""Release preflight checks - no ComfyUI required.

Run from anywhere:  python scripts/release_preflight.py

Checks:
  1. pyproject.toml has no UTF-8 BOM. tomllib rejects a BOM, and both
     ComfyUI-Manager and the Comfy Registry parse the file with it, so a
     BOM breaks installs silently.
  2. AUSBOSS_JS_VERSION in js/shared/index.mjs equals the pyproject
     version, so the stale-browser warning never fires on a fresh install.
  3. The README release badge is the DYNAMIC shields.io kind - it reads
     the version out of pyproject.toml on main at view time, so it can
     never go stale (a hardcoded badge sat at 1.0.0 through two releases).
     The check guards against someone swapping a static badge back in.
  4. The Registry archive holds runtime files only. With git it is listed
     the way comfy-cli packs it - tracked files minus those .comfyignore
     matches - and every shipped path must sit under the runtime allowlist
     (nodes/, js/, example_workflows/, README, LICENSE, CHANGELOG,
     pyproject, __init__.py, the presets example). No runtime file may be
     dropped, every allowlist entry plus js/docs/ and
     example_workflows/inputs/ must ship, and the archive must stay under
     its size budget. Without git (an installed copy) .comfyignore is tried
     on sample paths instead.
  5. example_workflows/: every UI graph has a matching thumbnail, consistent
     links, setup instructions, and stage groups containing its nodes without
     overlaps (including title bars).
  6. Shipped source makes no network requests: no HTTP or socket client in
     the backend, and no index-based LiteGraph connect call in the frontend,
     which the Registry scan reads as a socket and flags the release for.

Exit code 0 = ready to release, 1 = problems printed below.
"""

import pathlib
import re
import sys

from registry_contract import git_paths
from workflow_contract import example_problems

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

# --- 3. the README release badge stays dynamic -------------------------------
DYNAMIC_BADGE = (
    "img.shields.io/badge/dynamic/toml"
    "?url=https%3A%2F%2Fraw.githubusercontent.com%2Fausboss%2FComfyUI-AusBoss"
    "%2Fmain%2Fpyproject.toml&query=%24.project.version"
)
try:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    if DYNAMIC_BADGE not in readme:
        errors.append(
            "README.md release badge is not the dynamic pyproject-reading "
            "shields.io badge; a hardcoded version WILL go stale"
        )
    if re.search(r"badge/release-\d+\.\d+\.\d+-", readme):
        errors.append(
            "README.md carries a hardcoded release-X.Y.Z badge; use the "
            "dynamic badge only"
        )
except OSError as exc:
    errors.append(f"could not read README.md: {exc}")

# --- 4. the Registry archive holds runtime files only ------------------------
# comfy-cli packs `git ls-files` minus whatever .comfyignore matches, and git
# answers the second half with the same gitignore rules, so with git this
# checks the real archive instead of trying the patterns on sample paths.
import fnmatch

ARCHIVE_ALLOWLIST = (
    "__init__.py", "nodes/", "js/", "example_workflows/", "README.md",
    "LICENSE", "CHANGELOG.md", "pyproject.toml", "ausboss_presets_example.json",
)
# Besides every allowlist entry these must ship too: the node help pages and
# the sample media the example workflows load.
ARCHIVE_MUST_SHIP = ("js/docs/", "example_workflows/inputs/")
# Bytes before compression. Without the README media the archive is about
# 7 MB, nearly all of it example thumbnails and inputs.
ARCHIVE_BUDGET = 12_000_000


def within(path, entry):
    return path.startswith(entry) if entry.endswith("/") else path == entry


def is_runtime(path):
    return any(within(path, entry) for entry in ARCHIVE_ALLOWLIST)


def sample(paths, limit=3):
    shown = ", ".join(paths[:limit])
    return shown if len(paths) <= limit else f"{shown} and {len(paths) - limit} more"


def comfyignore_patterns(text):
    patterns = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        patterns.append(line)
    return patterns


def ignored(path, patterns):
    """gitignore-style match, the subset .comfyignore uses: a trailing slash
    names a directory anywhere in the tree, a leading slash anchors to the
    root, anything else matches a path segment or the full path."""
    parts = path.split("/")
    for pattern in patterns:
        anchored = pattern.startswith("/")
        body = pattern.lstrip("/")
        directory = body.endswith("/")
        body = body.rstrip("/")
        if anchored:
            if directory and parts[0] == body and len(parts) > 1:
                return True
            if not directory and fnmatch.fnmatch(path, body):
                return True
            continue
        if directory:
            if body in parts[:-1]:
                return True
            continue
        if fnmatch.fnmatch(path, body) or any(fnmatch.fnmatch(part, body) for part in parts):
            return True
    return False


# Sample paths for the check without git.
DEV_ONLY = [
    "tests/test_math_helpers.py", "tests/panel_guards.test.mjs",
    "scripts/validate_nodes.py", "scripts/release_preflight.py",
    ".github/workflows/publish_action.yml", "AGENTS.md", "CLAUDE.md",
    ".claude/skills/ausboss-node-brand/SKILL.md", "docs/adding_a_node.md",
    "assets/readme/lora-chain-demo.gif",
]
RUNTIME = [
    "__init__.py", "nodes/node_seed.py", "nodes/_lora_helpers.py",
    "js/seed/index.js", "js/shared/index.mjs", "js/docs/AUSBOSS_NODES_Seed.md",
    "example_workflows/Krea 2 Outpaint (AusBoss).json",
    "example_workflows/inputs/ausboss_pier_sunrise.png",
    "README.md", "LICENSE", "pyproject.toml", "ausboss_presets_example.json",
]

tracked = git_paths(ROOT)
if tracked is not None:
    comfyignore = ROOT / ".comfyignore"
    if comfyignore.is_file():
        dropped = set(git_paths(ROOT, "--cached", "--ignored", f"--exclude-from={comfyignore}") or ())
    else:
        errors.append(".comfyignore is missing, so every tracked file would ship")
        dropped = set()
    # The packer also skips a tracked file that is gone from the working tree.
    shipped = [path for path in tracked if path not in dropped and (ROOT / path).is_file()]

    strays = {}
    for path in shipped:
        if not is_runtime(path):
            top, slash, _ = path.partition("/")
            strays.setdefault(top + slash, []).append(path)
    for top, paths in sorted(strays.items()):
        what = top if paths == [top] else f"{top} ({sample(paths)})"
        errors.append(
            f"{what} would ship in the Registry archive but is not a runtime "
            "path; add it to .comfyignore, or to ARCHIVE_ALLOWLIST in "
            "scripts/release_preflight.py if users need it"
        )
    lost = sorted(path for path in dropped if is_runtime(path))
    if lost:
        errors.append(f".comfyignore drops runtime files from the archive: {sample(lost)}")
    for entry in ARCHIVE_ALLOWLIST + ARCHIVE_MUST_SHIP:
        if not any(within(path, entry) for path in shipped):
            errors.append(f"the Registry archive has no {entry}, which must ship")
    size = sum((ROOT / path).stat().st_size for path in shipped)
    if size > ARCHIVE_BUDGET:
        errors.append(
            f"the Registry archive is {size / 1e6:.1f} MB, over its "
            f"{ARCHIVE_BUDGET / 1e6:.0f} MB budget; shrink the media it "
            "carries or raise ARCHIVE_BUDGET deliberately"
        )
    archive_summary = (
        f"Registry archive: {len(shipped)} files, {size / 1e6:.1f} MB "
        f"(budget {ARCHIVE_BUDGET / 1e6:.0f} MB)"
    )
else:
    # No git (an installed copy has no .git), so the archive cannot be
    # listed: read .comfyignore directly and try it on sample paths.
    try:
        patterns = comfyignore_patterns((ROOT / ".comfyignore").read_text(encoding="utf-8"))
    except OSError as exc:
        patterns = None
        errors.append(f"could not read .comfyignore: {exc}")
    if patterns is not None:
        for path in DEV_ONLY:
            if not ignored(path, patterns):
                errors.append(f".comfyignore does not exclude {path}, which must stay out of the archive")
        for path in RUNTIME:
            if ignored(path, patterns):
                errors.append(f".comfyignore would drop runtime path {path} from the archive")
    archive_summary = "Registry archive: git cannot list it here; .comfyignore tried on sample paths only"

# --- 5. example workflows parse and pair with thumbnails ---------------------
import json

examples = ROOT / "example_workflows"
if examples.is_dir():
    workflows = {path.stem: path for path in examples.glob("*.json")}
    for stem, path in sorted(workflows.items()):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            errors.append(f"example_workflows/{path.name} is not valid JSON: {exc}")
            continue
        if not isinstance(data, dict) or not isinstance(data.get("nodes"), list) or not data["nodes"]:
            errors.append(
                f"example_workflows/{path.name} is not a UI workflow (no nodes list) - "
                "the template browser needs the saved-workflow format, not API JSON"
            )
        if not (examples / f"{stem}.jpg").is_file():
            errors.append(f"example_workflows/{path.name} has no {stem}.jpg - it shows a blank template card")
    for path in sorted(examples.glob("*.jpg")):
        if path.stem not in workflows:
            errors.append(f"example_workflows/{path.name} has no matching {path.stem}.json")
    errors.extend(example_problems(examples))

# --- 6. shipped source makes no network requests -----------------------------
# SECURITY.md promises that no backend code contacts a host. The frontend
# wires graph links through linkSlots (js/shared/graph_links.mjs) because
# the Registry scan reads every `.connect(` as a network socket.
NETWORK_PATTERNS = {
    ".py": ("ClientSession", "urllib.request", "urlopen", "http.client",
            "import requests", "import httpx", "import socket", "from socket"),
    ".js": (".connect(",),
    ".mjs": (".connect(",),
}
shipped_source = [ROOT / "__init__.py", *sorted((ROOT / "nodes").rglob("*.py"))]
shipped_source += sorted(p for p in (ROOT / "js").rglob("*") if p.suffix in (".js", ".mjs"))
for path in shipped_source:
    if "__pycache__" in path.parts or not path.is_file():
        continue
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        errors.append(f"could not read {path.relative_to(ROOT)}: {exc}")
        continue
    for pattern in NETWORK_PATTERNS[path.suffix]:
        if pattern in text:
            errors.append(
                f"{path.relative_to(ROOT).as_posix()} contains {pattern!r}; shipped code "
                "makes no network requests (use linkSlots for graph links)"
            )

# --- report ------------------------------------------------------------------
print(archive_summary)
for error in errors:
    print(f"ERROR {error}")

if errors:
    print(f"\n{len(errors)} problem(s) found.")
    sys.exit(1)

print(f"OK - release preflight passed for version {pyproject_version}.")
