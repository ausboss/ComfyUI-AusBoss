# Math Expression

Does maths on up to three numbers. Type a formula that uses `a`, `b` and `c`
and get the answer as a decimal number and as a whole number. Use it for
width and height sums, strength ramps and frame counts.

## Controls

- **f(a, b, c)** (`expression`): The arithmetic to evaluate. Allowed:
  numbers, the names `a`/`b`/`c`, the operators `+ - * / // % **`,
  parentheses, unary minus, and the functions `min`, `max`, `abs`, `round`,
  `floor`, `ceil`, `sqrt`.
  Examples: `a * 2`, `floor(a / 64) * 64`, `min(a, b) + 0.5`,
  `sqrt(a*a + b*b)`. A new node starts with `a + b`. `min` and `max` take
  two or more values, and `round(a, 2)` keeps two decimals.
- **a**, **b**, **c**: The values the expression reads, as three sockets on
  the node's left edge that take a `FLOAT` or an `INT`. An unwired one reads
  as `0`, and an unused one costs nothing; a constant belongs in the
  expression itself (`a * 2`, `floor(a / 64) * 64`).

## Outputs

- **float**: The result as a float.
- **int**: The result rounded to the nearest whole number; halves round away
  from zero (`2.5` becomes `3`, `-2.5` becomes `-3`). `round()` inside the
  expression is different: it sends a half to the nearest even number, so
  `round(2.5)` is `2`.

## Safety

The expression is parsed with Python's `ast` module and walked against a
whitelist — it is never passed to `eval`. Anything outside the grammar above
(other names, attribute access, subscripts, strings, comparisons) stops the
run with an error naming what to remove, so a workflow shared by someone else
cannot smuggle code through this node. Division by zero and overflowing
results are clear errors rather than a crash or an `inf` traveling
downstream. So are the square root of a negative number and an empty
expression. An expression can be up to 4096 characters long.
