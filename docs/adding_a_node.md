# Adding a polished node

New public nodes are admitted deliberately. Start with the workflow problem and contract, not a prototype file.

## Contract first

Record the following before writing code:

- Purpose and repeated workflow it replaces
- Permanent `AUSBOSS_NODES_<Purpose>` mapping key
- Display name and `🆎 AusBoss/<Group>` category
- Required/optional input IDs in serialization order, types, defaults, limits, and tooltips
- Output names, types, and order
- Tensor shapes, batch behavior, caching, errors, side effects, and API-mode behavior
- Compatibility or migration behavior

Every visible field and output must earn its place. Published IDs, input order, widget meaning, and output order are API.

## Implement narrowly

1. Put independently testable processing in an underscore-prefixed helper under `nodes/`.
2. Add one V1 wrapper in `nodes/node_<purpose>.py` with `INPUT_TYPES`, `RETURN_TYPES`, `FUNCTION`, `CATEGORY`, and both mapping dictionaries — keys as string literals, never a `NODE_ID` variable, or registry scanners cannot see the node.
3. Add the module to `NODE_MODULES` in `__init__.py` and the key to `PUBLIC_NODE_IDS` in `scripts/validate_nodes.py`; the validator fails on a registered key it does not know. A key kept only so old workflows load goes in `LEGACY_NODE_IDS` instead.
4. Give the node its face. Any INT, FLOAT, BOOLEAN, COMBO or STRING widget on a public node is shown through a widget card entry in `js/widget_cards/index.js` (see AGENTS.md §Conventions: numbers scrub, booleans are off | on pills, one linkable widget per row, `top: true` or `forceInput` for values people wire). Write more frontend JavaScript only when the card grammar cannot provide the interaction (a stage, a player, an editor).
5. Namespace every route, extension, event, DOM marker, CSS class, cache, and browser state with `ausboss`.
6. Chain lifecycle hooks through `chainCallback`; never replace core or third-party prototypes directly.
7. Keep normal workflow and API execution independent from the custom frontend.
8. Ship user-facing toggles as ComfyUI settings under the `AusBoss.*` namespace (see `.claude/skills/ausboss-node-brand/SKILL.md`). Node coloring is automatic for `AUSBOSS_NODES_*` classes via `js/appearance/` — no per-node work.

## Document and prove

- Add rich help at `js/docs/<exact-mapping-key>.md` (the validator checks it exists) and a section in `README.md`. Name card controls the way the node face shows them, with the widget name alongside: **Tone match** (`color_match`).
- Show the node in an example under `example_workflows/`, a new one or an existing one it fits: a Workflow Note, numbered groups holding every node, no overlaps, and a matching `.jpg` of a real output. AGENTS.md § Example workflows lists the rest.
- A DOM panel goes into `tests/panel_guards.test.mjs` as `mustGrow` or `fixedByDesign`.
- At the next release, name the node in the pyproject `description`: Registry and Manager search read it.
- Extend `scripts/validate_nodes.py` when the new contract needs a permanent assertion.
- Add pure Python and dependency-free JavaScript tests.
- Compile with ComfyUI's embedded Python.
- Verify `/object_info/<mapping-key>`, ownership, served assets, routes, API execution, and queued dimensions/masks.
- Test the actual canvas in Classic and Nodes 2.0, including save/reload, duplication, graph zoom, source replacement, and teardown. Drag a real link onto every card row and socket and look at where it lands (`docs/live_testing.md`); save before/after screenshots under `_scratch/node_screenshots/` for review.
- Scan the diff for paths, hosts, secrets, obsolete branding, placeholders, agent attribution, and non-ASCII import output.

Do not release a node that only works in the editor, only works for one source, or returns debugging outputs users do not need.
