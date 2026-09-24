# Simple Watermark Remover (legacy)

A compatibility shim. Workflows published before the pack's
`AUSBOSS_NODES_` naming used a node with this exact id; keeping it registered
lets those workflows load and run unchanged.

It accepts the same inputs the original did and runs the same LaMa inpaint
underneath, image batches and video frames included. For anything new, use
[LaMa Inpaint 🆎](AUSBOSS_NODES_LaMaInpaint.md) instead: the same engine
with the full set of controls and live previews.

This id will keep working; it just will not grow new features.
