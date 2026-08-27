# Math Expression

Evaluates one arithmetic expression over the inputs `a`, `b` and `c` and
returns the result as both `FLOAT` and `INT` — width and height math,
strength ramps, frame counts.

## Controls

- **expression**: The arithmetic to evaluate. Allowed: numbers, the names
  `a`/`b`/`c`, the operators `+ - * / // % **`, parentheses, unary minus, and
  the functions `min`, `max`, `abs`, `round`, `floor`, `ceil`, `sqrt`.
  Examples: `a * 2`, `floor(a / 64) * 64`, `min(a, b) + 0.5`,
  `sqrt(a*a + b*b)`.
- **a**, **b**, **c**: The values the expression reads. Type them or convert
  them to inputs and wire numbers in; an unused one costs nothing and an
  unwired one reads as its widget value.

## Outputs

- **float**: The result as a float.
- **int**: The result rounded to the nearest whole number; halves round away
  from zero (`2.5` becomes `3`, `-2.5` becomes `-3`).

## Safety

The expression is parsed with Python's `ast` module and walked against a
whitelist — it is never passed to `eval`. Anything outside the grammar above
(other names, attribute access, subscripts, strings, comparisons) stops the
run with an error naming what to remove, so a workflow shared by someone else
cannot smuggle code through this node. Division by zero and overflowing
results are clear errors rather than a crash or an `inf` traveling
downstream.
