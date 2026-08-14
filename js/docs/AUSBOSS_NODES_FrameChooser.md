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
- **pick_list**: One-based frame numbers, e.g. `1,4,9` (commas or spaces).
  When filled, the node applies them immediately — no pause, no filmstrip —
  and the run can cache like any ordinary node. Answering a pause fills this
  widget automatically with the kept indices, so the next queue reproduces
  the same choice headlessly. **Clear it to make the node pause again.** A
  number outside the batch fails the run instead of guessing.

## While paused

- Click thumbnails to toggle them; the header counts the selection, and
  **ALL** / **NONE** flip the whole filmstrip at once.
- **Keep selected** resumes with the chosen frames. **Keep all** resumes with
  every frame — an empty selection deliberately means keep-all, so a quick
  "just continue" can never produce an empty batch.
- **Cancel** interrupts the run exactly like ComfyUI's stop button.
  Interrupting the queue also releases the pause.
- The controls grey out while an answer is on its way, so a doubled Enter or
  click cannot send it twice; a reply that lands after the pause is already
  over is ignored rather than reported as a failure.
- Reloading the page does not lose the pause: when the graph finishes
  loading, the panel re-fetches every still-waiting chooser from the server
  and re-renders its filmstrip (countdown included).
- A pause that starts out of sight — another browser tab, another workflow,
  or the node scrolled off the canvas — raises a toast naming the node and
  briefly highlights the waiting workflow tab. One notice per pause; a
  filmstrip you can already see stays quiet.
- The first moments after the filmstrip appears ignore clicks, so a click
  meant for the canvas cannot answer a pause that popped up under the cursor.

## Keyboard

Active while the panel has focus — it takes focus when the pause opens, and a
click anywhere on it returns focus. Keys typed into a text field are left
alone.

| Key | Action |
| --- | --- |
| `1`-`9` | Toggle that frame |
| `A` | Select all |
| `N` | Select none |
| `Enter` | Keep selected |
| `Escape` | Cancel the run |

## Outputs

- **frames**: The kept frames as a BHWC batch, in source order.
- **count**: How many frames were kept.
- **indices**: The kept one-based indices, comma-joined (`1,4,9`).

Thumbnails are written to ComfyUI's temp folder and disappear with its normal
cleanup; answers travel over a local `/ausboss/frame_chooser` route. The last
selection is remembered per node id for the current server session only. Each
pause has a one-use token, so an older panel cannot answer a later pause that
reuses the same node id.

## One answer per pause

Several things can end the same pause: a second browser tab, Escape chasing
Enter, the countdown expiring in the instant an answer arrives, or the queue
being stopped. The server settles that on the way in — the first one to reach
the pause decides it, and every later attempt is refused rather than allowed
to overwrite the decision. So a cancel that lands behind a keep cannot stop a
run that is already continuing, an expired timer cannot discard the answer you
just gave, and the panel that lost never claims it was the one that counted.
Whichever way the pause went is broadcast to every open tab, which is what
releases the other panels and fills in `pick_list`.
