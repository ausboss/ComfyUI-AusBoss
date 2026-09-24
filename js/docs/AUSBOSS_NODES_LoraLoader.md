# LoRA Loader

Applies a whole stack of LoRAs to a model (and optionally CLIP) from one
compact node. Each row is one LoRA: an on/off pill, a searchable picker, and
strengths you can drag like a slider. Trigger words from every enabled row
come out of one socket, ready to wire into a prompt.

## Rows

- **grip** (the dotted handle): Drag up or down to reorder the stack. LoRAs
  apply in row order, so the order is part of the recipe; the move commits
  when you drop, and a cancelled drag changes nothing.
- **toggle**: Enable or disable the row without losing its settings.
- **name**: A plain click opens the picker — type to search, **Arrow
  Up/Down** to highlight, **Enter** to select, **Escape** to close; the list
  is refreshed from `models/loras` every time it opens. Dragging left/right
  on the name instead **scrubs the model strength**, and the bar behind the
  text rides along. Rows show just the file name by default; the full path
  lives in the tooltip and the picker keeps its folder groups.
- **strength**: Drag left/right on the number to scrub it, click to type an
  exact value, use the chevron arrows, or the arrow keys. Hold **Shift**
  while scrubbing or stepping for fine 0.01 moves. Range is -10 to 10.
- **i**: Info card with the preview image, base model, file size and
  modified date, and trigger words for that LoRA.

Right-click a row to insert an empty LoRA above or below it, move, duplicate,
or remove it. **Delete all LoRAs…** is a separate red, trash-marked action
with confirmation; it clears this node's rows and keeps all files on disk.
Cancel or Escape keeps the stack. Inserting keeps the existing rows and their settings in order;
the new slot uses the gear menu's default strength (initially 1).
The stack holds up to 64 rows.
One strength drives both
model and CLIP by default; the gear menu's **Separate model / CLIP
strength** switch shows a second box per row. The switch is per-node — new
nodes always start unified — and an absorb that imports a row with unequal
model/CLIP strengths flips it on automatically so the difference stays
visible.

## Strength bars

Every named row paints a center-zero bar behind its name: teal grows right
of center for positive model strength, muted red grows left for negative,
a 1px tick marks zero and a brighter 2px cap marks the value's edge. One
shared scale across the stack: the field edges represent the largest
absolute strength among the **enabled** rows, floored at 1.0 — so an
everyday stack of 0.5s reads absolutely as half-bars, one row at 2.0
rescales every bar rather than clipping, and switching that row off hands
the scale back to the strongest row still in play (the dimmed row's own
bar clamps at the edge meanwhile). The scale in play is named in each
row's tooltip.
Gear menu → "Strength bars" turns them off; "Scrub strength on the name"
turns the name-drag off.

## The control bar

The bar rides the empty middle of the output-slot band, so the node spends
its height on rows, not chrome. Left to right:

- **▤ templates** — save the current stack under a name, or apply/delete a
  saved one. Templates are shared across workflows.
- **master pill** — cycles *mixed → all on → all off → back to the mixed
  setup it destroyed*. Every hand-made row toggle refreshes that memory, so
  an accidental master click is always one more click from home.
- **summary** — how many rows are on.
- **↻ reconnect** — re-checks every row against a fresh `models/loras` list
  and repairs what it can: a row whose file moved folders (or came back
  after being missing) is rewritten to the resolved path. ComfyUI's own
  **R** refresh runs the same pass quietly.
- **⚙ gear** — settings, and the **Absorb chain LoRAs** action below.

**+ LoRA** sits inside the stack container, pinned to its bottom edge.

## Absorb the loader chain

Gear menu → **Absorb chain LoRAs**. Walks the model chain on BOTH sides of
this node — upstream through the `model` input, downstream from the `model`
output — and for every loader it recognizes (`LoraLoader`,
`LoraLoaderModelOnly`, `Power Lora Loader (rgthree)`, `PixaromaLoraLoader`,
another AusBoss LoRA Loader; Reroutes are walked through) lifts its rows
into this stack in application order: upstream loaders, your existing rows,
then downstream loaders. The original loaders are set to **bypass** only when
their connections can be preserved. Repeated filenames remain separate rows,
with their own strengths and toggles.

Details that keep the absorb faithful:

- names are resolved against this install's `models/loras` — exact match
  first, then a unique basename match ignoring folders and extension (for
  workflows saved on another machine's layout); unresolved names import
  verbatim and the rows tint red
- `LoraLoaderModelOnly` rows import with CLIP strength 0
- repeated LoRAs are kept: applying a file twice is part of the original recipe
- a shared model path, including a branch hidden behind a reroute, blocks
  absorption instead of changing another branch
- when CLIP patches move, CLIP must follow the same serial chain as MODEL;
  rows from a loader without a connected CLIP import with CLIP strength 0
- connected auxiliary outputs, such as trigger words, block absorption because
  bypassing their source would break those connections
- linked LoRA settings and stacks beyond the row limit leave the sources active
- already-bypassed or muted loaders contribute no rows
- a toast summarizes what was imported, bypassed, remapped, and skipped

## Moved and missing files

Rows are checked against the install's LoRA list. A row whose file moved
folders gets a dashed border and a tooltip naming the file the run will
use; a row with no match anywhere tints red; an ambiguous basename tints
red with advice to re-pick. Thumbnails, the info card, and range lookups
all use the resolved name, so a moved file keeps its previews and Civitai
data.

The run side matches: a stale saved path resolves by name at load time
(exact → unique case-insensitive path → unique basename, with a one-line
console note when it remaps). A LoRA that is genuinely missing **stops the
run before anything is sampled**, and the error names the file — a picture
that rendered without its LoRA is worse than no picture, above all for a
script or an agent that would happily judge it. The error also says where
the switch is.

Gear menu → **Stop on missing LoRA** (on by default) turns that off for this
node: a missing row then warns once in the console and is skipped while the
rest of the stack applies, which suits a person at the canvas who wants to
see the rest of the picture. In API graphs the same switch is the
`on_missing` input (`"error"`, the default, or `"skip"`); graphs saved before
the input existed get the default.

## Preview thumbnails

Hovering a row's name — or any entry in the picker — floats a small preview
beside the cursor when a sidecar image sits next to the LoRA file (same
basename: `.preview.png` / `.preview.jpg` / `.preview.jpeg` / `.preview.webp`,
or the bare `.png` / `.jpg` / `.jpeg` / `.webp`). No sidecar, no thumbnail —
nothing appears and nothing shifts. The gear menu's **Preview thumbnails**
switch turns the behavior off.

## Trigger words

The info card gathers words from three places: the LoRA file's own metadata,
a standard `<model>.civitai.info` sidecar when one sits beside the file
(other Civitai tools write these; the pack reads them and never goes online
itself), and words you add yourself (remembered per LoRA across workflows). Click a word to toggle it into the row; enabled rows'
selected words are joined into the `triggers` output, deduplicated, in
row order.

## Outputs

- **model**: The model with every enabled LoRA applied in row order.
- **clip**: The CLIP with every enabled LoRA applied (unchanged when no CLIP
  is connected).
- **triggers**: Comma-joined selected trigger words from enabled rows.

Rows with a strength of `0` (both model and CLIP) are skipped at load time
but still contribute their trigger words, so you can park a LoRA at zero
while comparing.


Absorption recognizes core LoRA and model-only loaders, rgthree Power Lora
Loader and Lora Loader Stack, JPS Lora Loader, Pixaroma, and AusBoss loaders.
It follows connections upstream and downstream regardless of where nodes sit
on the canvas, passing through reroutes. JPS Off rows stay disabled; rgthree
stack strengths apply to both model and CLIP. Muted or bypassed sources do
not contribute new rows. Unknown nodes and downstream forks stop the walk.
Linked LoRA settings cannot be captured as fixed rows; disconnect those
settings before absorption. If the imports exceed the stack's row limit,
the operation stops without bypassing the sources.
