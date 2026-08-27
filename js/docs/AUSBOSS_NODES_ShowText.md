# Show Text

Displays the `STRING` it receives on the node face — an LLM reply, a
generated caption, a resolved filename — and passes it through unchanged, so
it can sit in the middle of a wire instead of at a dead end.

## Controls

- **text**: The string to display. Input-only; connect any `STRING` output.

## Output

- **text**: The input, passed through untouched.

## Panel

The panel fills the node, so drag the node taller to read more at once. The
text can be selected and copied straight off the node; empty panel space
still drags the node and the wheel still zooms the graph.

The last shown text is saved with the workflow, so a reloaded graph reopens
showing its previous result. Very long strings are cut off in the display
(with a note saying so) — the output wire always carries the whole string.
The node performs no network requests.
