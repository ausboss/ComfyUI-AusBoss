# Frame Chooser

Pauses the running graph and turns the node into a clickable filmstrip of every
incoming frame. Pick the frames to keep, press **Keep selected**, and the graph
resumes with just those frames — always in their original order.

## Controls

- **frames**: A BHWC image batch, commonly the frame output of a video loader.
- **behavior**: `always pause` stops every run until you answer. `keep last
  selection` re-applies this node's previous answer immediately and only pauses
  when no previous answer fits the current batch.
- **preview_max_size**: Longest edge of the filmstrip thumbnails. Smaller
  values encode and load faster; the full-resolution frames are untouched.
- **timeout_seconds**: How long a pause waits before **on_timeout** answers
  for you. `0` waits forever. While armed, the panel header counts down the
  seconds left.
- **on_timeout**: What an expired countdown does — `keep all`, `keep first`,
  `keep last`, or `cancel` (interrupts the run like the stop button). Ignored
  while **timeout_seconds** is `0`.

## While paused

- Click thumbnails to toggle them; the header counts the selection, and
  **ALL** / **NONE** flip the whole filmstrip at once.
- **Keep selected** resumes with the chosen frames. **Keep all** resumes with
  every frame — an empty selection deliberately means keep-all, so a quick
  "just continue" can never produce an empty batch.
- **Cancel** (or Escape while the panel is focused) interrupts the run exactly
  like ComfyUI's stop button. Interrupting the queue also releases the pause.
- Reloading the page does not lose the pause: when the graph finishes
  loading, the panel re-fetches every still-waiting chooser from the server
  and re-renders its filmstrip (countdown included).

## Outputs

- **frames**: The kept frames as a BHWC batch, in source order.
- **count**: How many frames were kept.
- **indices**: The kept one-based indices, comma-joined (`1,4,9`).

Thumbnails are written to ComfyUI's temp folder and disappear with its normal
cleanup; answers travel over a local `/ausboss/frame_chooser` route. The last
selection is remembered per node id for the current server session only.
