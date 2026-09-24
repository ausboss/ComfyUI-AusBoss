# Contributing

Bug reports, workflow ideas and pull requests are welcome.

## Reporting a problem

The most useful report names:

- the ComfyUI and frontend versions (Settings → About),
- the pack version from the console banner (`AusBoss vX.Y.Z | N nodes loaded`),
- the node, what you expected, and what happened instead,
- the smallest workflow that shows it, plus a screenshot for anything visual.

Security problems go through [SECURITY.md](SECURITY.md) instead of a public
issue.

## Pull requests

- The working rules are in [AGENTS.md](AGENTS.md), and a new public node
  follows [docs/adding_a_node.md](docs/adding_a_node.md). Experiments usually
  start in a separate lab pack, so a new node is a conversation before it is
  a pull request.
- Mapping keys, input names and order, and output order are a permanent API:
  saved workflows depend on them. Append optional inputs and outputs instead
  of renaming or reordering.
- Leave `version` in `pyproject.toml` alone. A version change that reaches
  `main` publishes to the Comfy Registry.
- Run the offline checks. None of them needs a GPU; the Python tests need
  ComfyUI's Python environment.

  ```bash
  python scripts/validate_nodes.py
  python scripts/release_preflight.py
  python scripts/run_python_tests.py
  node --test tests/*.test.mjs
  ```

- Frontend changes are checked on a real canvas as well as in tests.
  [docs/live_testing.md](docs/live_testing.md) describes the headless browser
  harness and what to screenshot.
