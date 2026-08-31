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
- **name**: Opens the picker. Type to search, use **Arrow Up/Down** to
  highlight, **Enter** to select, **Escape** to close. The list is refreshed
  from `models/loras` every time it opens.
- **strength**: Drag left/right on the number to scrub it, click to type an
  exact value, or use the arrow keys. Hold **Shift** while scrubbing or
  stepping for fine 0.01 moves. Range is -10 to 10.
- **i**: Info card with the preview image, base model, file size and
  modified date, and trigger words for that LoRA.

Right-click a row to move, duplicate, or remove it. Whether one strength
drives both model and CLIP or the row shows a separate CLIP strength is the
gear menu's **Separate model / CLIP strength** switch — stored on the node
itself, so each node keeps its own mode across save and load. Stacks saved
with a single strength load as equal model/CLIP values.

## Preview thumbnails

Hovering a row's name — or any entry in the picker — floats a small preview
beside the cursor when a sidecar image sits next to the LoRA file (same
basename: `.preview.png` / `.preview.jpg` / `.preview.jpeg` / `.preview.webp`,
or the bare `.png` / `.jpg` / `.jpeg` / `.webp`). No sidecar, no thumbnail —
nothing appears and nothing shifts. The gear menu's **Preview thumbnails**
switch turns the behavior off.

## Trigger words

The info card gathers words from three places: the LoRA file's own metadata,
Civitai (one click to fetch, saved beside the LoRA as the standard
`<model>.civitai.info` sidecar), and words you add yourself (remembered per
LoRA across workflows). Click a word to toggle it into the row; enabled rows'
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
