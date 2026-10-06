# Mask by Name

Type what to find in a picture and get its mask. Nothing to paint.

Use it wherever a workflow needs a mask of one thing: to change it, remove it,
cut it out, or keep everything else.

## How to use it

1. Wire a picture into **image**.
2. Wire **model** and **clip** from a Load Checkpoint that loads the SAM 3
   file (`sam3.1_multiplex_fp16.safetensors`).
3. In **Find**, type the thing in a few plain words: "the dog", "the red
   jacket". For several things, put a comma between them: "the hat, the
   bag".
4. Press **FIND**. Only this node runs, and the picture on it shows what was
   found, tinted teal.

When the mask is right, press Run for the whole workflow.

## When it finds nothing

By default the run stops right here with a plain message, so nothing after
this node runs on an empty mask. The node says so on its own face too:
**0 found**, and the message over the picture.

Try another name, or open **More** and lower **Sureness**. A small thing,
such as lips or a strap, often needs 0.6.

Set **If nothing** to **empty mask** to let the run go on with a mask of
nothing instead.

## The card

- **Find** (`name`): what to look for. It can be wired from a Text node.
- **If several** (`several`): when more than one thing matches, mask **all of
  them** or only **the biggest**.
- **Grow** (`grow`): pixels to reach past the thing's edge. 0 keeps the exact
  outline. An inpaint usually wants a few pixels.
- **Soften** (`soften`): pixels of soft edge. 0 keeps a hard edge.
- **If nothing** (`if_nothing`): **stop the run** or **empty mask**, see above.
- **More → Sureness** (`threshold`): how sure SAM 3 must be that something
  matches. Lower it when a small thing is missed. Raise it when it picks up
  something that is not the thing.
- **More → Fill holes** (`fill_holes`): fills gaps that lie fully inside the
  mask, like the spots SAM 3 leaves in hair or cloth. On gives a solid shape.
- **More → Free VRAM** (`free_vram`): takes SAM 3 out of the graphics card's
  memory right after the search, so the next model has the room. Off keeps
  it loaded, which makes the next search a little faster. If you build
  workflows, see the note below.
- **FIND**: runs only this node and what feeds it.
- **1 found · 96% sure**: how many things matched, and how sure SAM 3 was of
  the best one. A low number means: look at the picture, it may have picked
  up something else.
- **Preview**: off hides the picture and skips writing the preview file.

## Outputs

- **mask**: white where the thing is. One mask per picture.
- **cut_out**: the picture with everything but the thing see-through. Save it
  as a PNG to keep the see-through part.
- **found**: how many things matched in the first picture.

## Building a workflow with it

- When a big model loads after this node, such as an edit or a video model,
  turn **More → Free VRAM** on before you save the workflow. SAM 3 then
  leaves the graphics card's memory before that model needs the room.
- When the node is used on its own, or FIND is pressed many times in a row,
  leave it off. Each search is a little faster with SAM 3 still loaded.

## Technical details

- **Why Sureness starts at 0.7.** SAM 3 is generous: asked for a bicycle in a
  picture without one, it often returns its best guess anyway. On 16 test
  pictures the right name scored 89 to 99 percent. Small real things (lips,
  shoes, a strap) scored 67 to 79. A name that was not in the picture scored
  above 50 half the time, and above 70 in 2 of 80 tries. ComfyUI's own
  default is 0.5.
- Each name can match up to 16 things. Without that, SAM 3 returns one match
  per name, and only one of two scarves is found.
- The search is ComfyUI's own SAM 3 (CLIP Text Encode, then SAM3 Detect, with
  its two edge passes). The node needs ComfyUI 0.38 or newer and says so on an
  older one.
- The mask is the size of the picture. For more control over the edge (close
  holes, smooth, snap to the picture) follow it with Mask Refine.
- **Grow**, **Soften** and **Fill holes** are the same expand, blur and fill
  Mask Refine uses, in that node's order: grow, fill, soften. Fill holes
  fills every enclosed gap, also a wanted one such as the middle of a ring.
  Mask Refine can limit it by size.
- **Free VRAM** unloads only SAM 3 and its text reader, with ComfyUI's own
  unload of one model. Every other model stays loaded, and SAM 3 stays in
  system memory, so it comes back quickly. ComfyUI also moves a model out by
  itself when the next one needs the room; the switch is for when you want
  SAM 3 out at once, also after a search that found nothing. Measured on
  one machine: about 1.7 GB of VRAM back, and a search took 0.8 seconds
  instead of 0.5.
- With several pictures in a batch, each one is searched on its own. A
  picture without the thing gets an empty mask, and the run stops only when
  no picture has it.
- The count is what matched, also when **the biggest** keeps one of them.
- It is an output node, so FIND can run it alone. It therefore also runs when
  nothing is wired to its outputs.
- A model that is not SAM 3 fails with a line saying what to wire.
