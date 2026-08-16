# Simple Watermark Remover (legacy)

A compatibility shim. Workflows published before this pack existed used a
node with this exact id; keeping it registered lets those workflows load and
run unchanged.

It accepts the same inputs the original did and runs the same LaMa inpaint
underneath. For anything new, use
[LaMa Inpaint (AusBoss)](AUSBOSS_NODES_LaMaInpaint.md) instead — it is the
same engine with the full set of controls, live previews, and video-batch
support.

This id will keep working; it just will not grow new features.
