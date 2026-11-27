# Step Preview

Shows the picture while it is being made, one step at a time, with a
**Stop** button. If the picture is going wrong (the pose, the framing, an
extra arm) you can see it after the first few steps and stop the run,
instead of waiting for the last step.

Put it anywhere on the canvas. It needs no wires: it shows whichever sampler
in the workflow is making a picture right now, and the caption under the
picture says how far it is ("step 3 of 8").

For a video, the picture moves: after each step a few frames of the clip,
about one per second, play in a loop, so you can see the motion form and
stop a clip that is going wrong.

## The buttons

- **STOP**: stops this run now. Nothing after the sampler runs, so nothing
  is saved. The next run in the queue still starts.
- **STOP ALL · N**: shows when more runs are waiting in the queue. It
  empties the queue and stops this run.

As soon as the run saves the picture, the finished picture replaces the
blurry last step, and it stays on the node until the next run starts. The
word at the right of the bar says how the run ended: done, stopped or
failed. A stopped run keeps the last step it reached.

An upscale in tiles works on one small piece of the picture at a time.
Those pieces are not shown as the picture: the node keeps the last whole
picture and says "upscaling in tiles", with the steps of the piece being
worked on.

## Save Image and Save Video can do it too

Save Image 🆎 and Save Video 🆎 have a **steps** switch of their own (off by
default). On, the picture area of the save node shows the steps of the
picture it is about to save, with the same Stop button. Use the save node's
switch when you look at the result anyway, and this node when you want a
bigger view, or one view for a workflow with several samplers.

## Sharper step pictures

The step pictures are small and blurry. That is enough to judge the pose
and the layout. Some models have a small preview decoder (a TAESD file)
that makes them sharper: put it in ComfyUI's `models/vae_approx` folder and
ComfyUI uses it.

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
- They cost next to nothing. Measured with Qwen Image 2.1 on one desktop:
  8.50 s with the steps off and 8.40 s on for 8 steps, 17.62 s and 17.64 s
  for 25 steps, the same picture every time.
- While previews are on, a ComfyUI sampler that sits on the top level of
  the workflow (not inside a box) shows the steps on its own face too, as
  it does whenever previews are turned on in ComfyUI. The node grows to
  hold the picture and keeps the last step after the run.
- Runs queued from another workflow tab are not shown here.
- With a video model (H3, Wan, LTX and others), the step picture moves:
  after each step the pack also sends about one frame per second of the
  clip (16 at most), and they play in a loop at the clip's own pace. Each
  frame is made by the same preview ComfyUI uses for the first frame, one
  frame at a time, so it needs no extra memory and no extra files.
- Measured with MiniMax H3 (Pika, 6 steps, a 5 second clip) on one
  desktop: 6.22 s a step with no step pictures, 6.35 s with the moving
  ones; 53.6 s and 53.8 s for the whole run. With the quick preview the 7
  frames of a step take about 1 ms to make, and each step sends about 20 KB.
- With the tiny video decoder (TAESD chosen and `taeh3` in
  `models/vae_approx`) the frames are sharper and take longer, about 60 ms
  each at 720p on that desktop. The frames never take more than a tenth of
  the run's time: on a slower card some steps keep the frames they have
  instead of making new ones.
