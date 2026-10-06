# ComfyUI-AusBoss contributor guide

Rules for contributors: how the repo is laid out, the conventions every node
follows, and the checks to run.

A suite of polished ComfyUI custom nodes by ausboss. Public nodes must solve a
repeated workflow need, keep a compact graph footprint, and pass backend plus
browser acceptance before release.

## READ FIRST: write for the people who use the nodes

Everything a user reads starts with the plainest version. That covers node
descriptions, tooltips, the `?` help pages (`js/docs/*.md`), the README,
example workflow notes, report and error text, and the CHANGELOG. Get more
technical later in the text, or in its own section.

- Open with what it does and when to use it, in everyday words and short
  sentences. Someone new to ComfyUI should get it on the first read.
- A tooltip is one or two short sentences: what this is, and what to pick.
- Measurements, test results, edge cases and how it works go further down,
  under a heading such as "Technical details".
- Keep jargon out of the opening (resample, warp, frame, affine,
  estimator, canvas space). If a term is needed, say what it means the
  first time.
- Put a number up top only when it helps someone decide what to do.

If a sentence needs a second read, rewrite it.

## Which nodes ship

A node ships only when its mapping key is listed in `PUBLIC_NODE_IDS` in
`scripts/validate_nodes.py`; the validator fails on any registered key that
is not listed there.

## Hard rules

- Never modify `LICENSE`.
- Never bump `version` in `pyproject.toml` — a version bump that lands on
  main **publishes to the Comfy Registry automatically** (see Releasing).
- Keep diffs minimal: touch only the lines the task needs.

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
scripts/          # offline checks in stdlib Python. validate_nodes.py is
                  # the entry point; registry_contract.py holds the rules
                  # that keep nodes visible to registry scanners;
                  # registry_status.py reads the Registry API; dev/ is the
                  # Node.js canvas harness (docs/live_testing.md).
example_workflows/  # example workflows (regular workflow JSON, not API JSON)
```

## Conventions

- Public mapping keys use `AUSBOSS_NODES_<Purpose>`. The mapping key is the
  workflow-compatibility contract and must never be renamed after release.
- Inputs and outputs only grow after a release: append an input as
  optional, append an output, and never rename, reorder, remove or newly
  require one. Saved workflows keep widget values by position and links by
  slot, and an API prompt must carry every required input.
  `tests/test_node_api.py` holds the pack to `tests/fixtures/node_api.json`;
  refresh that snapshot with the test's `--update` after a compatible change
  or a new node.
- Appending an input to a node with a card or panel takes one more step.
  Workflows saved by earlier releases end that node's values with an empty
  value for each card and panel, and values come back by position, so the
  new input opens holding that empty value. Give a widget input a
  `resetUnknown` fallback in its card (`js/widget_cards/index.js`), or a
  `RESET_UNKNOWN` beside `NODE_CLASS` in the node's own `js/<name>/index.js`
  if it has no card (as LoRA Loader does). The fallback equals the node's
  default, which is what an API prompt without the input runs with. Then
  list the input in `tests/saved_widget_values.test.mjs`. Cards and
  panels themselves are never saved: set `widget.serialize = false` right
  after `addDOMWidget` (`options.serialize` only keeps a widget out of the
  prompt).
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
  `/prompt` and the pack's routes need no login. Media reads and writes stay
  inside ComfyUI's input, output and temp folders - no opt-in switches, no
  "any folder" settings, no folder pickers. Besides those the pack only reads
  its registered model folders (the one write there is the `.civitai.info`
  file LoRA Loader's Civitai button saves beside a LoRA) and keeps its own
  settings files in ComfyUI's user folder (`user/ausboss/`). Nothing is handed to a
  subprocess. The Registry bans versions for exactly this.
- The pack's server code makes no network requests: no HTTP or socket client
  in shipped Python (`release_preflight.py` fails on one). The one outbound
  call is LoRA Loader's click-only Civitai lookup, made by the browser to a
  fixed civitai.com address with a plain SHA256 (`js/lora_loader/index.js`,
  `js/shared/civitai_lookup.mjs`). `release_preflight.py` allows a raw
  `fetch(` only there and in `js/cache_guard`, which only talks to the pack's
  own server. Graph links are made with
  `linkSlots` from `js/shared/graph_links.mjs`, never the index-based
  `node.connect(...)`, which registry scans read as a network socket.
  SECURITY.md states the model for users.
- No new pip dependencies without an explicit decision; if truly optional,
  use `[project.optional-dependencies]` and fail soft at runtime.
- Frontend files import each other only with plain string literals
  (`from "../shared/x.mjs"`, `import("../shared/x.mjs")`). The server adds a
  version tag to those paths (`nodes/_frontend_cache.py`) so an update never
  meets old copies from the browser's cache. A path built in code
  (`new URL(...)`, `"../shared/" + name`) escapes the tag and loads a second,
  stale copy; `tests/test_frontend_cache.py` fails on one.
- Frontend JS never assigns prototype callbacks directly — use
  `chainCallback` from `js/shared/index.mjs`, or `chainHandler` where the
  return value matters (a truthy `onMouseDown` result is what stops a node
  drag). Messages to the user go through `showToast`, never `alert()`.
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
  single source of truth (save/load, undo, API, links).
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
- Preview-carrying nodes (Select Frame, Mask Refine, Mask by Name, LaMa
  Inpaint, Save Image) share
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
- **A panel's declared minimum width is its node's real floor.** Pass
  `exactMinWidth: true` to `fillNodeHeight`; a constant-height card that
  keeps its own `computeSize` calls `holdNodeMinWidth` instead. Left alone,
  the frontend adds 104 px to a growing panel's number and ignores a pinned
  card's number altogether (the node falls to its 210 px default), so a
  declared 320 meant 424 for one and 210 for the other. Prove each face on
  a real canvas at that width in both renderers; a panel that clips there
  gets a larger minimum, not a broken face. Nodes 2.0 never goes under
  225 px whatever a panel declares.
- Frontend settings use `AusBoss.<Area>.<Name>` ids with
  `category: ["🆎 AusBoss", "<Area>", "<Leaf>"]` and a distinct leaf per
  setting. Node color schemes live in `js/shared/appearance.mjs`.

## Adding a node

Follow `docs/adding_a_node.md`. Short version: create `nodes/node_<name>.py`
modelled on a small existing node such as `nodes/node_image_size.py`, add
`"node_<name>"` to `NODE_MODULES` in `__init__.py` and the key to
`PUBLIC_NODE_IDS` in `scripts/validate_nodes.py`, give it a help page at
`js/docs/<KEY>.md`, optionally add `js/<name>/index.js`, then validate.

## Validation

Run the offline checks before a pull request:

```bash
python scripts/validate_nodes.py
python scripts/release_preflight.py
python scripts/run_python_tests.py   # with ComfyUI's Python
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
mouse drags, and screenshots the result. A link-drop test that only checks
which input got the link is not enough — look at the picture and ask whether
a person could have aimed there.

## Releasing

A new `version` in `pyproject.toml` that lands on main publishes to the Comfy
Registry through the publish workflow (`.github/workflows/publish_action.yml`).
Contributors never change `version`.

## Example workflows

Examples are what most people run first, so each one must work for a
stranger with only the files its Workflow Note lists.

- Every model loader selects the official file name, the basename of its
  download URL, carries that file in `properties.models`
  (`name`, `url`, `directory`), and the Note's model row names the same
  file. People who keep models in subfolders pick their copy.
- Media loaders (Load Image, Load Image + Pad, Load Video, Image Crop +
  Rotate + Pad and the video nodes) are saved blank. A file name is one the
  stranger doesn't have, and ComfyUI flags that node red when the workflow
  loads. The Workflow Note tells people to load their own picture; the
  sample files stay in `example_workflows/inputs/` for anyone who wants to
  try one.
- Save nodes use a filename prefix without a folder. Seeds are fixed.
- Numbered groups hold every node, nothing overlaps (title bars included),
  the saved zoom is at least 0.6 so widget text draws, the workflow `id` is
  a real uuid4, and the `.jpg` beside the `.json` shows a real output.
- The frontend saves widget values twice, by position and by name
  (`widgets_values_named`), and can restore by name; both copies must agree.
- `scripts/workflow_contract.py` checks links, groups, overlaps, the note,
  the id, the zoom, the named copies, the download info and the save
  prefixes. Whether the note tells the truth about the graph is review.
- Text-to-image examples have no source to describe. Edit and inpaint
  examples keep an explicit change instruction: a description of the old
  scene is not an edit. MiniMax H3 and Klein caption their sources with
  Qwen3-VL 8B because their own text encoders returned only punctuation
  when asked to describe an image.
