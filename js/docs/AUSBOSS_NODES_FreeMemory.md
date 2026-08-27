# Free Memory

Passes any wire through unchanged and, on the way, releases what can be
released: comfy's cached models are unloaded, Python garbage is collected,
and the CUDA allocator cache is emptied. Put it between a heavy stage and
the next — after a video decode, before an upscale — so the second stage
starts with free VRAM instead of an out-of-memory error.

## Controls

- **value**: Any wire — the node's input and output are wildcard-typed, so
  it splices into an `IMAGE`, `LATENT`, `MODEL`, or any other connection
  without adapters.

## Output

- **value**: The input, passed through unchanged.

## Behavior

- Every release step is best-effort. If ComfyUI moves or renames one of the
  APIs involved, that step is skipped and the wire still flows; the node
  never becomes the reason a workflow fails. What was actually freed is
  printed to the console each run.
- The comfy imports happen when the node runs, not when the pack loads, so a
  core change surfaces as a skipped step rather than deleting the node from
  the menu.
- Like any node, it only runs when its input changes — it does not force
  re-execution, so inserting it never breaks ComfyUI's caching downstream.
  Freeing happens on the runs where work actually flows through.
- Models unloaded here are reloaded by the next node that needs them; that
  reload costs time, which is the trade for the freed VRAM.
