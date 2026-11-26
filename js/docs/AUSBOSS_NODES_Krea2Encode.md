# Krea 2 Encode

The prompt node for Krea 2. Type your prompt and negative prompt here, and
optionally give it a picture for the result to follow, all in one node.

Wire a VAE and a reference image and the reference is attached to the
positive output. Leave them unwired and this is a plain two-prompt encoder.
The negative comes out of the same node, so a turbo graph running at CFG 1.0
still has something to plug in without a second text encode sitting there
doing nothing.

For an outpaint with the AnyPaint LoRA, also wire the **mask** from the node
that padded your picture. Without it, a dark or very colourful picture can
come back with the new area still gray, like a gray frame or a gray corner.

## Controls

- **clip**: The Krea 2 text encoder.
- The big text box (`prompt`): Describe the whole finished canvas, not just
  the new area — the model generates all of it and matches the reference
  where it must. The two boxes have no labels, only gray hint text.
- The small text box (`negative_prompt`): Ignored at CFG 1.0, which is where
  turbo runs. Empty is the normal case there.
- **vae**: Needed to turn the reference images into latents. Without it no
  reference is attached to the result. If **VLM reference** is on, the text
  encoder still looks at the pictures.
- **reference**: The image the result follows. For AnyPaint that is the
  padded `image` from Image Crop + Rotate + Pad 🆎 or Load Image + Pad 🆎;
  for Registered Outpaint, Load Image + Pad 🆎's unpadded `reference`
  output. Any image works; it is fitted to a multiple of 16 first.
- **extra_image**: A second reference, e.g. a style or character plate.
- **VLM reference** (`vlm_reference`, off by default): Also show the
  references to the vision tower, so the text encoder describes them. On for
  AnyPaint with the padded
  canvas as the reference; off for Registered Outpaint with the unpadded
  source, where the description tends to pull the result toward a paraphrase
  of the source. The Krea 2 Outpaint Model Patch page covers both setups.
- **mask**: The area to paint: the `mask` output of Image Crop + Rotate +
  Pad 🆎 or Load Image + Pad 🆎, or the painted mask of an inpaint. Wire it
  for AnyPaint. The reference then shows that area in your picture's own
  colour instead of the gray fill, and the model paints it.
- **reference_curve**: How strongly the picture follows the references over
  the run, from Strength Curve 🆎. 1 is the normal strength and 0 ignores
  them. Hold the layout early and let go late (a fade out), or let the
  model find its own shapes first and pull the reference in for the details
  (a fade in). Leave it unwired for today's behaviour.

## Outputs

- **positive**: Prompt conditioning with the reference latents attached.
- **negative**: Negative prompt conditioning.

## Notes and limitations

- **References are downscaled to a 384px long edge and snapped to a multiple
  of 16.** The VAE downsamples by 8 and the DiT patchifies by 2, so an edge off
  a multiple of 16 lands on a partial patch and the token grid stops lining up
  with the canvas grid. The cap is deliberate — a reference is there to say
  "this is the picture", and the canvas latent carries the detail.
- Attaching reference latents alone does not tell the model *where* they go.
  Pair this with Krea 2 Outpaint Model Patch 🆎 for outpainting.
- On a core without the Krea 2 prompt template, `vlm_reference` still works —
  it falls back to tokenizing without the template.

## Technical details: why the mask matters

AnyPaint was trained with the new area of its reference filled with the
median colour of the rest of the picture, never with a fixed gray. The
padded canvas carries a flat `#808080` gray instead. Next to a picture whose
median is close to mid-gray that makes no difference, but next to a dark or
saturated picture the model reads the gray as part of the scene and paints
it back, as a flat gray frame or corner. The mask's new area (where it is
above 0.5) is refilled with the median colour of everything else before the
reference goes to the VAE and to the vision tower. The canvas the rest of
the graph uses keeps its gray, so the prompt writer and the stitch are
unchanged. Only `reference` is refilled; `extra_image` is left as it is.

## Technical details: the reference curve

The references reach Krea 2 as extra tokens that the prompt and the canvas
attend to. At each step the curve's value `s` is added as `log(s)` to
the attention scores of the reference keys, which multiplies the attention
weight they get by `s` before the weights are shared out again. At 1
nothing changes, at 0 the reference gets no attention at all and the result
is the same as without a reference, and values in between fade it. The
reference's own tokens see the same scale. It works the same with Krea 2
Outpaint Model Patch 🆎, which scales its cached reference keys.

The curve travels on the positive output as a ComfyUI hook, read at each
step by ComfyUI's own hook keyframes (see Strength Curve 🆎 for how "where
in the run" is measured). Two costs come with ComfyUI's hooks: a run with a
hooked prompt turns dynamic VRAM loading off (the first one loads the model
a second time), and at a CFG above 1 the positive and negative are run one
after the other instead of together. While the strength is not 1, attention
also runs with a mask, which some fast attention kernels hand to PyTorch's
own.
