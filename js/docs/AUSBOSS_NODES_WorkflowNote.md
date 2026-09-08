# Workflow Note

The card that makes a shared workflow self-explanatory: a big title, a
Markdown how-to, the models it needs with **Download** buttons and the folder
each one goes in, the node packs it depends on, and the author's links. Every
model file and node pack on the card is checked against **this** install and
marked installed or missing, so whoever opens the workflow sees exactly what
is left to set up before the first run.

Nothing executes. The node has no outputs and is never part of the prompt.

## Editing

- Click the **✎** in the card's corner (or right-click the node → *Edit
  Workflow Note*). The dialog has a form; **JSON** switches to the raw card
  text for copy/paste between workflows. `Ctrl+Enter` saves, `Esc` cancels.
- **Title / Subtitle / Author** make the banner. **Layout → Banner** shows
  just the title, so the same node doubles as a label for a stage or column.
- **Accent color** tints the banner bar, dots and buttons; empty keeps the
  pack teal.
- **How-to** is Markdown-lite: `#`/`##`/`###` headings, `**bold**`,
  `*italic*`, `` `code` ``, `[links](https://…)`, `-` and `1.` lists, `---`
  rules, fenced code. Only `http(s)` links become clickable.

## Models

Each row is a file, the model folder it belongs in, an optional size, and a
download URL. Rows group under a `📂 ComfyUI/models/<folder>` heading so the
card reads like the install tree — the "where do I put this" question is
answered on the same line as the button.

- The dot beside a row is the check: **teal** found, **red** missing, **grey**
  not checked (no folder set, or this install has no such folder).
- A found file swaps its Download button for an **✓ installed** pill; hovering
  the pill shows where it was found. A file that lives in a subfolder still
  counts, because the loaders find it there too.
- **↻ check files** re-runs the check after you move files in. ComfyUI's own
  **R** refresh triggers it as well.
- Folder `input` is for a sample image or clip shipped with the workflow: it
  is looked for in `ComfyUI/input`.
- Clicking a file name copies it — handy for searching a loader's picker.

The Download button is a plain link to the file's page or direct URL in a new
tab; the browser saves it wherever downloads go, and the folder line says
where to move it.

## Node packs

A row names a pack, links to it, and names one **probe node class** from that
pack (any node it registers, e.g. `AUSBOSS_NODES_LoraLoader`). If that class
is registered on this install the pack shows **✓ installed**; otherwise it is
marked missing with the link to get it. **Detect from this workflow** in the
editor lists every custom pack the open graph uses, so the list is never out
of date with the graph.

## Links

Chips for your pages — GitHub, Civitai, YouTube, Discord — whatever you want
the person who downloaded the workflow to find.

## Notes and limitations

- The card is stored as JSON in the node's one `note` widget, so save/load,
  undo, copy/paste and the API format all carry it. A card pasted from
  another workflow arrives intact.
- Every string on a downloaded card is someone else's text: it is rendered as
  text, never as HTML, and only `http(s)` URLs become buttons or links.
- The file check is a lookup against ComfyUI's model lists, not a hash: a
  same-named file of a different version passes.
- Sizes are what the author typed; the node does not fetch them.
