# Adding a node

Every node in this pack follows the same recipe. Copy it and you get a node
that loads, documents itself, and survives a broken neighbor.

## 1. Create the node file

`nodes/node_my_thing.py` — one node (or one tight family of nodes) per file:

```python
"""My Thing (AusBoss) — one-line summary of what it does."""


class AusBossMyThing:
    DESCRIPTION = (
        "What the node does, written for the tooltip a user reads in the "
        "search menu. Mention inputs, outputs, and any gotchas."
    )
    CATEGORY = "🧰 AusBoss/📝 Text"  # or 🖼️ Image — add new groups sparingly

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": (
                    "STRING",
                    {"default": "", "multiline": True, "tooltip": "..."},
                ),
                # ("INT", {"default": 0, "min": 0, "max": 100, "tooltip": "..."})
                # ("FLOAT", {"default": 1.0, "min": 0.0, "max": 10.0, "step": 0.05})
                # (["choice_a", "choice_b"], {"default": "choice_a"})  # dropdown
                # ("IMAGE", {"tooltip": "..."})  # BHWC float tensor batch
            },
            "optional": {},
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = ("What comes out of this slot.",)
    FUNCTION = "run"

    def run(self, text):
        return (text,)  # always a tuple, even for one output


NODE_CLASS_MAPPINGS = {"AusBossMyThing": AusBossMyThing}
NODE_DISPLAY_NAME_MAPPINGS = {"AusBossMyThing": "My Thing (AusBoss)"}
```

Rules of thumb:

- Class name and mapping key are `AusBoss<Name>` — the mapping key is what
  saved workflows reference, so treat it as permanent once released.
- Display name is `<Name> (AusBoss)` so searching "ausboss" finds everything.
- Shared backend logic goes in `nodes/_<topic>_helpers.py` (the underscore
  prefix keeps it out of the node-file pattern match).
- Nodes that display something after a run set `OUTPUT_NODE = True` and
  return `{"ui": {...}, "result": (...)}` — see `node_show_text.py`.

## 2. Register it

Add one line to `NODE_MODULES` in `__init__.py`:

```python
NODE_MODULES = [
    ...
    "node_my_thing",
]
```

That's the whole registration. If the module throws on import, the pack
logs it and loads everything else — check the AusBoss banner in the console.

## 3. (Optional) frontend JS

Only needed for custom widgets, buttons, or displaying run results.

- Entry point: `js/my_thing/index.js` — **`.js` files auto-load**, one folder
  per node.
- Shared utilities: `js/shared/*.mjs` — **`.mjs` files do not auto-load**,
  import them from your entry point.
- Never overwrite a LiteGraph prototype callback; use `chainCallback` from
  `js/shared/index.mjs`. `js/show_text/index.js` is the working example.

## 4. Validate

```bash
python scripts/validate_nodes.py
```

Then:

1. Restart ComfyUI fully (Python is only read at startup).
2. Watch the AusBoss banner — your node count should tick up, no red lines.
3. Confirm the class appears in `GET http://127.0.0.1:8188/object_info`.
4. Drop the node in a tiny graph, queue it, check the output.
5. If you touched JS, hard-refresh the browser tab (Ctrl+Shift+R).
