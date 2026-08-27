---
name: ausboss-node-brand
description: Brand identity and design language for ComfyUI-AusBoss nodes — naming, visual language, settings conventions, frontend interaction etiquette, and the proof checklist. Load when building, porting, or restyling an AusBoss node or any pack-wide frontend feature.
---

# AusBoss node brand and design language

This skill layers the pack's *design language* on top of the hard rules in
[AGENTS.md](../../../AGENTS.md) and the admission checklist in
[docs/adding_a_node.md](../../../docs/adding_a_node.md). Read those for what is
allowed; read this for what makes a node feel like an AusBoss node.

## Identity

- Mapping key `AUSBOSS_NODES_<Purpose>` — permanent API, never renamed, and
  always written as a string literal in both mapping dicts so registry
  scanners (which parse, not import) can discover it.
- Display name `<Name> 🆎`; category `🆎 AusBoss/<Group>`. The category, the
  `AUSBOSS_NODES_` id prefix, and the "ausboss" `SEARCH_ALIASES` entry keep
  the pack searchable by name.
- Every node ships `DESCRIPTION`, input `tooltip`s, `OUTPUT_TOOLTIPS`, and
  `SEARCH_ALIASES` with intent words the display name lacks ("trim", "cut",
  "outpaint", "watermark").
- Namespace everything frontend-visible with `ausboss`: routes, extension
  names, events, CSS classes, DOM markers, caches.
- A new public node also gets named in the pyproject `description` at the
  next release — registry listings and ComfyUI-Manager search match that
  text, so an unnamed node is an undiscoverable one (AGENTS.md §Releasing).

**This identity is for the public pack only.** Experiments live in the private
ComfyUI-AusBoss-Lab repo and wear a parallel grammar so the two never collide
and a lab node is obvious on the canvas:

| | public pack | lab |
|---|---|---|
| mapping key | `AUSBOSS_NODES_<Purpose>` | `AUSBOSS_LAB_<Purpose>` |
| display name | `<Name> 🆎` | `<Name> 🧪` |
| category | `🆎 AusBoss/<Group>` | `🧪 AusBoss Lab/<Group>` |

Do not apply this skill's polish budget to a lab node. Lab nodes deliberately
skip example workflows, thumbnails, frontend work and changelog entries —
those are release-gate items, and adding them early is how a workshop turns
into a second product. They also fall outside `js/appearance/`, which keys on
the `AUSBOSS_NODES_` prefix, so they stay uncolored on purpose.

## Visual language

- Editor handle grammar (keep it consistent everywhere): **cyan squares** =
  crop, **orange diamonds** = padding, **green knob** = rotate. Section
  legends reuse the same markers so the colors teach themselves.
- Node colors come from the scheme table in
  [js/shared/appearance.mjs](../../../js/shared/appearance.mjs) — the single
  source of truth. Adding a scheme means adding one table row; the tests in
  `tests/appearance.test.mjs` validate it automatically. Title is always
  darker than body in the muted rows; the flagship "AusBoss" row (the
  pack-wide default) pairs a deep slate-teal title with a near-black body.
  Values are tuned against the dark canvas. A retired flagship pair goes
  into `LEGACY_SCHEME_PAIRS` so saved workflows upgrade instead of keeping
  the old colors as if the user had picked them.
- Coloring is automatic: `js/appearance/index.js` targets every class whose
  `comfyClass` starts with `AUSBOSS_NODES_` (plus the `SimpleWatermarkRemover`
  alias). New nodes need zero per-node color work.
- Node faces stay compact. Big interactions get a fullscreen editor or an
  inline mode — never a node with a huge fixed minimum size.

## Settings conventions

- Ids are `AusBoss.<Area>.<Name>`; register declaratively via the
  `settings: [...]` array on `app.registerExtension`.
- `category: ["🆎 AusBoss", "<Area>", "<Leaf>"]` with a **distinct leaf per
  setting** — settings sharing a leaf collapse into one panel row.
- Tooltips explain the *consequence* of the setting, in prose.
- `onChange(value)` must use the passed value (on some frontends it fires
  before the store write) and must guard against no-op changes. Seed the
  current value in `setup()` — `onChange` does not fire for the stored value
  on load on all versions.
- Every non-obvious behavior gets an off switch; surprising behaviors default
  to off.

## Frontend patterns

- Entries in `js/<feature>/index.js` auto-load; shared logic lives in
  import-only `js/shared/*.mjs`. Pure decision logic and geometry go in the
  `.mjs` modules with `node:test` coverage in `tests/*.test.mjs` — DOM wiring
  stays thin in the entry file.
- **Widgets are the single source of truth.** Rich UI drives hidden standard
  widgets (`serialize: false` on DOM widgets); no custom serialization, so
  save/load, undo, and API format work through LiteGraph's default path.
- Chain lifecycle hooks with `chainCallback` from `js/shared/index.mjs`;
  never assign prototype callbacks directly.
- Panels that display something (stage, player, filmstrip) follow the node's
  height through `fillNodeHeight` (`js/shared/panel_layout.mjs`); only
  constant-height rows (a toolbar, a button row) may keep a fixed
  `computeSize`. `tests/panel_guards.test.mjs` holds the pack-wide roster —
  register every new panel there as `mustGrow` or `fixedByDesign`, and
  re-review the classification whenever what a panel displays changes.
- Build API URLs through the `api` module helpers — never write root-relative
  strings like `/view?...`, which break behind proxies and hosted frontends.

## Interaction etiquette

- A click on empty panel space must fall through (no `preventDefault`) so the
  node stays draggable from its body.
- Wheel and middle-click belong to the graph (zoom/pan) unless the widget is
  actively using them for its own view — capture them only in an explicit
  edit mode.
- Set LiteGraph node properties with `node.color = undefined`, never
  `delete node.color` — deleting breaks reactivity under the Nodes 2.0
  renderer.
- Distinguish "workflow is loading" from "user changed the source" before
  resetting state; restored values must never be wiped by a load-path
  callback.
- Drawn glyphs stay small; hit zones stay generous (larger than the glyph).
  Corners are hit-tested before edges.

## Backend patterns

- Shared compute in `nodes/_<topic>_helpers.py`; node files are thin V1
  wrappers. IMAGE is BHWC float, MASK is BHW, returns are always tuples.
- Import-time console output stays ASCII (Windows cp1252 consoles); the 🆎
  emoji is safe only in categories and display names.
- Treat every route parameter and widget value as attacker-controlled: path
  containment checks live in shared helpers, never re-rolled per call site.

## Prove it

```bash
python scripts/validate_nodes.py
node --test tests/*.test.mjs
```

Then the full checklist in [docs/adding_a_node.md](../../../docs/adding_a_node.md):
restart ComfyUI, watch the banner, check `/object_info`, queue an API graph,
load the example workflow, and hard-refresh the browser after JS changes.
