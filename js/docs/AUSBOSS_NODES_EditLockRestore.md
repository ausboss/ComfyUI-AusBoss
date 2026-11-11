# Edit Lock Restore

Puts your picture's own pixels back in every part the edit did not change.

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

## Outputs

- **image**: the edit, with your original pixels in the untouched parts.
- **edit_mask**: white where the edit changed the picture. Use it to see
  what the lock decided, or for a later step that should only touch the
  edit.
- **report**: one line, such as "Edit Lock kept 82% of your picture as it
  was and left 18% to the edit".

## When nothing was locked

The picture passes through unchanged, the mask is all white, and the
report says why: the edit changed the whole picture, the lock was off, or
the picture and the result were different sizes.

## Technical details

The map of what changed is made while sampling, on the latent grid. Here
it is enlarged to the picture's size, widened by the feather and blurred
by the same amount, and used to blend the decoded picture with your
original. If the decoded picture is not the size of your original (after
an upscale), the original is resized to fit first, which costs it some
sharpness. That is why this node goes before an upscaler.
