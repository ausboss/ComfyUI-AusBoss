# Integer

A whole number. Set a step count, a size, or any other whole number once and
wire it to every node that needs it.

## Controls

- **Value** (`value`): The whole number to send out. It starts at `0`. The
  arrows and a drag move it by 1, or click and type. It holds numbers as
  big as a seed.

## Limits

Wire the output to a setting that has limits and the box takes them over.
Wired to a sampler's **steps**, it goes from 1 to 10000: type 0 and you get
1. The card shows **1–10000** beside the value.

- It works through a Reroute and into a box (subgraph) too.
- Wired to two settings, it keeps to what both allow.
- Unwire it and it takes any whole number again.
- A new box takes the value of the first setting you wire it to, so wiring
  it up changes nothing until you move it. A box you have already set, or
  one that came with a workflow, keeps its own value.

## Output

- **int**: The value, unchanged.

For arithmetic on the way — halving a size, adding a margin — feed this into
**Math Expression 🆎** instead of retyping derived numbers.

## Technical details

- The limits are those of the input the wire lands on, the way ComfyUI's own
  Primitive node takes them.
- A value that is outside the limits when the wire is made is brought to the
  nearest one.
- The limits are kept by the node's face. A value sent straight through the
  API is passed on as it is.
- On its own the box goes up to 9,007,199,254,740,991, the largest whole
  number a browser holds exactly. It stopped at 2,147,483,647 before, which
  most seeds are above.
