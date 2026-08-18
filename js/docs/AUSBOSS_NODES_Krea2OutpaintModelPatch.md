# Krea 2 Outpaint Model Patch

Tells Krea 2 **where** a reference image sits on the canvas.

Reference latents normally arrive as extra tokens with no position, so the
model treats them as a loose style hint — it borrows the look and reinvents
the content. This patch registers those tokens into the target grid at the
rectangle the stitcher reports, which is what makes an outpaint continue the
source rather than paint something adjacent to it.

Place it **after** any LoRA loader and **before** the sampler.

## Controls

- **model**: A Krea 2 model. Patch last, so a LoRA loaded afterwards does not
  replace the patched forward pass.
- **stitcher**: From Load Image + Pad 🆎. Supplies the source rectangle. A
  stitcher that carries no rectangle — one from Crop For Inpaint, or an older
  saved graph — places the reference over the full frame, which is what an
  unpatched model already assumes.
- **kv_cache**: Compute the reference's keys and values once per run instead
  of once per step. The reference does not change while sampling, so this is
  free speed. Turn it off only to rule the cache out when debugging.

## Output

- **MODEL**: The model with reference tokens registered into the canvas grid.

## One axis at a time

**This is the constraint that decides whether an outpaint works.** The model
places the source spanning one whole canvas axis — pad left/right and the
source must span the full height, pad top/bottom and it must span the full
width. Padding *both* axes puts the placement outside what the weights were
trained on, and the new region breaks up: hard cuts at the old edge, mangled
anatomy, a flat band where content should continue.

The node says so in the console when it sees it. To fix:

1. Pad one axis, run it, save the result.
2. Load that result and pad the other axis. Run again.

**A rounding sliver counts.** If you pad only the bottom but `canvas_multiple`
rounds the width up by 11px, the source no longer spans the width and the run
degrades exactly the same way. Either lower the multiple or pick one that
already divides that dimension — 720 wide is fine at 16, not at 32. The
warning reports the spare pixels on each axis so you can see which it is.

## Notes and limitations

- **Nothing happens without reference latents.** If the conditioning carries
  none, the patched forward pass calls straight through to the original. Wire
  Krea 2 Encode 🆎 with a VAE and a reference image.
- **It patches comfy internals.** The placement reaches into the flux
  attention layers, so a ComfyUI release that moves them can break this node
  specifically. It imports those internals when you run it rather than at
  startup, so a break surfaces as an error on this node instead of the node
  disappearing from the menu.
- Reference tokens cost attention. The reference is fitted to a short edge
  before encoding for that reason — see Krea 2 Encode 🆎.
