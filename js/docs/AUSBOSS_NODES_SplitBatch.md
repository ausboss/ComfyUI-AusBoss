# Split Batch

Splits an `IMAGE` batch in two after a one-based frame index — send a clip's
halves to different treatments, or peel leading frames off a batch.

## Controls

- **images**: The BHWC batch to split.
- **index**: The one-based split point: frames 1 through `index` come out as
  **a**, the rest as **b**.

## Outputs

- **a**: Frames 1 through `index`.
- **b**: The remaining frames.

Both sides must keep at least one frame — a zero-frame `IMAGE` batch is
invalid on any wire — so `index` must stay between 1 and one less than the
batch size; anything else stops with the valid range. To put the halves back
together afterwards, use **Merge Batches 🆎**.
