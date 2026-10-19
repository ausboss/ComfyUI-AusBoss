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
2. Drag on the canvas to draw a box.
3. Under the canvas, choose **object** or **text** for the box and type its
   words:
   - **object**: the **Description** says what is in the box, for example "a
     red bicycle leaning on a brick wall".
   - **text**: the **Text** is the words to write in the picture, for example
     "OPEN 24 HOURS". The **Description** says how they look, for example
     "pink neon letters".
4. Wire `elements` to the `element` input of MOSS-Image Layout Prompt, and give
   that node the same width and height.

Wire `preview` to a Preview Image to see the boxes with their numbers and words.

## Drawing and moving boxes

| Do this | To get this |
|---|---|
| Drag on an empty spot | Draw a new box |
| Shift + drag over a box | Draw a new box on top of it |
| Drag a box | Move it |
| Drag a corner or an edge of the chosen box | Make it bigger or smaller |
| Double-click a box | Type its words |
| **‹ ›** under the canvas | Choose the box before or after, also one hidden under another |
| Delete | Remove the chosen box |
| Arrow keys | Nudge the chosen box one grid cell (Shift: four cells, Alt: one pixel) |
| Ctrl + D | Copy the chosen box |
| Esc | Let go of the box, or put back a box you are dragging |
| Hold Alt or Ctrl while dragging | Place the box freely, off the grid |

The keys work while the canvas has the focus: click the canvas first.

## The order of the boxes

Box 1 is at the back, and the last box is in front, so draw the things at the
back first. The two square buttons under the canvas move the chosen box back or
forward. MOSS-Image Layout Prompt's `character_boxes` takes these numbers.

## Colors

A box can have up to five colors for the model to use on that thing. **+** adds
a color, a click on a color changes it, and a right-click (or its cross)
removes it. The first color also colors the box on the canvas.

## The bar above the canvas

- **Grid**: boxes snap to a grid while you draw and move them. The cells are 32
  pixels, bigger on a very big canvas. Click it to turn the grid off.
- **Layouts**: start from a ready arrangement: one in the middle, two side by
  side, three across, top and bottom, a title over a picture, four corners.
  The boxes you already have move into the new places and keep their words.
- The canvas size, and where it comes from when it is wired.
- **Clear** removes every box.

## Inputs

| Input | What it does |
|---|---|
| `background` | A picture to draw on. It shows under the boxes, and its size becomes the canvas size: the Canvas row dims while a picture is wired. |
| `bboxes` | Boxes to start from: bounding boxes, prompt elements (such as the `elements` of another Layout Boxes), or either as JSON text. New boxes on this wire fill the canvas when the workflow runs. Your changes on the canvas then stay until the boxes on the wire change. After **Clear**, the next run fills the canvas from the wire again. |
| `width`, `height` | The canvas size in pixels. Wired from Latent Size, the canvas takes that size and shape at once. |

## Outputs

| Output | Use |
|---|---|
| `preview` | A picture of the boxes with their numbers, words and colors, to check the layout. |
| `bboxes` | The boxes in pixels of the canvas (x, y, width, height), for nodes that take bounding boxes. |
| `elements` | The boxes as prompt elements. Wire it to MOSS-Image Layout Prompt. |

## In place of Create Bounding Boxes

Layout Boxes has the same inputs and the same outputs in the same order, so
the wires move straight over. For the same boxes it gives the same `bboxes`
and `elements`, and MOSS-Image Layout Prompt makes the same prompt from them.

The boxes drawn on a Create Bounding Boxes do not move over by themselves. To
take them along, wire that node's `elements` into `bboxes` of Layout Boxes and
run once: they fill the canvas. Then remove the old node.

## Technical details

- The boxes are kept on the node as text, in the hidden `layout` input. Each
  box's place is kept as parts of the canvas from 0 to 1, so a new canvas size
  keeps every box at the same place. An API prompt can set it:
  `{"v": 1, "boxes": [{"x": 0.25, "y": 0.1, "w": 0.5, "h": 0.8, "type": "obj", "text": "", "desc": "a cat", "palette": ["#ff3399"]}]}`.
  A list of pixel boxes in Create Bounding Boxes' own form is read as well.
- `elements` holds one element per box, in order:
  `{"type": "obj" or "text", "bbox": [ymin, xmin, ymax, xmax], "text", "desc", "color_palette"}`.
  The place is on a 0 to 1000 grid over the canvas, `text` is there for text
  boxes only, and `color_palette` holds up to five colors when the box has any.
- `bboxes` is a list holding one list of boxes, the form ComfyUI's
  bounding-box nodes pass on. With no boxes it is empty.
- Before a run, the canvas can only know a wired size it can read from the
  node it comes from: Latent Size, Integer or a Primitive. From any other
  node, the canvas keeps its own size until a run, and then shows the size
  the run used. Either way the boxes keep their place on the size that
  arrives.
- Like Create Bounding Boxes, it is an output node: it runs with the workflow
  even when nothing is wired to its outputs, so new boxes on the `bboxes` wire
  reach the canvas.
- The background is saved, shrunk, in ComfyUI's temp folder for the node's
  face. Nothing else is written.
