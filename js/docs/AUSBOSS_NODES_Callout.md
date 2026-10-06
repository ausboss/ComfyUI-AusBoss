# Callout

A note for the canvas. Type a line or two and the text grows to fill the
note, so people can read it without zooming in. Type an arrow emoji such as ⬆️
to point at the part you are talking about.

Use it to explain a step in a workflow you share. It never runs and has no
wires.

## Writing

- Double-click the note, or press **Edit**, to type. Click outside the box to
  keep the text. **Esc** drops what you typed.
- A blank line starts a new point. Each point gets a thin teal line beside it.
- Put two stars around a word to stress it: `**Resize is on.**`
- A line that starts with `##` is read the same as one that doesn't, so notes
  written for the core Markdown Note paste in as they are.
- Drag the corner to change the size. The text grows or shrinks to fit.

## Arrows

Type an arrow and it turns into a teal arrow, in the middle of your line.

- Use an arrow emoji: ⬆️ ⬇️ ⬅️ ➡️ ↗️ ↘️ ↙️ ↖️. The pointing hands 👆 👇 👈 👉
  and the plain arrows ← ↑ → ↓ work too, and so do `->` and `<-`.
- Or press an arrow in the row under the text box while you edit.
- Put the note next to the part it explains and point the arrow at it.

### Link an arrow to a node

While you edit, click a node on the canvas, then press an arrow. The arrow is
linked to that node. Click a linked arrow later and the canvas brings the node
into view, the same way the frame button in Workflow Switches does. Hover the
arrow to see which node it goes to.

In the text a linked arrow is written like `➡️#12`, where 12 is the node's
number. You can leave the `#12` out to get a plain arrow. If the node is
deleted the arrow stays, faded, and does nothing.

## Technical details

- The text is stored in the node's one hidden `text` input, so saving,
  undo and copy work like any other node. Nothing else is saved with it.
- The text size is the largest whole pixel size, from 12 to 30, that fits the
  note. A very long text at the smallest size is cut off at the bottom: make
  the note taller.
- The font is IBM Plex Sans when the computer has it, otherwise the system
  font. The node loads no fonts and makes no network requests.
