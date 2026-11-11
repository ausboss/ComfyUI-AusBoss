# Text Lines

Runs what comes after once for each line of your text. Type five prompts,
one on each line, press Run once, and you get five pictures.

Use it for a list of prompts you typed, or for a list another node wrote,
such as a text model asked for "five different poses".

## How to use it

1. Type your lines in the box, or wire text into **text**.
2. Wire **line** to where one prompt would go, such as a text encoder's
   prompt.
3. Run. Every node after it runs once for each line, and a Save Image at the
   end saves one picture for each.

Empty lines are skipped. Models and pictures that do not depend on the line
are loaded once, not once for each line.

## Controls

- The text box (`text`): One line for each run.
- **Split at** (`split`): **each line** makes every line its own run.
  **blank line** keeps lines together and starts the next run at an empty
  line. Pick it when one prompt is several lines long.
- **Numbering** (`remove_numbering`): **remove** takes a number or bullet
  off the start of each line, such as `1.`, `2)`, `-` or `[prompt 3]`.
  Lists a text model writes usually have them. **keep** leaves every line
  as written.
- **Limit** (`limit`): The most lines to run. 0 runs them all. Set it when
  a text model might write more lines than you asked for.

## Outputs

- **line**: Each line, one at a time.
- **number**: The line's place in the list, starting at 1. Add it to a seed
  with Math Expression (`a + b`) to give each line its own seed.
- **count**: How many lines run.

## Notes

- With no lines at all, the run stops at this node and says so.
- Every run uses the same seed unless you add **number** to it. Different
  prompts still give different pictures.
- A line such as "2 women on a beach" or "1.5x zoom" keeps its number: only
  a number followed by a period, bracket or colon counts as numbering.

## Technical details

**line** and **number** are ComfyUI lists (`OUTPUT_IS_LIST`), the same way
Image Folder hands out pictures. ComfyUI runs each later node once for each
item and keeps the results in order. A node that takes a whole list at once,
such as core Rebatch Images, gets all of them together.

Numbering that is removed: a number in square, round or CJK brackets with an
optional word before it (`[prompt 1]`, `(2)`), a word and a number followed by
a colon, period, bracket or dash (`Shot 3:`), a bare number followed by a
period, bracket or colon that has no digit right after it, and the bullets
`-`, `*` and `•` followed by a space. Only one marker is removed from each
line.
