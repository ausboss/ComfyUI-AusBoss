# Mask by Touch

Click a thing on the picture and get its mask. No name to type and no
MaskEditor: the picture is on the node.

Use it wherever a workflow needs a mask of something you can point at: to
change it, remove it, cut it out, or keep everything else.

## How to use it

1. Wire a picture into **image**.
2. Wire **model** and **clip** from a Load Checkpoint that loads the SAM 3
   file (`sam3.1_multiplex_fp16.safetensors`).
3. Move the pointer over the picture on the node. The thing a click would
   take lights up, with its name beside the pointer. Click to pick it.
4. Click more things to add them.

What is lit in teal is what the mask will be. When it is right, press Run
for the whole workflow.

The first time the pointer rests on a picture, the node looks at it. A
small button under the picture shows how far along it is, **❚❚ 40/104**,
filling up as it goes. The first things light up after a few seconds, and
it has seen the whole picture after about 20.

You do not have to wait for that. Whatever is lit under the pointer can be
picked: a click takes it at once, also while the node is still looking.

Click that button to pause the looking when what you need is already lit:
what is lit stays, and you go on picking and painting. It turns into
**▶**; click it to look on from where it stopped. A click on a spot where
nothing is lit yet looks on as well.

A click on a spot where nothing is lit yet is not lost: a dot marks it, the
line under the picture says **your click is in**, and it is taken as soon as the node has
found the thing there. One click waits at a time; more clicks on spots with
nothing lit are not taken until then.

A thing lights up with its name when the node is sure of the name. When it
is not sure, the thing still lights up and can be picked, without a name.

## When it picked the wrong thing

A click can mean more than one thing: the jacket, or the person wearing it.
The node takes the most likely one and shows its name with two arrows, like
**‹ jacket · 1 of 3 ›**. Press an arrow to swap the pick for the next thing
at that spot.

- A stroke over a thing works too, and takes the thing the stroke lies in.
  A stroke across two things, like both shoes, takes both.
- Did the thing not light up at all? Type its name into the field under the
  picture, like "screen" or "earring", and press Enter.
- When nothing fits, switch to **Paint** and paint the area yourself.

## The whole subject, or the background

Under the picture, **Subject** picks the picture's main subject in one
click: the person, the animal, the product. **Background** picks everything
else. They are picks like any other: click more things to add them, or
Ctrl-click a thing to take it away again.

Both need ComfyUI's background-removal model, see "The model for Fine
edges" below.

## Fix the mask with the brush

The switch above the picture has three tools:

- **Pick** (key **W**) takes whole things: a click, or a stroke over a
  thing.
- **Paint** (key **B**) adds to the mask, exactly as you paint it.
- **Erase** (key **E**) rubs the mask out, exactly as you paint it.

The letters are Photoshop's, and work while the pointer is on the node.

Hold **Ctrl**, or use the right mouse button, to do the opposite for as
long as you hold it: erase while you paint, paint while you erase. In Pick,
Ctrl-click takes a thing away again.

The brush:

- **Size** is how wide it is, in pixels of the picture. **Soft** is how
  soft its edge is, for Paint and Erase: 0 is a hard edge, 100 fades all
  the way from the middle. Drag on either number, or on its name, to change
  it.
- **[** and **]** make it smaller and larger. **Shift + [** and
  **Shift + ]** make the edge softer and harder.
- Hold **Alt** and the **right mouse button** on the picture, then drag:
  left and right for the size, up and down for the edge (up is softer). The
  dashed ring is where its solid middle ends. On a Mac, hold Control and
  Option and drag. Image Compare A/B's brush works the same way.
- The brush shows under the pointer as it will paint: teal where it adds,
  coral where it erases, solid in the middle and fading where its edge is
  soft.

## The chips under the picture

Every area has a chip under the picture: a thing you picked, by its name,
or an area you painted.

- Paint that touches an area joins its chip. Paint that touches nothing
  joins the **paint** chip, however many strokes it takes.
- Erasing never makes a chip: it rubs out whatever is there. Erasing where
  nothing is picked does nothing.
- A thing you take away again (Ctrl-click the face of a person you picked)
  gets a chip in a warm colour. Its **cross** brings the thing back.
  Clicking the thing again does the same.
- Ctrl-click a thing you picked to take it away again, chip and all.
- **Click a chip** to select it: what you paint then joins that chip,
  wherever you paint. The arrows above the chips swap it for the other
  things at the same spot. Click it again, or press **Esc**, to let go.
- **+ new** starts an area of its own: what you paint next gets a new chip,
  also where it touches another one.
- The **cross** on a chip takes that area away, with what was painted onto
  it.
- **all 3** on a chip takes every thing of that name instead of the one you
  clicked: all five birds, both shoes.
- The field at the end, **+ type a name**, picks every thing of the name
  you type. With Erase chosen it takes them away.

## The tools on the node

- **Undo** takes back the last change, or a Clear. Ctrl+Z works as well: it
  is ComfyUI's own undo, and every change counts.
- **Clear** picks nothing.
- **The line under the picture** says what is picked and how much of the
  picture it covers.
- **The dot** beside it shows the edge that Grow and Soften give, on one dab
  of the brush.
- **The eye**, beside Undo and Clear, switches between your picks and the
  result. Off, the picked area is tinted on the whole picture. On,
  everything else is hidden and you see the cut-out as it will come out.
  **Shift-click** the eye to see the black and white mask instead; the
  node's right-click menu has the same choice.
- **Esc** drops a stroke you have started.

## Settings

- **Grow** (`grow`): pixels to reach past the picked area's edge. Below zero
  shrinks it. 0 keeps the exact outline. An inpaint usually wants a few
  pixels.
- **Soften** (`soften`): pixels of soft edge. 0 keeps a hard edge. It moves
  half a pixel a step; hold **Shift** for a tenth. If the line under the
  picture says **faint mask**, Soften is wider than what you picked: lower
  it.
- **Fine edges** (`fine_edges`): for hair and fur. On, the outline of the
  picture's main subject is followed strand by strand, and the cut-out loses
  the colour of the old background. Off keeps the edge as SAM 3 found it. It
  needs one more model file, see "The model for Fine edges" below. While it
  works on a new pick, the picture says **Working on the fine details…** in
  its corner.
- **More → Smooth** (`smooth`): rounds off a ragged outline by this many
  pixels.
- **More → Fill small holes** (`fill_holes`): closes pinholes inside the
  picked area. Larger openings stay open, like a mug's handle.
- **More → Invert** (`invert`): turns the mask round. On, the mask is
  everything except what you picked.
- **More → If nothing** (`if_nothing`): **stop the run** or **empty mask**,
  see below.
- **More → Free VRAM** (`free_vram`): takes SAM 3 out of the graphics card's
  memory right after the search, so the next model has the room. Turn it on
  in a workflow that loads a big model after this node.

Grow, Soften, Smooth and Fill small holes show on the picture while you
change them. The tint always keeps the shape you picked; click **the eye**
to see the edge exactly as it will come out.

## The model for Fine edges

Fine edges, **Subject** and **Background** use ComfyUI's own
background-removal model (BiRefNet, about 445 MB, MIT licence). If you have
used ComfyUI's Remove Background template, you already have it.

1. Get `birefnet.safetensors` from the Hugging Face page `Comfy-Org/BiRefNet`
   (folder `background_removal`).
2. Put it in `ComfyUI/models/background_removal`.
3. Press **R** in ComfyUI, then set **Fine edges** to **on**.

A workflow that already has Fine edges on tells ComfyUI which file it needs,
so ComfyUI lists it under **Missing Models** with a download button.

Good to know:

- Fine edges works on the outline of the main subject: a person's hair
  against a wall, a dog's fur against grass, on light and dark backgrounds.
  Background seen between loose strands goes too, also deep in the hair.
- An edge inside the subject stays as SAM 3 found it: hair against a face, a
  necklace on a neck, a cup in a hand. So does a thing that is not part of
  the main subject.
- A thing with a clean hard edge, like a mug, comes out the same.
- Something else of the subject that lies between your pick and the
  background can come along: the hair beside a pair of headphones, a strip of
  skirt under a blouse. Take it away with Ctrl-click or **Erase**, or switch
  Fine edges off for that pick.
- What you paint with the brush stays exactly as you painted it.
- It needs ComfyUI 0.21 or newer.

## When nothing is picked

By default the run stops right here with a plain message, so nothing after
this node runs on an empty mask. Click a thing on the node's picture, or
draw on it, then run again.

Set **If nothing** to **empty mask** to let the run go on with a mask of
nothing instead.

## Which picture the picks belong to

Picks belong to the picture they were made on. Load another picture and the
node shows it with nothing picked, and says the old picks are not used.

- With a Load Image wired straight in, or through Reroute nodes, the
  picture shows as soon as you choose a file.
- With **Image Crop + Rotate + Pad 🆎** or **Load Image + Pad 🆎** wired
  straight in (Reroutes on the way count as straight), it shows by itself too, a moment after you choose a file or
  change the crop. The node runs the loader for that, so you see the picture
  as the loader hands it on, cropped and all. A workflow you just opened
  shows **Show picture** instead: opening one starts nothing.
- With anything else before it, the node shows **Show picture**: it has to
  run what comes before it to know the picture.
- Choose another picture while the node is still looking at the last one,
  and it lets that look go and starts on the new picture.
- A workflow you reopen shows **Show the picks** once: press it, or run the
  workflow, and your saved picks are back.
- If the picture comes from a sampler, set its seed to **fixed**. With a
  seed that changes on every run, each click would make a new picture.

## Outputs

- **mask**: white where the picked area is. One mask per picture.
- **cut_out**: the picture with everything but the picked area see-through.
  Save it as a PNG to keep the see-through part. With **Fine edges** on,
  half see-through pixels (a strand of hair) get the thing's own colour, so
  no light or dark fringe shows on a new background.
- **names**: the names of what you picked, as text, like "sweater, cup".
  Wire it into a prompt to say what the mask is of. A thing the node was not
  sure of the name of is left out, and so are Subject and Background.

## When the node looks at a picture

The node looks at each new picture once, for a few seconds, so things can
light up. It starts when the pointer rests on the picture, or with your
first click. To have nothing start by itself, open ComfyUI's Settings,
**AusBoss → Mask by Touch → Look**, and choose **only on a click or the
Look button**. The picture from one of the pack's loaders then waits for a
press on **Show picture** as well.

## Technical details

### How SAM 3 is asked

- The search is ComfyUI's own SAM 3: SAM3 Detect, asked about points, or
  about a word that CLIP Text Encode has read. Both use ComfyUI's own
  settings (threshold 0.5, two edge passes). The node needs ComfyUI 0.20 or
  newer and says so on an older one.
- A model or a text reader that is not SAM 3's fails with a line saying what
  to wire.

### What is saved with the workflow

**`touches`** holds what was picked, as JSON, so it works from the API with
no browser:

```json
{"v": 1, "key": "...", "items": [
  {"t": "tap",   "op": 1, "x": 160, "y": 1450},
  {"t": "name",  "op": 1, "w": "jacket", "x": 412, "y": 900},
  {"t": "all",   "op": 1, "w": "bird"},
  {"t": "subject", "op": 1},
  {"t": "find",  "op": 1, "r": 30, "pts": [[150, 1240], [230, 1010]]},
  {"t": "paint", "op": 0, "r": 45, "pts": [[640, 120], [760, 170]]}
]}
```

- A `paint` touch may carry **`"s"`**, how soft the brush's edge was (1 to
  100); without it the brush is hard. A soft brush gives a mask with values
  between 0 and 1 along its edge.
- A touch that adds may carry **`"g"`**, the number of the chip it belongs
  to on the node's face. The node itself does not read it.
- Coordinates are pixels of the picture, `r` is the brush's radius, `op` 1
  adds and 0 takes away. Items apply in order. At most 200 items and 20,000
  points.
- **`tap`**: the thing SAM 3 finds at that point. A tap that finds nothing
  changes nothing.
- **`name`**: the thing called `w` at that point. SAM 3 is asked for every
  thing of that name, up to 16 (a bare word would return one). Of those
  that hold the point, the smallest is taken; when none holds it, the touch
  changes nothing. The word loses commas, colons and brackets, and is cut
  to 60 characters.
- A `name` touch may carry **`"q": 1`**: the node's picture did not show
  that word, because SAM 3 was not sure of it. The thing is picked the same
  way, and its word is left out of the `names` output.
- **`subject`** and **`background`**: the picture's main subject as the
  background-removal model sees it (half or more of a pixel), or everything
  else. No point and no word. While **Fine edges** is off they are asked of
  `birefnet.safetensors` if it is there, else of the first file in the
  folder.
- **`all`**: every thing called `w` in the picture, joined into one area.
  SAM 3 is asked the same way as for `name`, so it is at most 16 things.
  When nothing is called that, the touch changes nothing.
- **`find`**: the thing under a stroke. SAM 3 is asked twice, about four
  points spread along the stroke and about two. The four-point answer is
  taken, unless the two-point answer is less than half its size and still
  covers most of the stroke. A stroke shorter than 5 % of the picture's
  long side is asked with two points only. Only the parts of an answer that
  the stroke touches are kept. Over empty space the stroke's own paint is
  used.
- **`paint`**: exactly the stroke's own area. SAM 3 is not asked.
- **`key`** names the picture the picks were made on: its size and a
  fingerprint of every pixel. Picks made on another picture are ignored.
  Leave `key` out when you write `touches` by hand.

### How an area is tidied

- What SAM 3 returns loses its stray specks: an island with less than 1 % of
  the area's pixels is dropped, unless it is under the click.
- A thing SAM 3 found twice under one word (two areas that share 80 % or
  more) counts once.
- The edge settings apply in this order: fill holes, smooth, the fine edge
  (when it is on), grow or shrink, soften. **Fill small holes** closes a
  hole only when it has at most 1 % as many pixels as the picked area, so a
  ring stays a ring.

### Fine edges

- The model is ComfyUI's own background-removal model, loaded and asked
  through ComfyUI's own nodes (Load Background Removal Model, Remove
  Background), as a workflow would. Nothing else is installed. A picture's
  subject is asked for once and remembered.
- The model only knows the main subject. It cannot tell hair from a face,
  and it takes a girl together with the cup she holds. So SAM 3 decides what
  is picked, and the model is used only where the pick's edge is the
  subject's own outline: where the pick's side is subject (80 % or more) and
  the other side is not (25 % or less), looked at along the edge. There the
  model's soft outline replaces the hard one, up to 68 pixels outside the
  pick and 40 inside (on a copy 1024 pixels long, so the reach grows with
  the picture), fading out over the last third so nothing stops at a line.
  Outside the pick only what joins it counts: a strand joins the hair, a
  speck far off does not.
- The other side of an edge is read without crossing the pick again. In a
  narrow gap of the pick, what the gap shows is the other side: the shirt
  down the front of an open coat stays out of the coat.
- Inside a pick on the subject, background that SAM 3 took along goes
  wherever the pick's side is mostly subject (60 % or more): the wall between
  strands, a sliver of wall beside the hair.
- A piece of the pick that is subject as a whole (75 % or more) and has a
  body (somewhere deeper than 12 pixels) is a thing of the subject: hair, a
  person, a coat. Two more things hold for it. Where its rim is thin, loose
  curls with a street light between them, the background between the strands
  goes as long as a fifth of that rim is subject and none lies beyond. And a
  pocket of background inside it goes whole, however deep it lies, when the
  pocket is at most 0.6 % of the picture: a light seen through the hair. A
  bigger piece the model does not see stays. A bracelet or a chain has no
  body, so it stays exactly as picked.
- A picked background gets the same outline the other way round, along the
  outline only. A solid piece of "subject" inside it (more than 4 pixels
  deep) stays: to the model a flower lying on a sweater is partly subject,
  and it is still the flower.
- Everywhere else the edge stays where SAM 3 put it. Paint stays exactly as
  painted.
- If the result would lose more than 40 % of the picked area, it is thrown
  away and the area is kept as it was.
- **Grow** moves the plain area and lays it over the fine edge: the area is
  solid out to its new line, and strands longer than that still show. Below
  zero it cuts the fine edge back to the new line. **Soften** then blurs the
  whole.
- The colours: where a pixel is partly the thing, two passes (a wide one and
  a narrow one) work out the thing's own colour from the pixels around it
  and from what the picture shows at that pixel. Where **Grow** makes the
  mask show more of a pixel than the thing covers, the colour goes back to
  the picture's own.
- With **Invert** the colours are worked out for everything but the pick.
- The node's picture shows the fine edge too. The node sends it after every
  change, about a third of a second after the last one.
- A model file that is missing or is not a background-removal model stops a
  run of the workflow with a line saying what to do. While you click on the
  node, the plain edge is shown instead, with the same line.
- **Free VRAM** unloads this model as well.

### The things that light up

- The node asks SAM 3 about a picture in this order: the place under the
  pointer, 40 everyday words, 48 points spread over the picture, 64 more
  words, then about 350 more points (fewer on a small picture).
- One look goes through the whole list in a single run. While it runs it
  tells the node's picture what it has found, about every 1.5 seconds, so
  things light up as they are found.
- A look ends at once when another job waits in ComfyUI's queue, so a click
  or a run never waits for it: it finishes the question in hand, and the
  next look goes on from there. Measured: a look ended 0.2 to 0.4 seconds
  after a job was queued behind it.
- Every thing SAM 3 calls by a word is a piece with that name and how sure
  SAM 3 was of it. Two words for nearly the same area (80 % or more shared)
  are one piece, under the word SAM 3 was surer of. What a point found is
  dropped when a named piece is nearly the same area.
- A piece from a point is not shown when it is under 0.2 % of the picture or
  over 90 %. A named piece is kept however small. One that is over 90 % of
  the picture is kept only when SAM 3 is at least 0.95 sure of it: asked
  about a hundred words nobody typed, it will sometimes call a whole
  portrait a "mirror". A name you type yourself is never dropped this way.
- A name is shown from a score of 0.8 on, and from 0.9 on for a thing that
  is 30 % of the picture or more. Under that the thing lights up without a
  name. Measured on 22 pictures with 1,137 names: 43 % of the names under
  0.6 were wrong, 20 % of those from 0.7 to 0.8, 4 % of those from 0.8 up.
  With the rule, the area under a wrong name went from 10.3 % of a picture
  to 1.4 %, and under a right one from 66 % to 61 %.
- At most 120 pieces. Over that, pieces from points go first, the smallest
  first, then the names SAM 3 was least sure of.
- A click on a lit piece returns exactly that piece. A named piece has its
  own point for this: the place deepest inside it that lies in no smaller
  thing of the same name.
- A click on a spot where nothing is lit yet waits for the look, which then
  starts at the click. It is taken as soon as a named thing lies under it
  (the person as a whole and a backdrop do not count), when every word of
  the list has been asked, or after 45 seconds at the latest. Without the
  wait it would get only what SAM 3 finds at that one point: the whole
  person for a click on a jacket. One click waits at a time: several would
  be taken one after the other when the look is done, each as the next
  thing at its spot.
- A click on a thing that is lit never waits, whatever the node knows about
  its name: what lights up is what a click takes. A click that waited at
  that spot is answered by it.
- Measured on one machine (RTX 5090, pictures of about 1.5 megapixels, the
  card otherwise idle): the first 40 words were done after 5 to 9 seconds
  and the whole picture after 16 to 25 seconds, in one look, with 72 to
  120 pieces. A picture with many small things takes the longest.

**The first words:** person, face, hair, hand, shirt, t-shirt, tank top,
jacket, coat, sweater, dress, skirt, pants, jeans, shorts, shoe, sneaker,
hat, eyeglasses, bag, backpack, phone, cup, bottle, plate, food, chair,
table, sofa, bed, pillow, lamp, plant, flower, car, dog, cat, window, door,
sign.

**The other words:** arm, leg, foot, eye, lips, eyebrow, beard, ear, neck,
sleeve, shirt collar, fur collar, bag strap, scarf, glove, sock, boot,
sandal, blouse, hoodie, vest, suit, bra, swimsuit, belt, necklace, earring,
bracelet, watch, sunglasses, handbag, suitcase, headphones, laptop,
television, screen, book, drinking glass, bowl, fork, spoon, knife, vase,
teddy bear, toy, chandelier, neon sign, vending machine, mirror, curtain,
rug, blanket, shelf, cabinet, desk, tree, bird, bicycle, motorcycle, truck,
poster, sky, wall, floor.

SAM 3 sometimes gives a right area a wrong word (a jacket also found as
"dress"). That is why two words for one area become one piece.

### A look is quiet

- A look is a run nobody pressed Run for, so it sends ComfyUI's page no
  progress reports. Without this, one look sent about 1,000 of them (SAM 3
  reports after every question), and the progress bar, the tab title and
  the node's outline flickered the whole time.
- Measured on one picture: before, 5 runs, 1,024 `progress` and 1,036
  `progress_state` messages. Now, 1 run, no `progress` and 4
  `progress_state` messages. Those 4 are ComfyUI saying that Load Image
  and this node started and finished.
- An ordinary run of the workflow reports its progress as always. The
  reports are switched back on when the look ends, also when it fails or
  is stopped.
- What a look has found travels as the event `ausboss.mask_by_touch.look`,
  to the browser tab that asked for the look. It carries the node's id,
  the same note the run returns at its end, and `end`, which is true on
  the last one.
- On a ComfyUI that sends progress in a way this node does not know, a look
  still works. It is only no longer quiet.

### What is remembered

- Answers are remembered per picture and per model, for every Mask by Touch
  node: what a point found, what a stroke found, and everything a word
  matched. Changing an edge setting or adding a pick asks SAM 3 only about
  what is new. About 256 MB of areas are kept, the oldest go first.
- What the text reader made of a word is kept too. It is the same for every
  picture, so each word is read once.
- The pieces of the last four pictures are kept.

### Asking quickly

- ComfyUI's SAM 3 node reads the whole picture on every question and checks
  every time that the model is loaded. While this node runs, the picture is
  read once and the check is made once.
- It is proven before it is used, for points and for words apart: the first
  run with a model asks one question both ways and only goes on like this
  when the two answers are the same, pixel for pixel. If a question ever
  fails this way, it is asked again the plain way and the quick way stays
  off.
- Measured on one machine: 144 points took 22 seconds the plain way and
  1.9 seconds this way. A word that matches nothing took 0.10 seconds and
  0.02; a word with one match 0.18 and 0.07. The masks were identical for
  144 of 144 points and 309 of 309 words.

### The rest

- With several pictures in a batch, the same picks are asked of each one,
  and the node's face shows the first.
- **Free VRAM** unloads SAM 3 and its text reader, with ComfyUI's own unload
  of one model, and only after a run of the workflow. Clicking and hovering
  on the node keep SAM 3 loaded, or every click would load it again.
- **Invert** (`invert`) turns the mask round after the edge settings: white
  everywhere except what you picked. The cut-out follows the mask. With
  nothing picked the mask stays empty, and the run still stops if **If
  nothing** says so. In a batch, a picture with nothing picked keeps its
  empty mask.
- **names** is a third output: the names of the picked things as text, in
  the order they were picked, each once, like `jacket, hat`. Only `name` and
  `all` touches have a name; clicks without a name, strokes and paint add
  nothing. A name is left out again once every thing picked under it has
  been taken away with the same name. With a batch, it describes the first
  picture.
- **`ask`** is how the node's own picture asks for one run: `scope` looks at
  the picture (it goes on where the last look stopped), `scope:x,y` does so
  starting under the pointer, `look` only sends the picture and what is
  picked. With `ask` set
  the run never stops for an empty pick. It is never saved with the
  workflow.
- It is an output node, so its own picture can run it alone. It therefore
  also runs when nothing is wired to its outputs.
