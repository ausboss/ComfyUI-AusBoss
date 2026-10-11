# Show Text

Shows what arrives on a wire, on the node itself: a prompt, an LLM reply, a
file name, a number. Wire it to anything you want to read while a workflow
runs.

Text passes through unchanged, so the node can sit in the middle of a wire
instead of at a dead end.

## Controls

- **text**: What to show. It takes any wire: text, a whole number, a number
  with decimals, an on/off value, a list.

## Output

- **text**: The text that is shown. Text that came in is passed on
  untouched. A number comes out as text (`1024`), so this node also turns a
  number into text for a node that wants text.

## Panel

The panel fills the node, so drag the node taller to read more at once. The
text can be selected and copied straight off the node, and **⧉** in the
corner copies all of it; empty panel space still drags the node and the
wheel still zooms the graph.

The last shown text is saved with the workflow, so a reloaded graph reopens
showing its previous result. Very long text is cut off in the display (with
a note saying so). The output wire always carries all of it.

## Technical details

- A list or a dictionary is shown as JSON.
- A picture, a mask or a latent is shown by its size, such as
  `tensor 1 x 1024 x 768 x 3, float32`, because its numbers would fill the
  panel. Use **Image Size 🆎** to get a picture's width and height as
  numbers.
- A node that hands out a list of values runs Show Text once per value, and
  the panel shows one line for each.
- Anything else is shown as Python prints it.
- The node performs no network requests.
