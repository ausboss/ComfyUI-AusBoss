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
- For the details, make a line **small print**: put the caret on it and press
  **Small** under the text box. It is drawn small under the line above, so
  the first line stays big enough to read from far out. Press **Small** again
  to make it normal.
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

## Links

A note can link to a page on the web, or to a part of the workflow.

- **To a page:** select the words, press **Link** under the text box, and
  paste the address. Or select the words and paste the address straight over
  them. Click the words later and the page opens in a new tab. A small ↗
  after the words shows that they leave ComfyUI, and hovering shows where
  they go.
- **To a node or a group:** while you edit, click the node or the group on
  the canvas, select the words and press **Link**. Click the words later and
  the canvas brings it into view. An arrow can point at a group too: click
  the group, then press an arrow.
- A note that is nothing but one link is a big button for it: its words fill
  the note.

In the text a link is written `[the words](https://example.com)`, or
`[the words](#12)` for node 12 and `[the words](#g3)` for group 3.

## Technical details

- The text is stored in the node's one hidden `text` input, so saving,
  undo and copy work like any other node. Nothing else is saved with it.
- In the text, small print is a line that starts with six `#` and a space:
  `###### Off, your words go in as typed.` Small print is 62% of the note's
  text size and never under 11 px.
- Notes written before small print look the same. An older version of the
  pack drops those six `#` like any other heading mark, so a note with small
  print still reads right there, with every line at one size.
- The text size is the largest whole pixel size, from 12 to 30, that fits the
  note. A very long text at the smallest size is cut off at the bottom: make
  the note taller.
- Only `http` and `https` addresses become links. Anything else in the round
  brackets leaves the text as typed. A link opens in a new tab and is never
  opened by the note itself: only your click does.
- A link from someone else's workflow goes where its author pointed it. Hover
  it to read the address before you click.
- An older version of the pack shows a link as typed, brackets and address
  included, so the address can still be read and copied there.
- The font is IBM Plex Sans when the computer has it, otherwise the system
  font. The node loads no fonts and makes no network requests.
