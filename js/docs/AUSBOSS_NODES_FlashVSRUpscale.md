# FlashVSR Upscale

Makes a video larger and sharper. Give it the frames of a clip, set how much
larger, and it returns the same clip with more detail. Use it as the last
step before Save Video, for a generated clip or one you loaded.

It needs one model file and no other pack.

## The model file

Download `flashvsr_v1.1_fp16.safetensors` (3.5 GB) from
[ausboss/FlashVSR-v1.1-ComfyUI](https://huggingface.co/ausboss/FlashVSR-v1.1-ComfyUI)
and put it in `ComfyUI/models/diffusion_models`. Then refresh the page, or
press `R`, and pick it under **Model**.

The file holds the official FlashVSR v1.1 weights in one piece. Another
FlashVSR file will not load here: the node stops and says which part is
missing.

## Controls

- **frames**: The clip, as a batch of frames. Load Video's frames output
  goes here.
- **Model** (`model`): The model file above. The list shows the files in
  `diffusion_models` that have FlashVSR in their name.
- **Scale** (`scale`, starts at `2`): How many times larger each side gets,
  from 1 to 4. At `1` the clip keeps its size and is only sharpened.
- **Keep colors** (`color_match`, starts on): Brings each frame's colours
  back to those of your clip. Leave it on unless you want the model's own
  colours.
- **vae** (optional): Connect the Wan 2.1 VAE for a slower, finer finish.
  With nothing connected, the fast decoder inside the model file makes the
  picture.

## Outputs

- **frames**: The larger frames, as many as went in, in the same order.
  The frame rate and the sound are not touched, so wire those from Load
  Video to Save Video as before.

## What to expect

FlashVSR redraws fine detail: skin, hair, cloth and edges come back
sharper than the clip had them. It keeps the scene, the motion and the
timing.

A long clip needs no more graphics memory than a short one. The node reads
the clip a few frames at a time and keeps only the last few in memory.

## Technical details

- **Size.** The result is exactly your size times **Scale**, rounded to
  even numbers. Inside, the model works at a multiple of 128 pixels each
  way; the node pads the picture for that and cuts the padding off again,
  so nothing of your picture is cropped.
- **Graphics memory.** About 10 GB for a 576 x 1024 result. A result too
  large for the free memory is made in overlapping tiles and blended, and
  the tile size is chosen from the memory that is free when the node runs.
  1152 x 2048 ran in two tiles at about 16 GB. On an 8 GB card (RTX 3070
  Laptop) the same result ran in smaller tiles at about 6.5 GB, at about 3
  seconds a frame.
- **Speed.** On an RTX 5090: about 7 frames a second for a 576 x 1024
  result and about 2 frames a second for 1152 x 2048.
- **One step.** The model runs once per group of frames. There are no
  steps, sampler, prompt or seed to set.
- **The model.** FlashVSR v1.1 by Junhao Zhuang and the OpenImagingLab
  team, released under Apache-2.0. It is built on the Wan 2.1 1.3B video
  model. This node is the pack's own code in plain PyTorch.
- The node makes no network requests and writes no files.
