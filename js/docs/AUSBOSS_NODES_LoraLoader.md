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
  lives in the tooltip and the picker keeps its folder groups. A name too
  long for its row is cut at the end; gear menu → **Long names** →
  `middle` cuts the middle instead, so the checkpoint number at the end
  (`…_000004000`, `…_epoch_10`) stays visible in a narrow node. The picker
  opens wide enough for long names; when one still does not fit, it
  shortens the folder first and keeps the end of the file name.
- **strength**: Drag left/right on the number to scrub it, click to type an
  exact value, use the chevron arrows, or the arrow keys. Hold **Shift**
  while scrubbing or stepping for fine 0.01 moves. Range is -10 to 10.
- **i**: Info card with the preview image, base model, file size and
  modified date, and trigger words for that LoRA.

Right-click a row to insert an empty LoRA above or below it, move, duplicate,
or remove it. **Remove this LoRA** is red. **Delete all LoRAs…** is a separate red, trash-marked action
with confirmation; it clears this node's rows and keeps all files on disk.
Cancel or Escape keeps the stack. Inserting keeps the existing rows and their settings in order;
the new slot uses the gear menu's default strength (initially 1).
The stack holds up to 64 rows.
One strength drives both
model and CLIP by default; the gear menu's **Separate model / CLIP
strength** switch shows a second box per row. The switch is per-node — new
nodes always start unified — and an absorb that imports a row with unequal
model/CLIP strengths flips it on automatically so the difference stays
visible. Turning it back off sets every row's CLIP strength to its model
strength.

## Rows on a subgraph box

When the loader sits inside a subgraph, its rows can show on the box
itself, so you can switch LoRAs on and off and change strengths without
opening the box.

1. Open the box and press the loader's gear. The first item is **Rows on the
   box**.
2. Press **Show**. The rows now show on the box's face.

Each copy of the box keeps its own rows, and that copy is what runs. Inside,
the loader says "These rows are set on the box" and shows the rows of the
box you came in through; a change there goes to that box. **Take back**, in
the same place, puts the rows inside the loader again, as the box you came in
through holds them, and every copy of the box then runs those rows.

On the box the card keeps the rows, the master pill and **Re-check LoRA
files**. Templates and the gear stay on the loader inside.

Workflow Switches can set the rows on a box like any other setting: select
the box and save its on and off (see the Workflow Switches help).

## Rows a switch sets

A row that a Workflow Switches switch turns on or off shows a **lock** where
its drag handle is, and a thin line down its left edge. Hover the lock to
see which switch sets it. Click the lock to take the row over: the switch
forgets that row and leaves it alone from then on, and stops reading
"changed" because of it. Everything else the switch does stays. A locked row
still drags to a new place.

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
  saved one. Templates are kept in this browser and shared by every
  workflow opened in it.
- **master pill** — cycles *mixed → all on → all off → back to the mixed
  setup it destroyed*. Every hand-made row toggle refreshes that memory, so
  an accidental master click is always one more click from home.
- **summary** — how many rows are on.
- **↻ reconnect** — re-checks every row against a fresh `models/loras` list
  and repairs what it can: a row whose file moved folders (or came back
  after being missing) is rewritten to the resolved path. ComfyUI's own
  **R** refresh runs the same pass quietly.
- **⚙ gear** — settings, and the **Absorb chain LoRAs** action below.

**+ LoRA** opens one list of files grouped by folder. Click a file to add
one LoRA, or click a folder name to add all its LoRAs, including nested
folders. Use the arrow beside a folder to collapse or expand it without
adding anything. Folded folders are remembered in this browser. Search
reveals matching files; clearing it brings back your folded view. You can
also fold folders while searching.

Each folder shows **Add all** and its full file count, even when
search hides some of its files. New rows use the gear menu's default
strength. A folder skips files already in the stack; existing rows keep
their order, strengths and switches. The same filename in different folders
counts as separate LoRAs.

The choice is one undo step. Closing the picker without choosing changes
nothing. If a folder would take the stack past 64 rows, nothing is added
and a message says how much room is needed. Remove rows or pick a smaller
folder. Typing a filename and pressing Enter picks one file; use the arrow
keys to highlight a folder before Enter if you want the whole folder.
Pointing at a folder with the mouse does not choose it for Enter.
Left and Right collapse and expand a highlighted folder.
Clicking an existing row's name still replaces only that row's file.

## Keyboard controls

Press Tab until a row is outlined. The outlined row is the one you are
changing. A click on the thin gap between two of a row's controls outlines
it too.

- **Up / Down** moves between rows and **+ LoRA**.
- **Enter** opens that row's file picker, or adds a new LoRA from **+ LoRA**.
  In the picker, use Up / Down and Enter as usual. Picking a file returns
  focus to its row; Escape returns without changing it.
- **Space** turns the outlined row off or on.
- **Left / Right** decreases or increases model strength by the gear menu's
  strength step (0.05 by default). **Shift** uses a smaller 0.01 step.
  Linked mode changes CLIP strength too. With separate strengths, focus
  the CLIP box to change CLIP alone.
- **Tab** keeps moving through controls normally. On one of a row's own
  buttons, Enter and Space press that button. **Escape** leaves row
  keyboard control. Clicking outside the loader does the same.
- **Delete** and **Backspace** do nothing on a row, its controls or
  **+ LoRA**, so they cannot delete the node by mistake. Click the node or
  the graph first to delete the node.

Working with the mouse does not start keyboard control: after you click a
switch or pick a file from the list, the keys stay with ComfyUI.

Typing in a field keeps its ordinary editing keys. These shortcuts only
apply inside this loader; ComfyUI's Ctrl/Cmd shortcuts still pass through.

## Absorb the loader chain

Gear menu → **Absorb chain LoRAs**. Walks the model chain on BOTH sides of
this node — upstream through the `model` input, downstream from the `model`
output — and for every loader it recognizes (core `LoraLoader` and
`LoraLoaderModelOnly`, rgthree Power Lora Loader and Lora Loader Stack, JPS
Lora Loader, `PixaromaLoraLoader`, another AusBoss LoRA Loader; Reroutes are
walked through) lifts its rows into this stack in application order:
upstream loaders, your existing rows, then downstream loaders. The original
loaders are set to **bypass** only when their connections can be preserved.
Repeated filenames remain separate rows, with their own strengths and
toggles.

Details that keep the absorb faithful:

- the walk follows connections, not canvas position, and stops at unknown
  nodes and downstream forks
- JPS rows switched off stay disabled; an rgthree Lora Loader Stack strength
  applies to both model and CLIP
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
node, and for LoRA Loaders you add later in this browser; nodes already saved
in a workflow keep their own setting. With it off, a missing row then warns once in the console and is skipped while the
rest of the stack applies, which suits a person at the canvas who wants to
see the rest of the picture. In API graphs the same switch is the
`on_missing` input (`"error"`, the default, or `"skip"`); graphs saved before
the input existed get the default.

A file that is there but is not a LoRA also stops the run before anything
loads, and the error names the file and says what it is: a Draw Things
file (Draw Things turns a LoRA into its own kind of file when you import
it, and ComfyUI cannot open that kind), a web page saved by a download
that needed a login, or a download that never finished. Pick the original
`.safetensors` file in that row. A file that fails later, while it is
being opened, gets the same plain message with the loader's own error at
the end.

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
(the **Fetch Civitai info** button in the card saves one; other Civitai
tools write the same file), and words you add yourself (remembered per LoRA
across workflows). Click a word to toggle it into the row; enabled rows'
selected words are joined into the `triggers` output, deduplicated, in
row order. Picking a different file for a row clears the words you had
switched on for the old one.

## Civitai info and suggested strength

- **Fetch Civitai info** looks this one LoRA up on civitai.com. Nothing is
  sent until you click. Your browser then sends only the file's SHA256
  fingerprint, and the answer is saved next to the LoRA as
  `<model>.civitai.info`. After that the button reads **Refresh Civitai
  info** and the card gets a **View on Civitai** link. A LoRA Civitai does
  not know (unpublished or hidden) reads **Not found on Civitai**. Gear
  menu → **Civitai lookup button** removes the button.
- **Suggested strength**: a lowest and a highest value at the bottom of the
  card (leave one empty for "any"). It is only a reminder: a row set outside
  it shows its number in orange, and the tooltip gives the range. Saved per
  LoRA, for every workflow.

## Other gear options

- **Default strength** (starts at 1): the strength a newly added LoRA gets.
- **Strength step** (starts at 0.05): how far one drag step or arrow click
  moves a strength. Shift always steps by 0.01.
- **Trigger word separator** (a comma and a space to start): what joins the
  `triggers` output.
- **Hide file extension** and **Hide folder names** (both on): how names
  show on rows. The full path stays in the tooltip.

## Outputs

- **model**: The model with every enabled LoRA applied in row order.
- **clip**: The CLIP with every enabled LoRA applied (empty when no CLIP
  is connected).
- **triggers**: The selected trigger words from enabled rows, deduplicated,
  joined with the gear menu's separator (a comma by default).

Rows with a strength of `0` (both model and CLIP) are skipped at load time
but still contribute their trigger words, so you can park a LoRA at zero
while comparing. A row skipped because its file is missing contributes none:
that LoRA is not in the picture.
