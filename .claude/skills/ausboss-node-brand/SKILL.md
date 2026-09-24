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

## Node faces: the widget card

The classic LiteGraph widget — a full-width rounded row with an arrow at
each end — is not the pack's look. Every public node whose face is made of
plain widgets gets an entry in `js/widget_cards/index.js`; `mountWidgetCard`
(`js/shared/widget_card.mjs`, pure decisions in `widget_card_math.mjs`)
hides the standard widgets and mirrors them in one compact DOM card. The
widgets underneath stay the single source of truth, so save/load, undo, the
API format and links never change.

The grammar, as ausboss signed it off in September 2026:

- **Layout.** One card per node, a label column (30 %, muted) and a control
  column. Rows are 26 px; captions (`section`) and disclosures (`group`,
  state in `node.properties.ausboss_show_<group>`) fold the rarely touched
  settings away — Crop For Inpaint opens on six rows, its targets and
  extends behind "Target size, extend". Rows that only mean something in
  one mode (`when`) show in that mode. No captions on plain number rows.
- **Numbers** are `makeScrubInput` boxes: centred value, chevrons on the
  right, the unit (`px`, `MP`, `×`) inside the box ahead of the chevrons in
  a fixed 22 px slot that every single-field row reserves whether it has a
  unit or not — that is what keeps the numbers on one centre line; a unit
  outside the box, or only in some boxes, was rejected because it nudged
  the numbers apart.
- **Choices**: ≤ 4 short labels → a segmented pill (`off | guided | matting`),
  otherwise a select with readable labels (`Width × height`).
- **Booleans** are a two-segment pill as wide as the other controls,
  `off` on the left, the on-state on the right, with short state names when
  they help (`off | embed workflow`, `every step | once per run`) and the
  explanation on the tooltip. A small 30 px switch inside a card was
  rejected as out of scale; the only small switch on a card is the
  preview bar's, which is meant to be discreet.
- **Strings** are text fields; a multiline prompt is a `kind: "textarea"`
  row (`grow: true` takes the node's spare height) so a prompt node is one
  card, not a card under two loose text boxes (Krea 2 Encode).
- **Hex colors** get a swatch plus the text.
- **One linkable widget per row.** The frontend's Widget Input Socket model
  (RFC #9, frontend ≥ 1.10.4; "convert to input" is gone) draws a widget's
  socket at the widget's own row and only while a link is dragged, hovered
  or connected. The card lends each hidden widget its row's position, so a
  link dropped on a row lands on that row's widget — but two widgets on one
  row would put two sockets on one pixel, which nobody can aim at (this
  shipped once and was caught on a screenshot). So a `pair` row is only
  allowed with `top: true`, which lifts the pair's sockets into the node's
  slot column under the real inputs and greys the field when linked (Image
  Resize width/height, Frame Interpolate's rates, Save Video fps/crf).
  Everything else is one widget per row, and a value that exists to be
  wired is a backend `forceInput` socket (Math Expression `a`/`b`/`c`,
  typed `"FLOAT,INT"` so either kind of number wires in).
- **Preview nodes** (Select Frame, Mask Refine, LaMa Inpaint) put a thin bar
  between the card and the picture: the node's tools (AUTO) on the left, a
  small `PREVIEW` switch on the right; off, the picture's box is gone and the
  node is shorter, and the backend writes no temp file. A toggle inside the
  picture box was rejected — the point is to remove the box.
- **A node that loaded shorter than its card grows on load**
  (`ensureNodeMinHeight`, `js/shared/panel_layout.mjs`) so old workflows
  never clip a panel.
- Save Image has its own card (`js/save_image/`) built from the same
  grammar: folder + browse, filename with a linked tag, live path preview,
  tag chips, format pill, and an off | embed workflow pill.

What ausboss asked to remove, so it does not come back: offset outputs on
Align Image, captions under Crop For Inpaint's rows, the small switch, units
outside the box, and typed boxes for values that are only ever wired.

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
- Chain lifecycle hooks with `chainCallback` from `js/shared/index.mjs`
  (`chainHandler` when the return value matters, as for `onMouseDown`);
  never assign prototype callbacks directly. Messages go through
  `showToast`, copies through `copyToClipboard`
  (`js/shared/clipboard.mjs`), which reports whether they worked.
- Panels that display something (stage, player, filmstrip) follow the node's
  height through `fillNodeHeight` (`js/shared/panel_layout.mjs`); only
  constant-height rows (a toolbar, a button row) may keep a fixed
  `computeSize`. `tests/panel_guards.test.mjs` holds the pack-wide roster —
  register every new panel there as `mustGrow` or `fixedByDesign`, and
  re-review the classification whenever what a panel displays changes.
- Build API URLs through the `api` module helpers — never write root-relative
  strings like `/view?...`, which break behind proxies and hosted frontends.

## Interaction etiquette

- Numbers scrub, Adobe-style — this is a signature of the pack. Every
  numeric field is a scrub control: drag left/right on the value to change
  it, click to type an exact value (typed values are honored, never
  re-snapped), chevron arrows on the right step it, ArrowUp/Down step from
  the keyboard, and Shift always means the fine step. Build them with
  `makeScrubInput` from `js/shared/scrub_input.mjs` (the LoRA loader's
  strength box is the reference feel); a bare `<input type=number>` in a
  panel is a bug, and so is a classic number widget left on a finished
  node face. Card scrubs derive their steps from the widget: the fine step
  is the widget's own increment, the coarse step is 0.05 for a 0..1 float,
  ten increments for a wide float, 8 for an integer with a range past 2048.
- Links must be aimable. Before calling a face done, drag a real link onto
  every row and socket and look at the screenshot (`docs/live_testing.md`);
  a check that only reads which input got the link proves nothing about
  whether a person could have hit it.
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
python scripts/release_preflight.py
python scripts/run_python_tests.py   # with ComfyUI's Python
node --test tests/*.test.mjs
```

Then the checklists in [AGENTS.md](../../../AGENTS.md) § Validation and
[docs/adding_a_node.md](../../../docs/adding_a_node.md): restart ComfyUI,
watch the banner, check `/object_info`, queue an API graph, load the example
workflow, and hard-refresh the browser after JS changes.
For anything visual, the headless-Chrome harness in `scripts/dev/` and the
recipe in [docs/live_testing.md](../../../docs/live_testing.md) produce the
screenshots ausboss reviews; save them under `_scratch/node_screenshots/`
with clear names (`<round>_<Node>_<state>.png`).
