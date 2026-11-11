# Edit Lock

Keeps every part of your picture that an edit did not change exactly where
it was, with the colors it had.

An edit model redraws the whole picture, also the parts you did not ask it
to change. Those parts often come back a little zoomed in, shifted or
tinted. Flip between the original and the edit and the whole picture
jumps. Edit Lock stops that: only the edit is new.

It needs no mask. It sees what the edit changes while the picture is being
made, and holds on to everything else.

## Quick start

1. Put **Edit Lock 🆎** between the model and the sampler: the model (after
   any LoRA loader) goes in, and its `model` output goes to the sampler or
   guider.
2. Wire the VAE into `vae` and the picture you are editing into `image`.
   Use the same picture the edit model gets, at the size of the result.
3. After the VAE Decode, add **Edit Lock Restore 🆎**. Wire the decoded
   picture into `image` and Edit Lock's `edit_lock` output into
   `edit_lock`. This puts your own pixels back in the untouched parts.
4. Wire Restore's `report` into **Show Text 🆎** to read how much was kept.

Run your edit as usual. Prompt, steps and seed stay as they were.

## What it does with each kind of edit

- **A local edit** (add glasses, repaint the car, change the sign): the
  edit happens, and the rest of the picture stays put.
- **An edit of the whole picture** (a new style, new light, fog):
  there is nothing to keep, so Edit Lock steps aside and the edit runs as
  if the node were not there. The report says so.
- **A soft effect over the whole picture** (rain, falling snow, drifting
  smoke): the lock holds it back. It looks like a small local edit while
  the picture is being made, so the node keeps nearly everything and the
  effect does not arrive. The report then says it kept 95% or more. Set
  **Lock** to `off` for these.
- **Something in between** (a new hair color on a close-up, a new
  background behind a person): it may lock or step aside. The report says
  which. Set **Lock** to `always` to lock anyway, or `off` if it holds
  back part of your edit. A mask settles it.
- **The model ignores your picture and draws a new one:** that reads as a
  whole-picture edit, so `auto` steps aside. `always` holds the model to
  your picture.

## Controls

- **model**: the edit model. Patch last, after any LoRAs.
- **vae**: the same VAE the workflow decodes with.
- **image**: the picture you are editing, at the size of the result. If
  the sizes differ by more than a few percent the lock does nothing, and
  the report says so.
- **Lock** (`lock`): `auto` (the default) locks the untouched parts and
  steps aside when the whole picture changes. `always` locks even then.
  `off` does nothing, which makes a quick before and after.
- **Tolerance** (`tolerance`): how big a change must be to count as part of
  the edit. 1 is the default. Raise it if small unwanted changes get
  through. Lower it if the lock holds back part of your edit.
- **mask** (optional): white marks where the edit may happen; everything
  else is locked. With a mask the node does not look for the change
  itself. A mask from **Mask by Touch 🆎** or **Mask by Name 🆎** works.

## Outputs

- **model**: the model with the lock on.
- **edit_lock**: what the lock kept, for Edit Lock Restore 🆎.

## Good to know

- The lock belongs to one picture. For an edit with two pictures, give it
  the one the result should line up with.
- It works on single pictures, not video.
- A picture is locked from the first step, so the model finishes the edit
  on top of your real picture. Shadows and reflections the edit adds next
  to the changed part still come through.
- Tested on MiniMax-H3-Image. The lock itself is not tied to one model, but
  the line between "local edit" and "whole picture" was measured there.

## Technical details

At every step an edit model predicts the finished picture. Edit Lock
compares that prediction with your picture in latent space. Where the two
sit close, the edit is not happening there, and the original latent is put
back before the sampler takes its next step. Where they differ, the
model's prediction is left alone. A part that was once read as changed
stays changed for the rest of the run.

"Close" is measured against the quiet part of the picture: the tenth where
the prediction differs least at the first step. A spot counts as changed
when it differs by 3 times that level, or by 2 times while it touches a
spot that does. So a faint change beside a clear one belongs to the edit,
and a faint change alone is redraw noise. **Tolerance** multiplies both
numbers.

Two things are not counted as change. An even tint over the whole picture
is taken out first, so a color cast is removed with the rest. And the
model often draws the whole picture about one percent larger, or a little
shifted. The node measures that zoom and shift at every step, on the
calmer half of the picture, and compares the prediction with the original
laid over it the same way. Without this a larger redraw reads as a change
along every edge in the picture. What is put back is the original as it
was, not the zoomed copy.

At the first step the node also checks whether the whole picture is
changing. It reads the calmest fifth of a smoothed copy, where a slightly
larger redraw nearly vanishes and a new style or new light does not. On
MiniMax-H3-Image, local edits at 1, 4 and 16 megapixels read 0.22 or less
there and whole-picture edits 0.27 or more; the line sits at 0.243. An
edit close to that line (a hair color change on a close-up, a new
background) can fall on either side. The report says which, and **Lock**
overrides it.

This is the target the TailSteer paper trains a model toward (the source
where nothing changed, the model's own edit elsewhere), applied while
sampling. It needs no LoRA and no training.
