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
2. Add one V1 wrapper in `nodes/node_<purpose>.py` with `INPUT_TYPES`, `RETURN_TYPES`, `FUNCTION`, `CATEGORY`, and both mapping dictionaries.
3. Add the module to `NODE_MODULES` in `__init__.py`.
4. Add frontend JavaScript only when the normal schema cannot provide the required interaction.
5. Namespace every route, extension, event, DOM marker, CSS class, cache, and browser state with `ausboss`.
6. Chain lifecycle hooks through `chainCallback`; never replace core or third-party prototypes directly.
7. Keep normal workflow and API execution independent from the custom frontend.

## Document and prove

- Add rich help at `js/docs/<exact-mapping-key>.md`.
- Add a minimal workflow and matching JPEG under `example_workflows/`.
- Extend `scripts/validate_nodes.py` when the new contract needs a permanent assertion.
- Add pure Python and dependency-free JavaScript tests.
- Compile with ComfyUI's embedded Python.
- Verify `/object_info/<mapping-key>`, ownership, served assets, routes, API execution, and queued dimensions/masks.
- Test the actual canvas in Classic and Nodes 2.0, including save/reload, duplication, graph zoom, source replacement, and teardown.
- Scan the diff for paths, hosts, secrets, obsolete branding, placeholders, agent attribution, and non-ASCII import output.

Do not release a node that only works in the editor, only works for one source, or returns debugging outputs users do not need.
