# Seed

One seed on its own `INT` wire, so every sampler that should share it does,
and a shared workflow can pin the exact seed that made its example image.
The card is the whole face: the number, the mode, and the buttons a run
needs.

## The card

- **The number** — click to type a seed; **⧉** copies it. In Random mode
  the tag reads *next*: that is the seed the next queue will use.
- **Random / Fixed / Step** — what happens after each queue. Random rolls
  a new seed, Fixed keeps it, Step increments it (click Step again to
  switch to decrement). This is the sampler's own *control after generate*,
  just readable.
- **New seed** — rolls a fresh seed and pins it (Fixed), for when a random
  run landed somewhere good and you want to stay near it.
- **Use last run** — puts the seed of the most recent run back in the box
  and pins it. Random mode replaces the seed the moment a run is queued, so
  the number in the box is already the *next* one while the image is still
  rendering; this button is how you get the one that made it.
- **▾** — the last eight seeds this node ran with, newest first; pick any to
  restore it the same way.
- The line underneath shows the last run's seed. The history saves with the
  workflow.

## Output

- **seed**: The seed, unchanged.

## Notes and limitations

- The last-run seed comes from the backend's own run, so it is right even
  when the control mode is *before* rather than *after* generate, and even
  when the node's output came from the cache.
- Sampler seeds go up to 2⁶⁴−1; the box accepts that range. Seeds rolled by
  the buttons stay below 2⁵⁰, the same ceiling ComfyUI's own randomize
  uses, so the number stays exact.
- Convert **seed** to an input and the box goes read-only: the wire owns it.
