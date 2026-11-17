# Edit Lock Restore

Puts your picture's own pixels back in every part the edit did not change,
and takes out the faint pink tint some edit models add to the whole picture.

**Edit Lock 🆎** keeps the untouched parts in place while the picture is
made. They still pass through the VAE, which softens fine detail a little.
This node swaps your original pixels in for those parts, so they match
your picture pixel for pixel. Only the edit is new.

## Quick start

1. Add it right after the VAE Decode, before any upscaler.
2. Wire the decoded picture into `image`.
3. Wire the `edit_lock` output of Edit Lock 🆎 into `edit_lock`.
4. Wire `report` into **Show Text 🆎** to read what was kept.

## Controls

- **image**: the edited picture, straight from the VAE Decode.
- **edit_lock**: from Edit Lock 🆎. It carries your original picture and
  the map of what the edit changed, so there is nothing else to wire.
- **Feather** (`feather`): how softly your original fades into the edit,
  in pixels. 16 is the default. The fade lies outside the edit, so the
  edit itself is never mixed with the old picture.
- **Remove tint** (`remove_tint`): on by default. MiniMax H3 Image makes
  every edit a little pinker and lighter all over. This reads that tint
  from the part of the picture the edit left alone and takes it out of the
  whole picture, the edit included. It matters most when Edit Lock stepped
  aside, such as for a new hair color, a new background or rain, because
  then nothing else removes it. Edits meant to recolor everything (golden
  hour, red light, a new art style) are left alone. Turn it off if a color
  change you asked for comes out weaker.

## Outputs

- **image**: the edit, with your original pixels in the untouched parts.
- **edit_mask**: white where the edit changed the picture. Use it to see
  what the lock decided, or for a later step that should only touch the
  edit.
- **report**: one line, such as "Edit Lock kept 82% of your picture as it
  was and left 18% to the edit". When the tint was taken out it adds a
  sentence that says so.

## When nothing was locked

Your original pixels are not pasted back, the mask is all white, and the
report says why: the edit changed the whole picture, the lock was off, or
the picture and the result were different sizes. Remove tint still works
here, so the picture can come out with the tint taken out.

## Technical details

The map of what changed is made while sampling, on the latent grid. Here
it is enlarged to the picture's size, widened by the feather and blurred
by the same amount, and used to blend the decoded picture with your
original. If the decoded picture is not the size of your original (after
an upscale), the original is resized to fit first, which costs it some
sharpness. That is why this node goes before an upscaler.

**Remove tint.** The edit is lined up with your original (edits often come
back about one percent larger or a little shifted), both are averaged
into coarse cells of about 8 px at 1 megapixel, and their difference is
taken in Lab color. The tint is the even shift most cells share: it starts
at the median and keeps only cells within 4 Lab units of it, five times
over, so a new background or new hair drops out of the count. It is taken
out only when it looks like the model's own tint: a between +0.5 and +10,
b between -8 and 0, L between -1 and +6, read on at least 15% of the
picture. On 21 test edits at 16 megapixels it took out the tint on the 5
it should (a +2.6 to +6.5 down to +0.4 or less) and left the other 16
alone, golden hour, red light and an anime restyle included. It cannot
tell this tint from an edit that asks for a slightly pinker, lighter look
over the whole picture; turn it off for one of those.
