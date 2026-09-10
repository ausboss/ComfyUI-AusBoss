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
- Widget values and route parameters are attacker-controlled: ComfyUI's
  `/prompt` and the pack's routes need no login. A node never contacts a
  host taken from one, never hands one to a subprocess, and reads or writes
  only inside ComfyUI's input, output and temp folders - no opt-in
  switches, no "any folder" settings, no folder pickers. The Registry bans
  versions for exactly this.
- No new pip dependencies without an explicit decision; if truly optional,
  use `[project.optional-dependencies]` and fail soft at runtime.
- Frontend JS never assigns prototype callbacks directly — use
  `chainCallback` from `js/shared/index.mjs`.
- Every INT and FLOAT a public node exposes reaches the user as a scrub
  control, Adobe-style: drag the value to scrub, click to type, chevron
  arrows step, Shift is always the fine step. Use `makeScrubInput` from
  `js/shared/scrub_input.mjs` — never a bare `<input type=number>`, and
  never a classic canvas number widget on a finished node face. Units
  (`px`, `MP`, `×`) ride inside the box in a fixed-width slot that every
  single-field row reserves, so the numbers down a card share one centre
  line. Known, deliberate exceptions: the Seed card's seed (typed) and Load
  Video's trim timecodes (typed).
- **Node faces are widget cards.** A node whose face would be classic
  LiteGraph widgets (full-width rows with an arrow at each end) gets an
  entry in `js/widget_cards/index.js` instead: `mountWidgetCard` from
  `js/shared/widget_card.mjs` hides the standard widgets and mirrors them
  in one compact DOM card — numbers → scrub, ≤ 4 short choices → segmented
  pill (else a select), booleans → an off | on pill as wide as the other
  controls (never a small switch inside a card), strings → text field,
  multiline → `kind: "textarea"` (`grow: true` takes the node's spare
  height), hex colors → swatch. Rows can depend on other values (`when`)
  and fold behind a disclosure (`group`). The widgets underneath stay the
  single source of truth (save/load, undo, API, links). Design detail and
  the reasons behind it: `.claude/skills/ausboss-node-brand/SKILL.md`.
- **One linkable widget per row.** The frontend (≥ 1.10.4, "Widget Input
  Socket" RFC #9) gives every widget an input socket drawn at the widget's
  own row, only while a link is dragged, hovered or connected; "convert to
  input" no longer exists. The card lends each hidden widget its row's
  position, so two widgets on one row would stack two sockets on one pixel
  and nobody could aim. A `pair` row is therefore only allowed with
  `top: true`, which lifts its sockets into the node's slot column under
  the real inputs (Image Resize width/height); everything else is one
  widget per row. A value that is meant to be wired rather than typed is a
  backend `forceInput: True` socket (Math Expression `a`/`b`/`c`), and a
  multi-type string such as `"FLOAT,INT"` accepts either kind of link.
- Preview-carrying nodes (Select Frame, Mask Refine, LaMa Inpaint) share
  `js/input_preview/`: a thin bar (node tools left, a small `preview`
  switch right) above the picture, the picture gone and the node shorter
  when the switch is off, backed by an optional `preview` BOOLEAN input
  that also skips the temp file. A new node with a result picture reuses
  it rather than growing its own.
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
node --test tests/*.test.mjs
```

Then restart ComfyUI fully (a changed `INPUT_TYPES` is only served after a
restart), watch the AusBoss banner for failed modules, confirm the node
appears in `GET http://127.0.0.1:8188/object_info`, queue a tiny API graph,
and load its example workflow. After JS changes, hard-refresh the browser
tab (Ctrl+Shift+R) — the frontend caches `.mjs` modules aggressively.

Frontend work is proven on a real canvas, not by reading code: the
headless-Chrome harness in `scripts/dev/` (recipe, gotchas and the
screenshot convention in `docs/live_testing.md`) creates nodes, drives real
mouse drags, and clips screenshots into `_scratch/node_screenshots/` for
review. A link-drop test that only checks which input got the link is not
enough — look at the picture and ask whether a person could have aimed
there.

After changing any `js/shared/*.mjs`, `nodes/_*_helpers.py` or their tests,
refresh the lab's vendored copies (see the top of this file).

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
4. Merge to main only when the release is ready, then watch the publish
   run in Actions. If it fails, inspect both the job and the Registry
   before retrying: an upload may have succeeded before a later step
   failed, and published version contents cannot be overwritten. Re-run
   "Publish to Comfy registry" only after confirming that the upload did
   not create the version.
5. Verify the version AND ITS STATUS on the registry:

   ```bash
   python scripts/registry_status.py
   ```

   Require `NodeVersionStatusActive` for the exact new version before
   calling the release available in Manager. The script reads
   `include_status_reason=true`; exit 0 means Active, 2 means not approved,
   and 1 means the status could not be established. The separate "Check
   Registry approval" Action runs after successful publication and can
   be dispatched manually to recheck without publishing again.

   As of 2026-09-07, versions 1.1.0, 1.1.1, 1.2.0, and 1.3.0 are Banned,
   not merely Flagged. The older decisions identify LM Studio's unrestricted
   endpoint; 1.2.0/1.3.0 carry a broader code-execution verdict. Review is
   tracked in https://github.com/Comfy-Org/registry-backend/issues/216.
   Resolve the recorded finding and request review of a corrected candidate;
   a fresh version number alone does not resolve a ban. Confirm the current
   issue history before posting, and obtain explicit authorization to send
   any external follow-up unless it was already authorized in the session.

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
