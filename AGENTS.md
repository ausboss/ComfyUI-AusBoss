# ComfyUI-AusBoss — Agent Working Rules

Instructions for any coding agent working in this repo. `CLAUDE.md` imports
this file, so keep everything here and leave that one as a pointer.

A suite of polished ComfyUI custom nodes by ausboss. Public nodes must solve a
repeated workflow need, keep a compact graph footprint, and pass backend plus
browser acceptance before release.

## Hard rules

- Never modify `LICENSE`.
- Never bump `version` in `pyproject.toml` unless explicitly asked.
- Never add agent attribution to commits or PRs — no `Co-Authored-By`
  trailers, no "generated with" footers. Commits are authored by ausboss alone.
- Do not read or analyze `__pycache__`, `.git`, or editor config directories.
- Ask before whole-repo sweeps or large refactors; propose a short plan first.
- Keep diffs minimal: touch only the lines the task needs.
- Be concise; skip pleasantries.

## Third-party independence

- Never copy third-party code, assets, fonts, icons, CSS, or documentation.
- Review ecosystem overlap before accepting a public node. Generic overlap is
  fine, but implementation, naming, interaction design, and documentation must
  be this repository's own work.

## Architecture

```text
__init__.py       # NODE_MODULES list → importlib merge of all mappings.
                  # Fail-soft: a broken module logs and is skipped, the rest load.
nodes/
  node_<name>.py  # exactly one node (or one tight family) per file;
                  # exports NODE_CLASS_MAPPINGS + NODE_DISPLAY_NAME_MAPPINGS
  _<topic>_helpers.py  # shared backend logic, underscore prefix = not a node
js/
  <name>/index.js # frontend entry per node or pack-wide feature, e.g.
                  # appearance/ (.js files auto-load)
  shared/*.mjs    # import-only shared modules (.mjs files do NOT auto-load)
docs/             # developer docs
scripts/          # validate_nodes.py — offline checks, stdlib only
example_workflows/  # example workflows (regular workflow JSON, not API JSON)
```

## Conventions

- Public mapping keys use `AUSBOSS_NODES_<Purpose>`. The mapping key is the
  workflow-compatibility contract and must never be renamed after release.
- Write those keys as **string literals** inside `NODE_CLASS_MAPPINGS` and
  `NODE_DISPLAY_NAME_MAPPINGS` — never a `NODE_ID` variable. Registry scanners
  (ComfyUI-Manager) AST-parse the source without importing it, so a variable
  key makes every node invisible and "install missing custom nodes" stops
  offering the pack. `scripts/validate_nodes.py` enforces this.
- Display name: `<Name> (AusBoss)` so typing "ausboss" surfaces every node.
- Category: `🆎 AusBoss/<Group>`. The emoji is safe here — categories reach
  the frontend as JSON and are never printed to the console at import time.
- Every node gets `DESCRIPTION`, input `tooltip`s, and `OUTPUT_TOOLTIPS`.
- IMAGE tensors are BHWC float batches; MASK is BHW. Return tuples always,
  even for one output: `(value,)`.
- Console output at import time must stay ASCII — ComfyUI on Windows often
  runs a cp1252 console, and a UnicodeEncodeError there kills the whole pack.
- No new pip dependencies without an explicit decision; if truly optional,
  use `[project.optional-dependencies]` and fail soft at runtime.
- Frontend JS never assigns prototype callbacks directly — use
  `chainCallback` from `js/shared/index.mjs`.
- Frontend settings use `AusBoss.<Area>.<Name>` ids with
  `category: ["🆎 AusBoss", "<Area>", "<Leaf>"]` and a distinct leaf per
  setting. Node color schemes live in `js/shared/appearance.mjs`.

## Adding a node

Follow `docs/adding_a_node.md`. Short version: create `nodes/node_<name>.py`
from the template, add `"node_<name>"` to `NODE_MODULES` in `__init__.py`,
optionally add `js/<name>/index.js`, then validate. Brand and design-language
guidance (visual grammar, settings conventions, interaction etiquette) lives
in `.claude/skills/ausboss-node-brand/SKILL.md`.

## Validation

```bash
python scripts/validate_nodes.py
```

Then restart ComfyUI fully, watch the AusBoss banner for failed modules,
confirm the node appears in `GET http://127.0.0.1:8188/object_info`, queue a
tiny API graph, and load its example workflow. After JS changes, hard-refresh
the browser tab (Ctrl+Shift+R).

## Phase 2: porting an existing node

1. Drop the old file in `_scratch/` (gitignored) and read it fully first.
2. Rebuild the core compute in a clean `nodes/node_<name>.py` from the
   template — port logic deliberately, don't paste wholesale.
3. Shared logic goes to `nodes/_<topic>_helpers.py`, not duplicated.
4. Frontend goes to `js/<name>/index.js`; reusable bits to `js/shared/`.
5. Keep the old class-name string as the mapping key only if existing saved
   workflows must keep loading; otherwise use the `AUSBOSS_NODES_<Purpose>`
   convention.
6. Run the validation steps above before calling it done.
