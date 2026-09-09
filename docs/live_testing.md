# Live frontend testing

Frontend work in this pack is proven on a real canvas: a node is created in a
real ComfyUI tab, real mouse drags are dispatched, and the result is a
screenshot a person looks at. Reading the code, or a test that only checks
which input received a link, has let broken designs through before (three
sockets stacked on one pixel passed every automated check). This is the
recipe.

## The pieces

- **ComfyUI** on `http://127.0.0.1:8188`, with this repository installed or
  linked into `custom_nodes`. A changed `INPUT_TYPES` is served only after
  a full restart. Stop the test instance, then start it from the ComfyUI
  checkout using that installation's Python environment:

  ```bash
  python main.py --listen 127.0.0.1
  ```

  From this repository, run `python scripts/run_python_tests.py` with the
  same environment to isolate ComfyUI stubs and keep CPU thread counts
  bounded. Set `AUSBOSS_COMFY_ROOT` to the ComfyUI checkout to enable the
  optional core video integration checks.

- **Headless Chrome or Chromium** on an unused CDP port; these examples use
  **9334**. Use a separate test profile and the installed browser executable:

  ```bash
  chromium \
    --headless=new --remote-debugging-port=9334 --user-data-dir=/tmp/chrome-ausboss \
    --window-size=1800,1100 --no-first-run --no-default-browser-check about:blank &
  ```

- **`scripts/dev/`** — small Node scripts that talk CDP directly, with no
  package dependencies. Use a Node version with built-in `fetch` and `WebSocket`:

  | script | does |
  |---|---|
  | `cdp.mjs <port> <workflow.json\|-> <out.png\|-> [eval.js] [waitMs]` | opens/reuses the Comfy tab, optionally loads a workflow, evaluates a JS file, screenshots (a returned `__clip` rect clips the shot), prints the eval result as JSON |
  | `cdp_drag.mjs <port> <setup.js> <mid.png\|-> <after.png\|-> [check.js]` | `setup.js` returns `{from, to, __clip}` in client pixels; presses at `from`, moves to `to`, screenshots mid-drag, releases, evaluates `check.js`, screenshots again |
  | `audit_workflows.mjs <port> <output-dir> [workflow.json ...]` | loads every example (or selected files), exports API and loaded graphs, captures screenshots, and fails on overlaps, missing nodes, browser exceptions, or exposed AusBoss number widgets |
  | `cdp_nav_debug.mjs <port>` | navigates the tab in place and logs every CDP event, for when a tab stops answering |
  | `cdp_hang.mjs <port>` | pre-arms the debugger on a fresh tab, loads ComfyUI, and pauses to print the stack if the page stops answering |

  `CDP_RELOAD=1` closes the Comfy tab and opens a fresh one with the cache
  cleared — required after editing any `.mjs`, which the frontend caches
  hard.

## Screenshot convention

An eval creates the node at `pos [0, 0]`, sets `app.canvas.ds.scale = 1` and
`ds.offset = [160, 230]`, and returns
`__clip: { x: r.left + 152, y: r.top + 192, width: node.size[0] + 16, height: node.size[1] + 46 }`
(`r` is the canvas element's bounding rect). Shots go to
`_scratch/node_screenshots/` (gitignored) named `<round>_<Node>[_state].png`,
`_mid` for a screenshot taken during a drag and `_after` for the result.
Side-by-side pairs live in `pairs/`.

## Gotchas learned the hard way

- **Clearing the graph reuses node ids**, and the frontend's widget store
  hands a new node the previous node's widget values (a toggled `preview`
  came back `false`). Bump `app.graph.last_node_id += 50` after
  `app.graph.clear()`, or set the value you want explicitly.
- **A real mouse drag marks the workflow modified.** The next in-place
  navigation raises ComfyUI's `beforeunload` dialog and the whole tab stops
  answering every CDP call, even `1+1`; it looks exactly like a renderer
  hang. The scripts auto-accept dialogs and reload into a fresh tab.
- **Reset a half-finished link drag** (`app.canvas.linkConnector.reset()`)
  before clearing the graph in an eval.
- The mid-drag screenshot shows the socket lit and the tooltip, not the
  greyed field: the field greys once the link exists, in the `_after` shot.
- Widget input sockets are drawn only while a link is dragged, hovered, or
  connected, so a "no socket visible" screenshot at rest is normal; the
  mid-drag shot is the one that shows where a link can land.
- `cdp.mjs` requests time out after 25 s; the workflow audit allows 45 s.
  Inspect the browser's dialogs and logs when a request stops responding.
- Keep review renders and logs in the ignored `_scratch/` directory. Only
  deliberately shipped sample media belongs in `example_workflows/inputs/`.

## What to verify for a node face

1. The face at rest (values, alignment, no clipped panel).
2. Every group disclosure open.
3. A real link dropped on every row and socket, `_mid` and `_after`.
4. `app.graphToPrompt()` sends the link for a linked input and the typed
   value otherwise.
5. Save, reload (fresh tab), and confirm links, values and hidden state.
6. The preview switch on and off where the node has one.
