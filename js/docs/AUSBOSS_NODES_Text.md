# Text

A text box. Type a prompt, a caption, or any other text once and feed it to
every node that needs it — changing it in one place updates them all.

## Controls

- The text box (`text`): The text to output. Newlines and spacing are kept.
  Drag the node taller for a bigger box.
- The gear, top right: **Look**. **normal** is the usual text box.
  **big** shows your text in large letters in the middle of the box, so a
  word or two such as "jacket" is easy to spot, for example on a small
  Text node next to each picture. The box starts small, about two lines,
  and gets bigger when you drag the node taller. Each node keeps its own
  look, and it is saved with the workflow.
- **Ctrl + Up** and **Ctrl + Down** change the weight of the word the caret
  is in, or of the words you selected, as in ComfyUI's own prompt boxes:
  `(red hair:1.1)`. How far one press goes is ComfyUI's setting "Ctrl+up/down
  precision".

## Output

- **text**: Exactly what you typed, unchanged.

The node performs no processing at all: no trimming, no template expansion,
no substitutions. What you see in the box is what arrives downstream.

## Technical details

The look is stored in the node's properties as `ausboss_text_look: "big"`;
a node in the usual look has no such property. It is not an input, so the
node's saved values and the prompt it sends are the same in both looks, and
an older version of the pack shows the usual box. Long text in the big look
scrolls inside the box.
