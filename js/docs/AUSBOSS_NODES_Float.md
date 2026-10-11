# Float

A number with decimals. Set one strength, scale, or CFG here, wire it to
every node that needs it, and change it in one place.

## Controls

- **Value** (`value`): The number to send out. It starts at `0`. The box
  shows the decimals its steps use (`0.00`) and holds up to three, so a
  typed `0.125` stays `0.125`.

## Limits

Wire the output to a setting that has limits and the box takes them over.
Wired to a sampler's **denoise**, it goes from 0 to 1 and no further: type
1.5 and you get 1. The card shows **0–1** beside the value.

- It works through a Reroute and into a box (subgraph) too.
- Wired to two settings, it keeps to what both allow.
- Unwire it and it takes any number again.
- A new box takes the value of the first setting you wire it to, so wiring
  it up changes nothing until you move it. A box you have already set, or
  one that came with a workflow, keeps its own value.

## Output

- **float**: The value, unchanged.

For arithmetic on the way — scaling, clamping with `min`/`max` — feed this
into **Math Expression 🆎** instead of retyping derived numbers.

## Technical details

- The limits are those of the input the wire lands on, the way ComfyUI's own
  Primitive node takes them. When the inputs agree on a step, the fine step
  (Shift) is that step.
- A value that is outside the limits when the wire is made is brought to the
  nearest one.
- The box holds three decimals, or as many as the step it took over needs.
  It shows the decimals its arrow step reaches (at least one) and goes past
  them only for a value that uses more: `1.00` wired to denoise, `8.0` wired
  to CFG, `0.855` for a typed 0.855.
- The limits are kept by the node's face. A value sent straight through the
  API is passed on as it is.
- Wired only to inputs that share no value (one stops at 1, the other starts
  at 2), the box keeps no limits.
