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
- **A soft effect over the whole picture** (rain, falling snow, haze):
  it touches everything a little, so there is no untouched part to put
  back. Edit Lock lets the effect through and only holds the picture in
  place, so it does not come back zoomed or shifted. The report says so.
- **Something in between** (a new hair color on a close-up, a new
  background behind a person): it may lock or step aside. The report says
  which. These edits often change the light on the face too. `auto` steps
  aside for most of them, so the new light comes with the new hair.
  `always` keeps the old light on everything it keeps, which can look
  wrong on a face. A mask settles it: paint the hair and the face, and
  the rest is locked.
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
- The node watches the first steps of a run and locks for the rest, so
  the model finishes the edit on top of your real picture. Shadows and
  reflections the edit adds next to the changed part still come through.
- If your edit is missing and the report says nearly all of the picture
  was kept, set **Lock** to `off`.
- Tested on MiniMax-H3-Image. The lock itself is not tied to one model, but
  the line between "local edit" and "whole picture" was measured there.

## Technical details

At every step an edit model predicts the finished picture. Edit Lock
compares that prediction with your picture in latent space.

**Watching.** The first prediction of a run is a blur, and rain, snow or
the light a new hair color throws on a face only show a few steps in. So
the node watches until the noise is down to 0.8 of where it began: step 4
of a 6-step MiniMax-H3-Image run. A run that never gets that low decides
at its last step. While it watches, the model draws its own picture and
only one thing is corrected. The model often draws the whole picture about
one percent larger, or a little shifted. The node measures that zoom and
shift at every step, on the calmer half of the picture, and moves the
prediction back so it sits where your picture does.

**Deciding.** Change is measured against the quiet part of the picture:
the tenth where the prediction differs least. An even tint over the whole
picture is taken out first, so a color cast is not read as a change. A
spot counts as changed when it differs by 3 times the quiet level, or by 2
times while it touches a spot that does. So a faint change beside a clear
one belongs to the edit, and a faint change alone is redraw noise.
**Tolerance** multiplies both numbers.

**Locking.** From the decision on, wherever the picture did not change,
the original latent is put back before the sampler takes its next step. A
part once read as changed stays changed for the rest of the run. The last
step ends on the original there, so what was kept is the original itself,
not a redrawn copy.

**Stepping aside.** `auto` does not lock in three cases:

- At the first step the whole picture is already changing (a new style,
  new light). The node reads the calmest fifth of a smoothed copy, where a
  slightly larger redraw nearly vanishes and a new style does not. On
  MiniMax-H3-Image, local edits at 1, 4 and 16 megapixels read 0.22 or
  less there and whole-picture edits 0.27 or more; the line sits at 0.243.
  The model then runs untouched.
- At the decision no place has changed clearly: the strongest spot of the
  picture is under 4 times the quiet level. That is light rain or fog.
  Local edits read 4.7 or more there, glasses and makeup included.
- At the decision the lock would hand a tenth of the picture or more to
  the edit, yet the strongest hundredth of the picture is under 4 times
  the quiet level. That is heavier rain or snow, and a lock would let it
  through in patches. Local edits that wide read 4.4 or more; rain and
  snow read 3.6 or less.

In the last two cases the node keeps undoing the zoom and shift to the end
of the run, and puts nothing back. An edit close to one of these lines (a
hair color change on a close-up, a new background, smoke) can fall on
either side. The report says which, and **Lock** overrides it.

This is the target the TailSteer paper trains a model toward (the source
where nothing changed, the model's own edit elsewhere), applied while
sampling. It needs no LoRA and no training.
