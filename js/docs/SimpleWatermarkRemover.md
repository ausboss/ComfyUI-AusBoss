# Simple Watermark Remover (AusBoss Compatibility)

An old node, kept so older workflows still load and run. Workflows published
before the pack's `AUSBOSS_NODES_` naming used a node with this exact id.

It accepts the same inputs the original did (**image**, **mask** and
**method**, whose one choice is `LAMA`) and runs the same LaMa inpaint
underneath, image batches and video frames included. It has no model list:
it always uses `big-lama.pt` from `ComfyUI/models/lama/`, so that file must
be there. For anything new, use
[LaMa Inpaint 🆎](AUSBOSS_NODES_LaMaInpaint.md) instead: the same engine
with the full set of controls and live previews.

This id will keep working; it just will not grow new features.
