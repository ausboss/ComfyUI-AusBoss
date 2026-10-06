# Float

A number with decimals. Set one strength, scale, or CFG here, wire it to
every node that needs it, and change it in one place.

## Controls

- **Value** (`value`): The number to send out. It starts at `0`, and the
  box keeps three decimal places.

## Output

- **float**: The value, unchanged.

For arithmetic on the way — scaling, clamping with `min`/`max` — feed this
into **Math Expression 🆎** instead of retyping derived numbers.
