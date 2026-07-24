# ComfyUI-AusBoss — Claude Working Rules

A suite of ComfyUI custom nodes by ausboss. Currently private and in
**Phase 1** (scaffold + placeholder nodes). **Phase 2** ports Austin's
existing personal nodes into this structure. **Phase 3** polishes for
public release and the ComfyUI registry.

## Hard rules

- Never modify `LICENSE`.
- Never bump `version` in `pyproject.toml` unless explicitly asked.
- Do not read or analyze `__pycache__`, `.git`, or editor config directories.
- Ask before whole-repo sweeps or large refactors; propose a short plan first.
- Keep diffs minimal: touch only the lines the task needs.
- Be concise; skip pleasantries.

## The Pixaroma reference clone

`../ComfyUI-Pixaroma` is a local clone of pixaroma/ComfyUI-Pixaroma kept
**only** as a structural reference.

- **Never copy code, assets, fonts, icons, or docs from it.**
- Before adding a new node here, check whether Pixaroma already ships the
  same thing — the goal is to complement, not clone. Overlap on generic
  utilities is fine, but the implementation and UX must be our own.

## Architecture

```text
__init__.py       # NODE_MODULES list → importlib merge of all mappings.
                  # Fail-soft: a broken module logs and is skipped, the rest load.
nodes/
  node_<name>.py  # exactly one node (or one tight family) per file;
                  # exports NODE_CLASS_MAPPINGS + NODE_DISPLAY_NAME_MAPPINGS
  _<topic>_helpers.py  # shared backend logic, underscore prefix = not a node
js/
  <name>/index.js # frontend entry per node (.js files auto-load)
  shared/*.mjs    # import-only shared modules (.mjs files do NOT auto-load)
docs/             # developer docs
scripts/          # validate_nodes.py — offline checks, stdlib only
workflows/        # example workflows (regular workflow JSON, not API JSON)
```

## Conventions

- Class + mapping key: `AusBoss<Name>` (e.g. `AusBossShowText`). Mapping key
  is the workflow-compatibility contract — never rename one after release.
- Display name: `<Name> (AusBoss)` so typing "ausboss" surfaces every node.
- Category: `🧰 AusBoss/<emoji> <Group>` — current groups: `📝 Text`, `🖼️ Image`.
- Every node gets `DESCRIPTION`, input `tooltip`s, and `OUTPUT_TOOLTIPS`.
- IMAGE tensors are BHWC float batches; MASK is BHW. Return tuples always,
  even for one output: `(value,)`.
- No new pip dependencies without an explicit decision; if truly optional,
  use `[project.optional-dependencies]` and fail soft at runtime.
- Frontend JS never assigns prototype callbacks directly — use
  `chainCallback` from `js/shared/index.mjs`.

## Adding a node

Follow `docs/adding_a_node.md`. Short version: create `nodes/node_<name>.py`
from the template, add `"node_<name>"` to `NODE_MODULES` in `__init__.py`,
optionally add `js/<name>/index.js`, then validate.

## Validation

```bash
python scripts/validate_nodes.py
```

Then restart ComfyUI fully, watch the AusBoss banner for failed modules,
confirm the node appears in `GET http://127.0.0.1:8188/object_info`, and
queue a tiny workflow (see `workflows/ausboss_smoke_test.json`). After JS
changes, hard-refresh the browser tab (Ctrl+Shift+R).

## Phase 2: porting an existing node

1. Drop the old file in `_scratch/` (gitignored) and read it fully first.
2. Rebuild the core compute in a clean `nodes/node_<name>.py` from the
   template — port logic deliberately, don't paste wholesale.
3. Shared logic goes to `nodes/_<topic>_helpers.py`, not duplicated.
4. Frontend goes to `js/<name>/index.js`; reusable bits to `js/shared/`.
5. Keep the old class-name string as the mapping key only if Austin's
   existing workflows must keep loading; otherwise use the `AusBoss<Name>`
   convention.
6. Run the validation steps above before calling it done.
