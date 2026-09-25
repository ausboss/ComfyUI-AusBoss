# Seed

One seed on its own `INT` wire, so every sampler that should share it does,
and a shared workflow can pin the exact seed that made its example image.
The card is the whole face: the number, the mode, and the buttons a run
needs.

## The card

- **The number** — click to type a seed; **⧉** copies it. In Random mode
  the tag reads *next*: that is the seed the next queue will use.
- **Random / Fixed / Step +1** — what happens after each queue. Random
  rolls a new seed, Fixed keeps it, Step +1 increments it (click it again
  for **Step −1**, which decrements). This is the sampler's own *control
  after generate*, just readable. Switching to Random also rolls a new
  seed right away, and switching from Fixed to Step takes the first step,
  so the next queue never repeats the run you just saw (ComfyUI would
  hand back its cached result).
- **New seed** — rolls a fresh seed and pins it (Fixed), so the following
  runs all use it.
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
- Link a value into the **seed** row and the box goes read-only: the wire
  owns it.
