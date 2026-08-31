# ComfyUI-AusBoss — Agent Working Rules

Instructions for any coding agent working in this repo. `CLAUDE.md` imports
this file, so keep everything here and leave that one as a pointer.

A suite of polished ComfyUI custom nodes by ausboss. Public nodes must solve a
repeated workflow need, keep a compact graph footprint, and pass backend plus
browser acceptance before release.

## This repo is the showroom, not the workshop

Experiments live in the private **ComfyUI-AusBoss-Lab** repo, not here. Default
a new node to the lab and promote it later; adding it here is the deliberate
act of publishing it, and after a release its mapping key can never change.

A node belongs in the lab, not this repo, when any of these is true:

- it depends on a third-party pack or model most people will not have
- it encodes constants owned by someone else — a model card, an upstream
  default — that go stale when they change them, leaving this pack shipping
  wrong advice under ausboss's name
- it solved a need once rather than a repeated workflow need
- its inputs are still moving

The lab mirrors this repo's layout, so a promotion is a port, not a rewrite.
Its namespaces are held apart (`AUSBOSS_LAB_` ids, `🧪 AusBoss Lab/`
categories, `🧪` display suffix) so both packs install at once. The port steps
and the release gate are in the lab's `docs/promoting.md`.

`scripts/validate_nodes.py` enforces the boundary from this side: a mapping key
that is registered but absent from `PUBLIC_NODE_IDS` fails the build, so an
experiment cannot ride along into a release unnoticed.

The lab **vendors** this repo's shared modules (`js/shared/*.mjs`,
`nodes/_*_helpers.py`, their tests) and this repo is the source of truth for
those copies. After changing any of them here, refresh the lab's copies:

```bash
python ../ComfyUI-AusBoss-Lab/scripts/sync_shared.py pull
```

The lab's `docs/shared_sync.md` holds the full design; its validator also
notices stale copies on its own, so this is a courtesy, not the only line of
defense.

## Hard rules

- Never modify `LICENSE`.
- Never bump `version` in `pyproject.toml` unless explicitly asked — a
  version bump that lands on main **publishes to the Comfy Registry
  automatically** (see Releasing).
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
scripts/          # offline checks, stdlib only. validate_nodes.py is the
                  # entry point; registry_contract.py holds the rules that
                  # keep nodes visible to registry scanners.
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
- Assign each mapping **once**, at module level, to a non-empty dict literal,
  and never mention the name again — no `update()`, no `del`, no
  `alias = NODE_CLASS_MAPPINGS`. A scanner reads that one literal and stops,
  so anything done to the mapping afterwards is invisible to it. Both
  mappings must carry exactly the same keys.
- Display name: `<Name> 🆎` — the emoji is the pack signature. Typing
  "ausboss" still surfaces every node through the `🆎 AusBoss/<Group>`
  category, the `AUSBOSS_NODES_` id prefix, and the "ausboss" entry every
  node keeps in `SEARCH_ALIASES`.
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
- Numeric fields in pack panels are scrub controls, Adobe-style: drag the
  value to scrub, click to type, chevron arrows step, Shift is always the
  fine step. Use `makeScrubInput` from `js/shared/scrub_input.mjs` — never
  a bare `<input type=number>`.
- A DOM panel that shows a stage/preview claims the node's free height via
  `fillNodeHeight` from `js/shared/panel_layout.mjs` — never a hand-rolled
  `computeSize`, which pins the panel and leaves dead space when the node is
  dragged taller. `tests/panel_guards.test.mjs` enforces this pack-wide: a
  new panel entry must be added to its `mustGrow` set (or `fixedByDesign`
  for genuinely constant-height rows), so the choice is always explicit.
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

## Releasing

There is no separate "upload" step: landing a `pyproject.toml` change on
main IS publishing. `.github/workflows/publish_action.yml`
(Comfy-Org/publish-node-action, repo secret `REGISTRY_ACCESS_TOKEN`)
pushes the version to the Comfy Registry (`ausboss-nodes`, publisher
`ausboss`) on every pyproject change that reaches main — so treat the
version line as the trigger it is.

A release, when explicitly asked for:

1. Bump `version` in `pyproject.toml` **and** sync `AUSBOSS_JS_VERSION`
   in `js/shared/index.mjs` — the pair must match or the stale-frontend
   warning fires on fresh installs. The README release badge is dynamic
   (shields.io reads pyproject off main at view time) and must stay that
   way — never swap a hardcoded version badge back in.
   `python scripts/release_preflight.py` enforces all of this and the
   other release checks.
2. Retitle the CHANGELOG `## Unreleased` section to `## X.Y.Z - date`.
3. If the node roster changed, update the pyproject `description` and
   `keywords`: the registry shows the description verbatim and
   ComfyUI-Manager search matches against it, so it must name the actual
   nodes — never a generic blurb.
4. Merge to main and watch the publish run in the Actions tab. The
   push-triggered run has failed before (the 1.2.0 merge's run died and
   the version only published because someone noticed): if it fails,
   re-run it by hand — Actions → "Publish to Comfy registry" → Run
   workflow — and treat a red run as an unpublished release until proven
   otherwise.
5. Verify the version AND ITS STATUS on the registry:

   ```bash
   curl -s https://api.comfy.org/nodes/ausboss-nodes/versions | python3 -c "import json,sys; [print(v['version'], v['status']) for v in json.load(sys.stdin)]"
   ```

   `NodeVersionStatusActive` is the only status users can see. A fresh
   version usually lands as `NodeVersionStatusFlagged` — the registry's
   automated security scan holding it for human review — and a flagged
   version is INVISIBLE in ComfyUI-Manager's "Select Version" picker and
   sets no "last update" on the listing, so the release is not actually
   out until the Comfy team clears it. Every version this pack has
   published (1.1.0, 1.1.1, 1.2.0) sat flagged; ask for review through
   the Comfy Registry / Comfy-Org channels (their Discord, or the
   registry's support contact) rather than re-publishing, and re-check
   the status afterwards.

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
