# Image Size

Reads an image's dimensions and hands them out as INTs: **width**,
**height**, **longest_edge**, and **shortest_edge**.

Wire them wherever a workflow wants numbers that must match the actual
image — an Empty Latent sized to the source, a resize keyed off the longest
edge, aspect-aware math with the shortest. Because the values come off the
wire, they can never drift out of date the way retyped numbers do.

## Outputs

- **width** / **height**: The frame size in pixels.
- **longest_edge**: `max(width, height)` — the number resize-to-fit logic
  keys on.
- **shortest_edge**: `min(width, height)` — the number crop-to-fill and
  many preprocessing pipelines key on.

## Notes

A batch reports the size its frames share (IMAGE batches are uniform by
construction). The node does no work worth caching or canceling — it reads
two numbers off the tensor's shape.
