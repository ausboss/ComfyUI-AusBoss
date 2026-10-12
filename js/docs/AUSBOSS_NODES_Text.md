# Text

A text box. Type a prompt, a caption, or any other text once and feed it to
every node that needs it — changing it in one place updates them all.

## Controls

- The text box (`text`): The text to output. Newlines and spacing are kept.
  Drag the node taller for a bigger box.
- **Ctrl + Up** and **Ctrl + Down** change the weight of the word the caret
  is in, or of the words you selected, as in ComfyUI's own prompt boxes:
  `(red hair:1.1)`. How far one press goes is ComfyUI's setting "Ctrl+up/down
  precision".

## Output

- **text**: Exactly what you typed, unchanged.

The node performs no processing at all: no trimming, no template expansion,
no substitutions. What you see in the box is what arrives downstream.
