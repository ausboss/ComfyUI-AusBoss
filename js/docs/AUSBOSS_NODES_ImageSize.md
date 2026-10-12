# Image Size

Reads an image's dimensions and hands them out as INTs: **width**,
**height**, **longest_edge**, **shortest_edge**, and **count**.

Wire them wherever a workflow wants numbers that must match the actual
image — an Empty Latent sized to the source, a resize keyed off the longest
edge, aspect-aware math with the shortest. Because the values come off the
wire, they can never drift out of date the way retyped numbers do.

After a run the node shows each number beside its output, such as
`width: 1024`, so you can read the size without wiring anything to it.

## Outputs

- **width** / **height**: The frame size in pixels.
- **longest_edge**: `max(width, height)` — the number resize-to-fit logic
  keys on.
- **shortest_edge**: `min(width, height)` — the number crop-to-fill and
  many preprocessing pipelines key on.
- **count**: The number of images in the batch — `1` for a single image,
  the frame count for video frames.

## Notes

A batch reports the size its frames share (IMAGE batches are uniform by
construction). The node does no work worth caching or canceling — it reads
its numbers off the tensor's shape.

The numbers beside the outputs are from the last run. They are saved with
the workflow, so a workflow you open again shows them, and they are cleared
when you wire in another picture. If the node measured a list of batches in
one run, it shows no numbers, since no one number is true for all of them.
