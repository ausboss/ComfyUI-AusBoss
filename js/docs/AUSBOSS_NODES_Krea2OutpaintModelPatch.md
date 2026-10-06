# Krea 2 Outpaint Model Patch

Tells Krea 2 **where** a reference image sits on the canvas. Use it when you
extend a picture with Krea 2 (outpainting), so the model carries your picture
on instead of painting something that only looks similar.

Place it **after** any LoRA loader and **before** the sampler.

How it works: a reference normally reaches the model with no position, so
the model treats it as a loose style hint. It borrows the look and reinvents
the content. This patch pins the reference to the rectangle the stitcher
reports.

## Controls

The node's card shows **Reference** (`source rect` / `whole canvas`) and
**KV cache** (`every step` / `once per run`). Both accept links and retain
their saved values when the workflow is reloaded.

- **model**: A Krea 2 model. Patch last, so a LoRA loaded afterwards does not
  replace the patched forward pass.
- **stitcher**: From Load Image + Pad 🆎 or a Crop + Rotate + Pad 🆎 node.
  It tells the patch where your picture sits on the canvas. With
  a stitcher from Crop For Inpaint 🆎, set **Reference** to `whole canvas`:
  on `source rect` the reference is pinned to where the crop sat in the
  full picture, not spread over the crop.
- **KV cache** (`kv_cache`, `once per run` by default): Compute the
  reference's keys and values once per run instead of once per step. The
  reference does not change while sampling, so this is free speed. Set it to
  `every step` only to rule the cache out when debugging.
- **Reference** (`placement`): Where the reference tokens go. `source rect`
  (`source rectangle`, the default) pins them to the rectangle the stitcher
  reports. `whole canvas` spreads them over the full frame. Which one is
  right depends on the LoRA — see below.

## Output

- **model**: The model with reference tokens registered into the canvas grid.

## Two LoRAs, two placements

The base Krea 2 weights were never trained on registered references; what
makes this patch work is a LoRA trained for it, and the two that exist want
different placements.

**Every side at once — `whole canvas` + AnyPaint.** yijunwang2's
[Krea 2 AnyPaint](https://huggingface.co/yijunwang2/krea2-anypaint)
(`krea2_anypaint_rank32.safetensors`) was trained with the padded canvas
itself as the reference, spread over the whole frame, and the known pixels
held in place by the sampler. In its training the new area of that reference
was always a flat patch of the picture's own median colour. Wire it like the
*Krea 2 Outpaint* example:

- A pad node with any padding you like: Image Crop + Rotate + Pad 🆎, as in
  the example, or Load Image + Pad 🆎. Left, right, top and bottom together
  are fine. Flat colour fill.
- Krea 2 Encode 🆎 with the pad node's **image** output (the padded canvas,
  not Load Image + Pad's unpadded *reference* output) as the reference,
  `vlm_reference` **on**, and the pad node's **mask** wired into its `mask`
  input. The mask makes the encode refill the new area with the picture's
  median colour, as in training. Without it a dark or very colourful picture
  can come back with the gray padding painted in as a gray frame.
- This patch on `whole canvas`.
- VAE Encode the padded canvas, Set Latent Noise Mask with the pad mask, and
  sample from that latent at full denoise. The mask is what keeps the source
  pixels; the reference is what tells the model what they are.

To repaint part of a picture instead of extending it, use the *Krea 2
Inpaint Masked* example: Crop For Inpaint 🆎 cuts out the area you painted,
and this patch runs on `whole canvas` with the same LoRA. Load Image + Pad 🆎
itself does not take a painted mask.

**One axis per pass — `source rectangle` + Registered Outpaint.** The same
author's [Registered Outpaint](https://huggingface.co/yijunwang2/krea2-outpaint)
(`krea2_outpaint_rank32.safetensors`) is the LoRA this placement was built
for: the *unpadded* source goes in as the reference (Load Image + Pad 🆎's
`reference` output, **VLM reference** off) and is pinned to its rectangle. It
was trained on a source spanning one whole canvas axis — pad left/right and
the source must span the full height, pad top/bottom and it must span the
full width. Padding both axes in one pass is outside its training and the
new region can break up; the node says so in the console when it sees it,
and the cure is two passes: pad one axis, run, load the result, pad the
other. **A thin strip counts.** On the Crop + Rotate + Pad nodes,
**Divisible by** adds a few pixels of fill on the right and bottom; more
than 8 px on the side you did not pad means the source no longer spans it.
Load Image + Pad's **Multiple** never adds a strip there. The warning
reports the spare pixels on each axis.

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
- Reference tokens cost attention. The reference is shrunk so its longest
  side is 384 px before encoding for that reason — see Krea 2 Encode 🆎.
