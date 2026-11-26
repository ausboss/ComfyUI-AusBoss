# Strength Curve

Draw how strong something should be over a run, from the first step to the
last, and wire the curve into a node that follows it step by step.

- **LoRA Loader 🆎**: wire the curve into its `curve` input and click the
  curve mark on each row that should follow it. Fade a style LoRA out so
  the fine detail at the end comes out clean, or bring a detail LoRA in
  late.
- **Krea 2 Encode 🆎**: wire the curve into `reference_curve`. The picture
  follows your reference as strongly as the curve says: hold the layout
  early and let go late, or the other way round.

## Using it

1. Pick a preset (flat, fade out, fade in, ease out, ease in) or drag the
   points. Double-click the curve box to add a point, right-click a point to
   remove it.
2. Click a point to pick it, then type or scrub **Point at** (where in the
   run, in %) and **value** for exact numbers.
3. Set **Top** (`high`) and **Bottom** (`low`): the strength at the top and
   the bottom of the curve box. A fade from 1 to 0.3 is a fade out with
   Bottom at 0.3.

Left is the start of the run, where the picture is still noise; right is
the end, where only fine detail changes. Hover the curve to read the value at
any point.

## Outputs

- **curve**: the strength over the run, as a list of numbers from start to
  end (ComfyUI's `FLOATS` type).

## Tips

- On a LoRA row, the curve multiplies the row's own strength. A row at 0.8
  with a fade out goes from 0.8 to 0.
- It works with every model file: full size, fp8, fp8 scaled and int8.
- A curve that moves makes each step a little slower (about 5% on Krea 2)
  and needs no extra memory. A flat line costs nothing.

## Technical details

- The points are saved in the hidden `points` input as `[where, value]`
  pairs from 0 to 1, so a workflow run through the API gives the same
  curve with no editor open. The line between points is a monotone cubic
  (Fritsch and Carlson), so it never swings past a point.
- The output is 101 values spread evenly from start to end, Bottom to Top.
  It is the same reading ComfyUI's own **Create Hook Keyframes From
  Floats** gives a list, so the curve also feeds ComfyUI's hook nodes, and a
  list of numbers from another node feeds our inputs.
- Both nodes read "where in the run" the way ComfyUI's hook keyframes do:
  ComfyUI's percent of the run, measured by noise level. With
  the `simple` and `normal` schedulers that matches the step count; other
  schedulers spend more steps at some noise levels. A second sampler that
  carries on from the first (a refiner pass, a denoise below 1) reads only
  the part of the curve it covers.
- LoRA Loader adds a following row to each layer's result as the layer
  runs (ComfyUI's bypass mode), so the model's weights are never rewritten
  and no second copy of them is kept. Krea 2 Encode scales the reference
  inside attention.
