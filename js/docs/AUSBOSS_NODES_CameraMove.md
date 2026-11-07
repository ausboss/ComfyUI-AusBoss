# Camera Move

Moves the camera of your clip. You steer it on the node's picture, the way
you turn a model in a 3D viewer, and set keys on the time bar. What the old
camera never saw comes out pink, and the CrossView-Warp LoRA for MiniMax H3
paints it in.

## How to use it

1. Load your clip, scale it to the size you will render, and run it through
   **Load MoGe Model** and **MoGe Inference** (core ComfyUI nodes).
2. Connect MoGe Inference's geometry to Camera Move.
3. Press **Show my clip** on the node. It runs the depth once and shows your
   first frame.
4. Steer:
   - Drag the picture to turn the camera round.
   - Pinch or scroll to pull back or push in. Two fingers, or Shift-drag, pan.
   - Tap a spot to circle round it.
   - Top right: drag the axis ball to turn, or tap an axis to look from that
     side. Drag the magnifier to zoom and the hand to pan. The camera button
     puts you back on your own shot.
5. Keys: click the time bar to put a key there, using the camera at that
   moment. Or drag the time bar, then move the camera, and a key appears
   there. The diamond adds or removes a key; the arrows either side jump
   between keys. Drag a key along the bar to change its time.
   ⏮ goes back to the start, ▶ plays, and the loop button plays it round
   and round.
6. Run the workflow. `guide` goes to the H3 guide at frame 0.

The keys move the camera from where your clip's own camera was. If your
clip's camera already moves (walks down an aisle, for example), that move
stays, and your keys add to it. After the last key the camera holds that
turn, but it still travels along with your clip.

The line under the picture turns amber when a key goes past where the LoRA
was trained: 45° of turn, 30° up, 20° down. Past that it may leave pink.

### Mouse and keys (like Blender)

Middle-drag turns, Shift + middle-drag pans, Ctrl + middle-drag zooms, and
the wheel zooms. On the numpad: 4 6 8 2 turn, Ctrl with them pans, + and −
zoom, 1 is the front, 3 the right side (Ctrl: left), 7 the top (Ctrl:
bottom), 0 your own shot. Space plays and pauses and Home goes back to the
start, while the pointer is over the node.

The wheel over the picture zooms the camera, not the graph. Everywhere else
on the node it zooms the graph as usual.

## Inputs and outputs

| | |
|---|---|
| `moge_geometry` | Depth from MoGe Inference, one per frame. |
| `camera` | The keys, written by the node's picture. You never type here. |
| `guide` | Your clip from the moved camera, pink where nothing was seen. |
| `holes` | White where the guide is pink. |

## Technical details

- Each key holds a moment `t` (0 to 1 over the clip), a turn `az` and a rise
  `el` in degrees, `back` (how far the camera pulls back, in distances to the
  pivot; below 0 pushes in), and a pan `px`, `py` (same unit). Between keys
  the camera eases in and out (smoothstep).
- The camera turns round the pivot: a spot you tap (saved as a place on one
  frame, `pivot: {u, v, t}`) or, by default, the nearest fifth of what sits in
  the middle of the first frame, never further than 3 m.
- `R = Ry(-az) · Rx(-el)`, `C = pivot − R·pivot + R·[px·d, py·d, −back·d]`
  with `d = |pivot|`, in OpenCV axes (x right, y down, z forward).
- MoGe's depth scale wobbles from frame to frame. Every frame is scaled so
  its median depth follows a smoothed line (9 frames wide) through all of
  them.
- Each pixel is drawn as 4 points, nearest wins, and gaps mostly surrounded
  by picture (5 of 8 neighbours, two passes) are filled. Everything else
  stays magenta (1, 0, 1).
- The node is an output node so its picture can run it on its own. Each run
  writes up to 61 small frames (416 px on the long side) with their depth to
  ComfyUI's temp folder; the depth is a PNG with a log scale in red (high
  byte) and green (low byte), 0 for no depth.
