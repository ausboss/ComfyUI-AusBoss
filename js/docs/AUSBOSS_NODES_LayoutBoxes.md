# Layout Boxes

Draw boxes on a canvas and say what goes in each one: a thing, or words to
write in the picture. The picture you make then has each thing where you put
it. Use it for layout prompts, such as MOSS-Image's.

It does what ComfyUI's own Create Bounding Boxes does and gives the same
outputs. Its canvas also works in the classic node look, where Create Bounding
Boxes only shows "Node 2.0 only".

## How to use it

1. Set the canvas size in **Canvas** (W × H), or wire `width` and `height` from
   Latent Size, so the boxes and your picture have the same size.
2. Drag on the canvas to draw a box. Its tag shows its number and its type,
   such as **1 object**.
3. Under the canvas, the row **Box 1 is** sets what the chosen box holds,
   **object** or **text**. Then type its words:
   - **object**: the **Description** says what is in the box, for example "a
     red bicycle leaning on a brick wall".
   - **text**: the **Text** is the words to write in the picture, for example
     "OPEN 24 HOURS". The **Description** says how they look, for example
     "pink neon letters".
4. Wire `elements` to the `element` input of MOSS-Image Layout Prompt, and give
   that node the same width and height.

Wire `preview` to a Preview Image to see the boxes with their numbers and words.

## Place people with MiniMax H3 Image

The `h3_prompt` output says the boxes in words for MiniMax H3 Image: who goes
where, what they do there, how big, and who stands beside whom. Use it to put the people from your
reference pictures into a scene, each one where you drew a box.

1. Wire your scene picture into `background` and into the first picture of
   the H3 Image node: it is `<Picture 1>`, the picture that is changed.
2. Wire the people's pictures into the next ones: `<Picture 2>`,
   `<Picture 3>` and so on.
3. Draw one **object** box for each person. In its **Description**, name
   their picture and say what they do there, for example "the man from
   `<Picture 2>`, sitting on the couch". That second part is what puts them
   in the box: told only where to go, H3 Image keeps people standing as in
   their own picture, often outside the box.
4. A box with no description still gets the next picture, `<Picture 2>`, then
   `<Picture 3>`, in the order of the boxes, and keeps that person's face,
   hair and clothes. It is a rough place only. A description without a
   picture is a thing: a dog, a sofa. A **text** box writes its words at its
   place.
5. Wire `h3_prompt` to the prompt of the H3 Image node. To add words of your
   own, such as the light or the mood, join the two texts first, for example
   with ComfyUI's Concatenate Text node.

Without a picture on `background` there is no scene picture, and the people
start at `<Picture 1>`.

The prompt says every place in words, never in numbers: H3 Image draws
numbers from a prompt onto the picture as text. Tried on three rooms and two
seeds: with a description like the one above, the man was in his box 6 times
of 6 and the woman 4 of 6, and the room stayed as it was; with empty boxes,
2 of 12. Keep `preview` out of H3
Image's pictures too, or the boxes' lines can stay in the picture.

## Words for a prompt

Some models make a picture from a prompt alone and have no input for boxes.
The `placement` output says your boxes as plain sentences: what goes in each
box and where it is in the picture. Add it to your prompt, for example with
ComfyUI's Concatenate Text node, and the model puts each thing where you drew
it.

For a text box with the word FRESH in the top left and an orange on the right,
it gives:

> The words "FRESH" in huge bold black sans-serif letters, placed top left,
> from 6% to 52% across and 6% to 25% down. One ripe orange with a green
> leaf, placed middle right, from 52% to 94% across and 35% to 85% down.

Write the **Description** of each box the way you would in a prompt. Tried on
SenseNova U1.6, which has no box input: these sentences put all the boxes in
place on two seeds of two, where `elements` as text put the words in the wrong
places.

## Change the words in a picture

The `mask` output is white inside every box. Use it to change only one part
of a picture, such as the words on a sign or a shirt.

1. Wire a Load Image into `background` and pick your picture. It shows on the
   canvas right away.
2. Draw a box over the old words, a little wider than the old words on every
   side (about 12 pixels), or bits of the old letters can show at its edge.
   Keep faces and hands out of it: whatever is in the box is drawn again.
   The arrow keys move the chosen box one pixel at a time.
3. If the words run at a slant, turn the box to match them: drag the round
   handle over the box (see **Turning a box** below).
4. Make it a **text** box. Type the new words in **Text**, and how they look in
   **Description**, for example "white letters on a red sign".
5. Soften the edge of `mask`, for example with Mask Refine 🆎 at a blur of
   about 6, or a line can show around the box. Then wire it into the inpaint
   part of your workflow: Set Latent Noise Mask, so only the box is drawn
   again, and Image Composite Masked, so everything else stays as it was.
6. With MOSS-Image, wire `elements` to MOSS-Image Layout Prompt. The model
   gets the new words from the box, and your prompt only describes the picture.

## Turning a box

Words on a sign or a shirt often run at a slant. Turn the box to lie along
them, and only the slanted words are drawn again.

1. Click the box to choose it. A round handle shows over the middle of its
   top edge.
2. Drag the handle around the box. Hold Shift to turn it in steps of 5
   degrees.
3. Or type the angle in **Turn**, under the canvas: plus turns the box
   clockwise. **0°**, or a double-click on the round handle, makes the box
   level again.

The box's tag shows how far it is turned, for example **1 text 25°**. A turned
box still moves, sizes and takes the arrow keys. Its corners may reach past
the edge of the picture, so it can cover words that run to the edge.

A turned **text** box tells the model the slant for you: its description in
`elements` gets "tilted about 25 degrees, running downhill to the right" (or
"uphill") added, so you do not have to type it.

If the picture is resized on its way to the model, resize the mask with it:
Image Resize 🆎 takes a mask and gives it the same size and crop.

## Drawing and moving boxes

| Do this | To get this |
|---|---|
| Drag on an empty spot | Draw a new box |
| Shift + drag over a box | Draw a new box on top of it |
| Drag a box | Move it |
| Drag a corner or an edge of the chosen box | Make it bigger or smaller |
| Drag the round handle over the chosen box | Turn it (Shift: steps of 5 degrees) |
| Double-click the round handle | Make the box level again |
| Double-click a box | Type its words |
| Click a box's chip under the canvas (**1 text**, **2 object**) | Choose that box, also one hidden under another. When there are more boxes than chips, **‹ ›** step through them |
| Delete | Remove the chosen box |
| Arrow keys | Move the chosen box one pixel (Shift + arrow: ten pixels) |
| Ctrl + D | Copy the chosen box |
| Esc | Let go of the box, or put back a box you are dragging |
| Hold Ctrl (or Alt) while dragging | Place the box freely, off the grid |

The keys work while the canvas has the focus: click the canvas, or a box's
chip, first.

The handles and the tags keep their size on your screen when you zoom the
graph in or out, and a box too small for eight handles keeps its corners.
Over a picture the boxes are see-through and show no words, so you can read
what is under them; the chosen box's words are under the canvas.

An **object** box does not write words. If you typed words while it was a
**text** box, a line under the canvas says they are kept: click **text** and
they come back.

## The order of the boxes

Box 1 is at the back, and the last box is in front, so draw the things at the
back first. The two square buttons under the canvas move the chosen box back or
forward. MOSS-Image Layout Prompt's `character_boxes` takes these numbers.

## Colors

A box can have up to five colors for the model to use on that thing. **+** adds
a color, a click on a color changes it, and a right-click (or its cross)
removes it. The first color also colors the box on the canvas.

## The bar above the canvas

- **Grid**: boxes snap to a grid while you draw, move and size them with the
  mouse. It is on for an empty canvas and off over a picture on `background`,
  so a box can go anywhere on the picture. Click it to turn it on or off; the
  node keeps your choice. Hold Ctrl (or Alt) while dragging to leave the grid
  for one drag. The cells are 32 pixels, bigger on a very big canvas. A
  turned box does not snap: it moves and sizes one pixel at a time.
- **Layouts**: start from a ready arrangement: one in the middle, two side by
  side, three across, top and bottom, a title over a picture, four corners.
  The boxes you already have move into the new places, level, and keep their
  words.
- The canvas size, and where it comes from: **picture** when a picture is on
  `background`, **wired** when width and height are wired.
- **Clear** removes every box.
- **⚙** (the gear): **Grid size**, the pixels from one grid line to the next:
  Auto (32 pixels, more on a very big canvas), 8, 16, 32 or 64. The node keeps
  it.

## Inputs

| Input | What it does |
|---|---|
| `background` | A picture to draw on. It shows under the boxes, and the canvas takes its size and shape, also when `width` and `height` are wired: the boxes are drawn on the picture, where the `mask` is made. The Canvas row dims while a picture is wired. |
| `bboxes` | Boxes to start from: bounding boxes, prompt elements (such as the `elements` of another Layout Boxes), or either as JSON text. New boxes on this wire fill the canvas when the workflow runs. Your changes on the canvas then stay until the boxes on the wire change. After **Clear**, the next run fills the canvas from the wire again. |
| `width`, `height` | The canvas size in pixels. Wired from Latent Size, the canvas takes that size and shape at once. |

## Outputs

| Output | Use |
|---|---|
| `preview` | A picture of the boxes with their numbers, words and colors, to check the layout. Turned boxes are drawn turned. |
| `bboxes` | The boxes in pixels of the canvas (x, y, width, height), for nodes that take bounding boxes. A turned box gives the straight box around it. |
| `elements` | The boxes as prompt elements. Wire it to MOSS-Image Layout Prompt. A turned box gives the straight box around it, and a turned text box says its slant in its description. |
| `mask` | White inside every box, black elsewhere, to change only those places of a picture. A turned box is white inside its turned shape only. |
| `h3_prompt` | The boxes as a prompt for MiniMax H3 Image, in words: where each thing goes and how big it is. Name each person's picture and what they do in the box's description. See **Place people with MiniMax H3 Image**. |
| `placement` | The boxes as sentences for a prompt: what goes in each box and where, as parts of the picture. Add it to your prompt for a model that has no box input. See **Words for a prompt**. |

## In place of Create Bounding Boxes

Layout Boxes has the same inputs and the same outputs in the same order (and
`mask`, `h3_prompt` and `placement` after them), so the wires move straight over. For the same boxes it
gives the same `bboxes` and `elements`, and MOSS-Image Layout Prompt makes the
same prompt from them.

The boxes drawn on a Create Bounding Boxes do not move over by themselves. To
take them along, wire that node's `elements` into `bboxes` of Layout Boxes and
run once: they fill the canvas. Then remove the old node.

## Technical details

- The boxes are kept on the node as text, in the hidden `layout` input. Each
  box's place is kept as parts of the canvas from 0 to 1, so a new canvas size
  keeps every box at the same place. An API prompt can set it:
  `{"v": 1, "boxes": [{"x": 0.25, "y": 0.1, "w": 0.5, "h": 0.8, "type": "obj", "text": "", "desc": "a cat", "palette": ["#ff3399"]}]}`.
  A list of pixel boxes in Create Bounding Boxes' own form is read as well.
- A turned box also has `"angle"`: degrees, clockwise on the screen, from -90
  to 90, about the box's centre. `x`, `y`, `w` and `h` stay the box as it was
  drawn, before the turn. Only turned boxes carry the key, and a box without
  it is level, so layouts saved before boxes could turn give exactly what
  they gave. The turn is made in pixels of the canvas the box was drawn on
  (the picture on `background`, when there is one), so a turned box is a true
  rectangle there whatever the canvas's shape.
- For a turned box, `mask` is white at every pixel whose centre is inside the
  turned rectangle. `bboxes` and `elements` hold the straight box around it,
  cut to the canvas: those types only know straight boxes. A text box turned
  2 degrees or more gets "tilted about N degrees, running downhill to the
  right" (clockwise) or "running uphill to the right" added to its
  description in `elements`, after a comma, or as its own sentence when the
  description ends with a full stop; not when the description already says
  it. Object boxes get no such words.
- `elements` holds one element per box, in order:
  `{"type": "obj" or "text", "bbox": [ymin, xmin, ymax, xmax], "text", "desc", "color_palette"}`.
  The place is on a 0 to 1000 grid over the canvas, `text` is there for text
  boxes only, and `color_palette` holds up to five colors when the box has any.
- `bboxes` is a list holding one list of boxes, the form ComfyUI's
  bounding-box nodes pass on. With no boxes it is empty.
- `mask` is one mask (1 x height x width): 1 inside every box, 0 elsewhere,
  with hard edges. With a picture on `background` it has the picture's own
  size, and each box covers the same part of the picture that it covers on
  the canvas. Without a picture it has the canvas size and covers the same
  pixels as `bboxes`. With no boxes it is all 0.
- With a picture on `background`, the canvas on the node is the picture at
  its own size, so the arrow keys move a box one pixel of the picture.
  `width` and `height` still set the pixels `bboxes` counts in and the size of
  `preview`.
- The picture shows before a run when `background` comes from a Load Image,
  straight or through Reroutes. Through a node that changes the picture
  first, such as a resize, it shows after a run.
- Before a run, the canvas can only know a wired size it can read from the
  node it comes from: Latent Size, Integer or a Primitive. From any other
  node, the canvas keeps its own size until a run, and then shows the size
  the run used. Either way the boxes keep their place on the size that
  arrives.
- Like Create Bounding Boxes, it is an output node: it runs with the workflow
  even when nothing is wired to its outputs, so new boxes on the `bboxes` wire
  reach the canvas.
- `h3_prompt` has an opening sentence (one photograph of the scene in
  `<Picture 1>`, kept as it is), one sentence per box in box order, and a
  closing one (the same ground and light for everything). Across, a box is at
  the far left, left, middle, right or far right by its centre; it is "high"
  or "low" when its centre is in the top or bottom third and it is less than
  0.6 of the frame tall. Its height and width are said as a tenth, a quarter,
  a third, half, two thirds, three quarters or all of the frame. Each object
  is placed against the object on its left when the two share some height:
  right beside it (a gap under 5% of the frame), a little to the right (under
  15%), well to the right, or partly in front of or behind it when they
  overlap (the later box is in front). Text boxes are placed by the frame
  only. A turned box is placed by the straight box around it. A text box with
  no text and no description is left out. No boxes give an empty text.
- `placement` has one sentence per box, in box order, joined by spaces. A
  text box with words gives `The words "TEXT" in DESCRIPTION, placed WHERE.`
  (`The words "TEXT", placed WHERE.` without a description); any other box
  gives its description, first letter in upper case, then `, placed WHERE.`
  A box with no words and no description is left out. The description is
  the one `elements` carries, so a turned text box says its slant. WHERE is
  a rough place and then the box's edges in whole percents of the canvas,
  cut to it: `top left, from 6% to 52% across and 6% to 25% down`. The box
  is "top" when its bottom edge is above 40%, "bottom" when its top edge is
  below 60%, else "middle"; "left" when its right edge is left of 55%,
  "right" when its left edge is right of 45%, else "center"; and the middle
  of both is said as "center" alone. A turned box is placed by the straight
  box around it. A box with colors gets ` Colors: #FF3399, #00AABB.` after
  its sentence. No boxes give an empty text.
- The background is saved, shrunk, in ComfyUI's temp folder for the node's
  face. Nothing else is written.
