# Krea 2 Encode

Encodes a Krea 2 prompt pair and attaches reference latents, in one node.

Wire a VAE and a reference image and the reference is encoded and appended to
the positive conditioning. Leave them unwired and this is a plain two-prompt
encoder. The negative comes out of the same node, so a turbo graph running at
CFG 1.0 still has something to plug in without a second text encode sitting
there doing nothing.

## Controls

- **clip**: The Krea 2 text encoder.
- **prompt**: Describe the whole finished canvas, not just the new area — the
  model generates all of it and matches the reference where it must.
- **negative_prompt**: Ignored at CFG 1.0, which is where turbo runs. Empty is
  the normal case there.
- **vae**: Needed to turn the reference images into latents. Without it the
  references are skipped and only the prompts are encoded.
- **reference**: The `reference` output of Load Image + Pad 🆎 — the unpadded
  source. Any image works; it is fitted to a multiple of 16 first.
- **extra_image**: A second reference, e.g. a style or character plate.
- **vlm_reference**: Also show the references to the vision tower, so the text
  encoder describes them. Off for outpaint: the latents already carry the
  picture, and the description tends to pull the result toward a paraphrase of
  the source.

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
