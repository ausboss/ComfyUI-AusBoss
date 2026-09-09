# Krea 2 Outpaint Model Patch

Tells Krea 2 **where** a reference image sits on the canvas.

Reference latents normally arrive as extra tokens with no position, so the
model treats them as a loose style hint — it borrows the look and reinvents
the content. This patch registers those tokens into the target grid at the
rectangle the stitcher reports, which is what makes an outpaint continue the
source rather than paint something adjacent to it.

Place it **after** any LoRA loader and **before** the sampler.

## Controls

The node's card shows **Reference** (`source rect` / `whole canvas`) and
**KV cache** (`every step` / `once per run`). Both accept links and retain
their saved values when the workflow is reloaded.

- **model**: A Krea 2 model. Patch last, so a LoRA loaded afterwards does not
  replace the patched forward pass.
- **stitcher**: From Load Image + Pad 🆎. Supplies the source rectangle. A
  stitcher that carries no rectangle — one from Crop For Inpaint, or an older
  saved graph — places the reference over the full frame, which is what an
  unpatched model already assumes.
- **kv_cache**: Compute the reference's keys and values once per run instead
  of once per step. The reference does not change while sampling, so this is
  free speed. Turn it off only to rule the cache out when debugging.
- **placement**: Where the reference tokens go. `source rectangle` (default)
  pins them to the rectangle the stitcher reports. `whole canvas` spreads
  them over the full frame. Which one is right depends on the LoRA — see
  below.

## Output

- **MODEL**: The model with reference tokens registered into the canvas grid.

## Two LoRAs, two placements

The base Krea 2 weights were never trained on registered references; what
makes this patch work is a LoRA trained for it, and the two that exist want
different placements.

**Every side at once — `whole canvas` + AnyPaint.** yijunwang2's
[Krea 2 AnyPaint](https://huggingface.co/yijunwang2/krea2-anypaint)
(`krea2_anypaint_rank32.safetensors`) was trained with the grey-padded canvas
itself as the reference, spread over the whole frame, and the known pixels
held in place by the sampler. Wire it like the *Krea 2 Outpaint* example:

- Load Image + Pad 🆎 with any padding you like — left, right, top and
  bottom together are fine. Flat colour fill.
- Krea 2 Encode 🆎 with the pad node's **image** output (the padded canvas,
  not the unpadded *reference* output) as the reference, and `vlm_reference`
  **on**.
- This patch on `whole canvas`.
- VAE Encode the padded canvas, Set Latent Noise Mask with the pad mask, and
  sample from that latent at full denoise. The mask is what keeps the source
  pixels; the reference is what tells the model what they are.

Any white mask pixel is *generate*, so the same wiring inpaints: paint over
something in the mask editor and pad at the same time.

**One axis per pass — `source rectangle` + Registered Outpaint.** The same
author's [Registered Outpaint](https://huggingface.co/yijunwang2/krea2-outpaint)
(`krea2_outpaint_rank32.safetensors`) is the LoRA this placement was built
for: the *unpadded* source goes in as the reference (the pad node's
`reference` output, `vlm_reference` off) and is pinned to its rectangle. It
was trained on a source spanning one whole canvas axis — pad left/right and
the source must span the full height, pad top/bottom and it must span the
full width. Padding both axes in one pass is outside its training and the
new region can break up; the node says so in the console when it sees it,
and the cure is two passes: pad one axis, run, load the result, pad the
other. **A rounding sliver counts**: if `canvas_multiple` rounds the other
axis up by 11 px the source no longer spans it. The warning reports the
spare pixels on each axis.

Without either LoRA the patch still places the reference, but the bare
Turbo model treats it loosely and results are hit and miss.

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
