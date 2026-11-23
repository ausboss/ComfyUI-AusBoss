# Pause for Shot 🆎

Stops the run right after the 3D viewer so you can frame your shot on the
model it just made. Turn the camera, zoom, spin the model, then press
**Continue**, on this node or on the bar over the viewer. The run goes on with
the shot exactly as the viewer shows it, and nothing before this node runs
again. **Stop** ends the run here.

## How to wire it

Put it between a **Preview 3D (Advanced)** viewer and the node that renders
the shot (such as Render Mesh): the viewer's `model_3d_info`, `camera_info`,
`width` and `height` go in, and the same four come out.

## A 360 behind the model

Wire a 360 picture (twice as wide as tall) into `panorama`. While the run
waits, the viewer shows it behind the model, and `backdrop` gives the part of
it the camera sees, at the shot's size. Put the shot on top of `backdrop` and
the model and its background can be treated apart, such as blurring one and
not the other.

**Shadow** on the viewer's Backdrop tab puts a soft shadow on the floor under
the model, so it stands on the 360 instead of floating in front of it. The
viewer shows it while you frame, and `backdrop` carries the same shadow.

Take the 360 out of the viewer while the run waits, and `backdrop` comes out
plain grey, the same as with no 360 wired in. What you see in the viewer is
what you get.

## Settings

- **Pause**: *wait for me* stops every run here. *run through* lets runs go
  straight on with the camera as it was when you pressed Run, for runs nobody
  is watching.

## Technical details

- Why it is needed: a run takes the camera from the moment Run is pressed. A
  camera moved after that never reaches it, so without a pause you would press
  Run a second time.
- Continue sends the viewer's camera, the model's turn and the size as
  numbers to the pack's own route. Only a node that is waiting accepts it.
- Cancel in ComfyUI's queue ends a pause too. A page reloaded during a pause
  shows the Continue bar again.
- Every open page gets the model to frame, not only the one that pressed Run:
  ComfyUI sends a viewer's result only to that page, so the pause sends it
  again to all of them.
- The shadow's floor is the model's lowest point, and it covers what touches
  that floor: the lowest tenth of the model. Continue sends that patch with
  the camera, and the backdrop is darkened along the same rays Render Mesh
  casts, so the shadow lands where the model's feet are drawn.
