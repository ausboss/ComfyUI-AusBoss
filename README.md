<div align="center">
  <h1>ComfyUI-AusBoss</h1>
  <p>
    <strong>AusBoss's suite of useful ComfyUI nodes.</strong><br />
    Text &amp; prompt utilities • Image helpers • more on the way
  </p>
  <p>
    <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
    <img src="https://img.shields.io/badge/status-early%20scaffold-orange?style=flat-square" alt="Status">
  </p>
</div>

---

> **Status:** Phase 1 scaffold. The nodes below are simple placeholders that prove out
> the project structure. My personal nodes get ported in next, and the pack goes public
> once it's polished.

## Nodes

| Node | What it does |
|---|---|
| **Text Box (AusBoss)** | Multiline text field with a STRING output — the basic prompt-authoring primitive. |
| **Show Text (AusBoss)** | Displays any wired-in STRING right on the node after each run, and passes it through. |
| **Random Line (AusBoss)** | Picks one line from a list, seed-driven; `#` comments and blank lines are skipped. |
| **Image Dimensions (AusBoss)** | Reads width / height / batch off an IMAGE, plus a one-line info summary. |

All nodes live under the **🧰 AusBoss** category in the node search.

## Install

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/ausboss/ComfyUI-AusBoss.git
```

Restart ComfyUI. No extra dependencies — everything runs on what ComfyUI already ships.

Try it: load [workflows/ausboss_smoke_test.json](workflows/ausboss_smoke_test.json) and hit Queue.

> Updated the pack and something looks stale? Hard-refresh the browser tab
> (**Ctrl+Shift+R**) — the browser caches ComfyUI frontend JS aggressively.

## Project structure

```text
ComfyUI-AusBoss/
├── __init__.py          # merges every node module's mappings, prints the banner
├── nodes/               # one file per node (node_*.py), shared helpers as _*.py
├── js/                  # frontend: one folder per node, shared/ for common .mjs modules
├── docs/                # developer docs (start with adding_a_node.md)
├── scripts/             # validate_nodes.py — offline sanity checks
└── workflows/           # example / smoke-test workflows
```

## Development

- **Add a node:** follow [docs/adding_a_node.md](docs/adding_a_node.md) — new file in
  `nodes/`, one line in `NODE_MODULES` in `__init__.py`.
- **Validate offline:** `python scripts/validate_nodes.py`
- After changing Python, restart ComfyUI; after changing JS, hard-refresh the tab.

## Roadmap

- [x] **Phase 1** — clean scaffold with placeholder nodes
- [ ] **Phase 2** — port my existing personal nodes into this structure
- [ ] **Phase 3** — polish, example workflows, publish publicly (+ ComfyUI registry)

## Credits

Repository structure inspired by [ComfyUI-Pixaroma](https://github.com/pixaroma/ComfyUI-Pixaroma)
(MIT) — a great example of a well-organized node pack. No code or assets are copied from it.
