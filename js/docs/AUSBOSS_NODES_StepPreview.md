# Step Preview

Shows the picture while it is being made, one step at a time, with a
**Stop** button. If the picture is going wrong (the pose, the framing, an
extra arm) you can see it after the first few steps and stop the run,
instead of waiting for the last step.

Put it anywhere on the canvas. It needs no wires: it shows whichever sampler
in the workflow is making a picture right now, and the caption under the
picture says which one and how far it is ("step 3 of 8 · Generate").

## The buttons

- **STOP**: stops this run now. Nothing after the sampler runs, so nothing
  is saved. The next run in the queue still starts.
- **STOP ALL · N**: shows when more runs are waiting in the queue. It
  empties the queue and stops this run.

After a run the last step stays on the node until the next run starts. The
word at the right of the bar says how the run ended: done, stopped or
failed.

## Save Image and Save Video can do it too

Save Image 🆎 and Save Video 🆎 have a **steps** switch of their own (off by
default). On, the picture area of the save node shows the steps of the
picture it is about to save, with the same Stop button. Use the save node's
switch when you look at the result anyway, and this node when you want a
bigger view, or one view for a workflow with several samplers.

## Sharper step pictures

The step pictures are small and rough at first, like a blurry thumbnail
that sharpens. That is enough to judge the pose and the layout. For a
cleaner picture, put the model's small preview decoder (a TAESD file) in
ComfyUI's `models/vae_approx` folder; ComfyUI uses it when it is there.

## Technical details

- ComfyUI only makes step pictures when its preview method is something
  other than `none`, and a fresh install starts with `none`. When a queued
  workflow holds this node, or a Save Image or Save Video with its steps
  switch on, the pack asks for the `auto` method for that one run.
- It never overrides a choice you made: if you picked a method in
  ComfyUI's **Live preview method** setting, or started ComfyUI with
  `--preview-method`, that one is used. `--preview-method none` on the
  command line is treated as "not chosen", since it is the default.
- `auto` uses the model's TAESD decoder from `models/vae_approx` when it is
  installed, and a quick color estimate (latent2rgb) otherwise. Some models
  have neither (SeedVR2, for one), and then no step pictures come.
- The pictures are at most 512 px on their long side (`--preview-size`).
  They do not change the result: the same seed makes the same picture with
  the steps shown or not.
- While previews are on, ComfyUI's own sampler nodes show the step picture
  on their face as well.
- Runs queued from another workflow tab are not shown here.
- With video models the step picture is the clip's first frame.
