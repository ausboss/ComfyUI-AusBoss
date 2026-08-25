# LoRA Loader

Applies a whole stack of LoRAs to a model (and optionally CLIP) from one
compact node. Each row is one LoRA: an on/off pill, a searchable picker, and
strengths you can drag like a slider. Trigger words from every enabled row
come out of one socket, ready to wire into a prompt.

## Rows

- **toggle**: Enable or disable the row without losing its settings.
- **name**: Opens the picker. Type to search, use **Arrow Up/Down** to
  highlight, **Enter** to select, **Escape** to close. The list is refreshed
  from `models/loras` every time it opens.
- **strength**: Drag left/right on the number to scrub it, click to type an
  exact value, or use the arrow keys. Hold **Shift** while scrubbing or
  stepping for fine 0.01 moves. Range is -10 to 10.
- **i**: Preview image, base model, and trigger words for that LoRA.

Right-click a row to move, duplicate, or remove it. The **linked** button in
the footer controls whether one strength drives both model and CLIP or the
row shows a separate CLIP strength.

## Trigger words

The info card gathers words from three places: the LoRA file's own metadata,
Civitai (one click to fetch, saved beside the LoRA as the standard
`<model>.civitai.info` sidecar), and words you add yourself (remembered per
LoRA across workflows). Click a word to toggle it into the row; enabled rows'
selected words are joined into the `trigger_words` output, deduplicated, in
row order.

## Outputs

- **model**: The model with every enabled LoRA applied in row order.
- **clip**: The CLIP with every enabled LoRA applied (unchanged when no CLIP
  is connected).
- **trigger_words**: Comma-joined selected trigger words from enabled rows.

Rows with a strength of `0` (both model and CLIP) are skipped at load time
but still contribute their trigger words, so you can park a LoRA at zero
while comparing.
