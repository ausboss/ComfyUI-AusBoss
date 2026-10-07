# Changelog

All notable changes to ComfyUI-AusBoss are documented here.

## Unreleased

- **Image Crop + Rotate + Pad: keep your picture under a painted mask.**
  A part you paint in the MaskEditor was always handed on as flat fill. A
  new **Painted area** switch, in the editor's Inpaint & Stitch section,
  can keep your picture there instead: the mask still marks the painted
  part, and the picture under it stays. Use it when a later step needs what
  was there, like an inpaint with denoise under 1. It starts on fill, so
  saved workflows run as before.
- **Krea 2 Inpaint Masked example: Denoise works.** Lowering denoise used
  to leave a flat gray patch where you painted. The example now starts from
  your picture, and a new **Denoise** box sits under your request: 1
  replaces the painted area, around 0.7 the new thing keeps the old shape,
  and at 0.5 and under it stays close to what was there. At 1 the result is
  the same as before.
- **Image Compare A/B shows the result when a run finishes.** With the
  slider on, the node stayed on whichever picture the pointer last left
  over, so a new result could finish behind the picture you started from.
  It now shows the result after every run and each time the pointer moves
  away. The result is B, the "after" picture, or A when your graph makes A
  out of B's picture, which is how the example workflows are wired. The A
  and B buttons still hold one picture. Settings → AusBoss → Image Compare
  → Rest on the result brings the earlier behaviour back.
- **Tiled Upscale: the report says when your picture is made smaller.**
  Asking for fewer megapixels than the picture has printed "close to the
  picture's own size, ask for more", which is wrong when the picture is
  being shrunk. It now says the picture is made smaller first. The help
  page says when that is the right thing to do: a big photo that is noisy
  or soft does better set to 2 megapixels first, then taken up from that
  result.

## 2.9.0 - 2026-10-06

- **New: Tiled Upscale 🆎 and Tiled Upscale Stitch 🆎** (Image). Take a
  picture past the size a model can redraw in one go. Tiled Upscale has one
  control to set, Megapixels, in half steps: the size of the finished
  picture. A picture that fits in one tile stays whole, a bigger one is cut
  into the fewest tiles that fit, and a small picture is not redrawn far
  past the detail it has. Send the tiles through your sampler and into
  Tiled Upscale Stitch, which blends the joins, keeps each tile's colors on
  your picture's and brings the result to the size you asked for. Grain and
  color noise in an old photo do not push the colors. Any model can sit
  between the two. Tile size, overlap, the grid multiple and the redraw
  limit are under More, an upscale model can be plugged in, and a report
  output says what was done with your picture.
- **Nodes 2.0: a Callout keeps the size you give it.** In the Nodes 2.0
  look, a Callout could not be made shorter than its own text. A note made
  in the classic look was drawn taller after a switch to Nodes 2.0 (one
  saved 888 x 122 came out 20 px taller), a note you dragged taller would
  not come back down, and one dragged narrow grew to about 690 px tall. The
  note now keeps its size and the text is fitted to it, as in the classic
  look. The classic look is unchanged. Good to know: Nodes 2.0 shows the
  AusBoss badge in its own row under the note, so a note of the same size
  has about 20 px less room for text there, and the text can come out
  smaller than in the classic look.

## 2.8.0 - 2026-10-06

- **New: Callout 🆎** (Utility). A note for the canvas. The text grows to fill
  the note, so it reads without zooming in, and each point gets a thin teal
  line beside it. Type an arrow emoji such as ⬆️ and it turns into a teal arrow
  in the line. Click a node while you edit, then press an arrow, and the arrow
  is linked to that node: click it later and the canvas brings the node into
  view. Double-click to edit. It never runs and has no wires.
- **New: Image Folder 🆎** (Image). Pick a folder, tick the pictures you
  want in a thumbnail gallery, and run the workflow on each one. All in one
  run does every picked picture with one press of Run. One per run loads one
  picture each run and steps to the next by itself, so a picture that fails
  only skips itself. It gives each picture's mask, its file name (wire it to
  Save Image's filename and the result keeps the name), its number and the
  count. Browse lists the folders inside ComfyUI's input or output folder.
  A folder from anywhere else is brought in: drop it on the node, or choose
  it in your file explorer, and its pictures are copied into the input
  folder. A really big folder asks first. The node reads nothing outside
  those two folders.
- **Nodes 2.0: Load Video and Save Video can be made small.** In the Nodes
  2.0 look, these two nodes could not be dragged shorter than their clip
  drawn at the node's full width. With an upright 9:16 clip, Load Video
  stopped at about 965 px tall where the classic look goes down to 584 px,
  and a workflow saved in the classic look opened with the node drawn over
  whatever sat under it. The node now keeps the size you give it and the
  clip is scaled to fit inside, as in the classic look. Drag the node
  taller to see the clip bigger. The classic look is unchanged.
- **Nodes 2.0: the picture takes the spare height, not the card.** In the
  Nodes 2.0 look, a node with a card on top and a picture below gave half of
  its spare height to the card. The card got empty space under its last row
  and the picture was drawn small. Mask Refine, Mask by Name, Save Image,
  Select Frame and LaMa Inpaint showed it even at their smallest size, and
  Load Video and Save Video once they were made taller. The card now keeps
  its own height and the picture takes the rest, as in the classic look. A
  card that is alone on its node, such as Image Resize, Seed or Workflow
  Switches, keeps its own height there as well. It used to stretch with a
  node made taller.
- **Nodes 2.0: Load Image + Pad shows its picture once.** In the Nodes 2.0
  look the node showed your picture twice: on its canvas, where you drag
  the edges, and again underneath as a plain copy. The copy took the room
  the canvas needs, so the canvas stayed small however tall you made the
  node. With a picture wired in, the copy showed the file the node was not
  using. The copy is gone and the canvas takes the spare height, as in the
  classic look.
- **Nodes 2.0: a node no longer shrinks until its picture is gone.** In the
  Nodes 2.0 look, dragging a node's corner up could squash its picture flat.
  Mask Refine ended with a thin line where the picture should be, Save Image
  lost its saved picture, and Latent Size lost the whole picture you drag to
  set a size. Mask by Name, Select Frame and LaMa Inpaint did the same. The
  drag now stops while the picture still has the room it needs, as in the
  classic look. Image Folder, Image Compare, Show Text and Workflow Note
  stop at their smallest size too; they could be made a little shorter than
  that. With a node's preview switched off, the node still shrinks to the
  small bar. The classic look is unchanged.
- **Save Video: a saved gif or webp shows on the node.** With **Format** set
  to `gif` or `webp`, the file was saved but the node stayed empty and said
  "Execution finished without video metadata". The node now shows the saved
  gif or webp, moving, in the place where it plays an mp4. These two have no
  **LOOP** button, because a gif or webp always loops. In the classic look,
  a saved webp was also drawn a second time as a small picture under the
  node, which made the node taller. That second picture is gone.
- **Load Video: leaving FRAME no longer leaves a clip that cannot run.**
  Picking a frame sets IN to it. If that frame was at or after OUT, the node
  was left with IN after OUT, and the next run stopped with "Load Video
  needs start_seconds smaller than end_seconds" until you moved a handle.
  OUT now moves to the end of the video when you switch FRAME off.
- **Image Resize: pad adds no thin bar when width or height is 0.** In
  Width × height mode with a `0` in W or H, the size follows your picture,
  so only rounding and **Multiple** change it. Pad answered that with a bar
  1 or 2 px wide: a 1000×700 picture with Multiple 16 came out 1008×704 with
  a 2 px bar. The picture now fills that size. The output size is the same
  as before, and with both W and H set, pad fills what is left as before.
- **Workflow Note: Detect from this workflow also reads subgraphs.** It read
  the main canvas only, so a pack used only inside a subgraph was not
  listed.
- **Help pages and tooltips are up to date.** The `?` pages of 32 nodes and
  a few tooltips were brought in line with what the nodes do today.

## 2.7.0 - 2026-10-06

- **New: Mask by Name 🆎** (Mask). Type what to find in a picture, like "the
  dog" or "the red jacket", and get its mask, with nothing to paint. The node
  shows what it found, tinted on the picture, and **FIND** runs only this
  node, so you can check the mask before the rest of the workflow runs. When
  it finds nothing it stops the run with a plain message, so nothing after it
  runs on an empty mask. A setting passes an empty mask on instead. It also
  returns the thing cut out on a see-through background. **More** holds how
  sure SAM 3 must be, **Fill holes**, and **Free VRAM**, which takes SAM 3
  out of the graphics card's memory right after the search. Turn it on in a
  workflow that loads a big model after this node. The search is
  ComfyUI's own SAM 3 (ComfyUI 0.20 or newer): wire model and clip from a
  Load Checkpoint that loads the SAM 3 file.
- **New: Workflow Switches 🆎** (Utility). One small card that turns parts
  of a workflow off and on. Select the nodes of one part, such as a box and
  its Save Image, press **+ Switch**, and they get one off | on switch with a
  name you choose. Every group can have a switch of its own too. Off
  bypasses the nodes, so a step in the middle of a chain can be skipped and
  the picture still reaches the steps after it. A setting mutes them
  instead. A switch can also change settings instead of turning nodes off:
  save what chosen nodes hold for on and for off, and one click sets Steps
  to 8 and turns a LoRA Loader row on. **Done** shrinks the card to the
  labels and their switches, which is the view to share a workflow with. A
  row whose nodes are only partly on reads mixed. The node never runs and has
  no wires.
- **New example: Mask by Name.** Finds a thing by its name and saves its
  cut-out and its mask, with a Workflow Switches card to skip either one.
  It needs only ComfyUI's own SAM 3 file.
- **A file dropped anywhere on a loader node loads into it.** In the classic
  node style, a picture dragged in from your desktop only loaded when you let
  go over the node's title or its sockets. Dropped on the picture or the
  controls, it missed the node and ComfyUI added a separate Load Image node
  for it. Now it loads wherever you drop it on the node. The same goes for
  videos, and for Load Image + Pad, Load Video and both Video Crop + Rotate +
  Pad nodes. Nodes 2.0 already worked.
- **Opening More no longer shrinks the picture.** A node you made taller
  keeps that height when a group such as **More** opens or closes on its
  card: the node grows or shrinks by what the card did, so the picture below
  keeps its size. Before, the node snapped back to its smallest size (Mask
  Refine, Load Image + Pad). A tall node saved with More open also reopens
  at its saved height.
- **Cards show their tooltips again.** Hovering a row on a node's card said
  nothing: the cards looked for the tooltip on the widget, and ComfyUI keeps
  it in the node's definition. Every row of every card now shows its
  tooltip on hover.

## 2.6.4 - 2026-10-05

- **Integer steps by 1.** The arrows and a drag on the Integer node moved
  its value by 8. A Steps box at 25 went to 17, 9 and 1, and could not land
  on 8 without typing it. Select Every Nth, Split Batch, Select Frame and
  Load Video's frame limit did the same. Whole numbers now move by 1. Pixel
  sizes such as width, height and padding still move by 8, with Shift for 1.
  The card had taken any whole number with a wide range for a pixel size.
- **Examples: a note above the boxes says what they hold.** Every example
  workflow tucks its inner steps into two boxes (subgraphs), and nothing on
  the canvas said what was in them. A note now sits right above the boxes,
  such as "These two boxes write the prompt from your image, then paint and
  put your image back. Double-click one to see inside." The Workflow Note
  card drops its own line about the boxes. The group around the boxes grew
  to make room, and the workflows run the same as before.

## 2.6.3 - 2026-10-05

- **Ctrl + Enter also runs the workflow from the boxes in our popups.**
  2.6.2 fixed the boxes on the node itself. Six more still kept the shortcut
  to themselves: the search box in the LoRA picker, the trigger word and
  template name boxes, the boxes in a gear menu, the filter in the picture
  and video picker, and the server file path box on the video nodes. They
  now pass app shortcuts on to ComfyUI too. In a search box, Ctrl + Enter
  only runs the workflow and plain Enter still picks. The Workflow Note
  editor keeps its own Ctrl + Enter, which saves the note.
- **Workflow Note: Use it now covers a LoRA too.** When a file from the
  note's list sits in a subfolder, the note shows where it is and offers Use
  it, which points the loader at it. A LoRA in LoRA Loader never got that
  button: its line only said "installed". The LoRA's line now shows the
  folder and offers Use it as well, and that writes the real path into the
  LoRA Loader row. Nothing was broken before: LoRA Loader finds a file by
  its name when it runs.
- **Workflow Note: Use it picks the file on Windows.** Use it wrote the path
  with forward slashes. Windows lists files in a subfolder with backslashes,
  and a loader only takes a file exactly as it is listed, so the loader
  stayed red. Use it now writes the path the way the folder lists it.
- **Stitch Inpaint takes a picture straight from Qwen Image 2.1's VAE
  Decode.** That VAE gives every picture a fourth, see-through channel
  (RGBA), and Stitch Inpaint stopped with "Inpainted channels (4) do not
  match the cropped image (3)" unless Split Image with Alpha sat in between.
  It now drops that channel when the source picture has none. Other channel
  mismatches still stop with that error.
- **Nodes stop at the width they were built for.** Dragging a node's corner
  to make it narrower used to stop in the wrong place, in one of two ways.
  Several nodes stopped up to 100 pixels too wide: Image Compare A/B would
  not go under 324 pixels although it is built for 220, and Show Text,
  Workflow Note, Crop + Rotate + Pad (image, video and clip), Load Image +
  Pad, Text and Krea 2 Encode did the same. The card nodes went the other
  way: Seed, Save Image, Image Resize and the rest could be squeezed to 210
  pixels, where their buttons and labels were cut off. Every node now stops
  at the width it was designed for (Seed 300, Save Image 340, Crop + Rotate
  + Pad 330, Compare 220, and so on), in the classic canvas and in Nodes
  2.0. Nodes 2.0 itself never goes under 225 pixels, so Compare, Show Text
  and Run Timer stop there. ComfyUI widens a node to its minimum when it
  opens a workflow, so a card you had squeezed below its minimum opens at
  the minimum; the example workflows keep every size they had. Technical
  details: the frontend adds 104 pixels to a growing panel's minimum width,
  and leaves the minimum of a fixed-height card out of its width sum, so the
  node fell to a 210 pixel default. Panels now pass `exactMinWidth` to
  `fillNodeHeight`, or call `holdNodeMinWidth` (both in
  `js/shared/panel_layout.mjs`), and `tests/panel_guards.test.mjs` fails a
  new panel that does neither.
- **Load Video: the IN and OUT times stay whole.** In a narrow Load Video
  the trim row squeezed the IN and OUT boxes until their numbers were cut
  off (even at the default width, OUT lost the edge of its last digit). The
  summary between them, such as "0:04.04 of 0:04.04 · 98 frames", now
  shortens with "…" instead, and the two boxes keep their room.

## 2.6.2 - 2026-10-04

- **Workflow Note keeps the grey line under each model.** Saving any edit
  in the note's editor erased the short note under every model's file
  name, such as "second slot of the text encoder loader". The editor's
  model table now has a Note column, so those lines stay and you can edit
  them. On those notes, Cancel also no longer asks to discard changes when
  you changed nothing.
- **A tab left open through an update now tells you to reload.** Updating the
  pack in Manager restarts ComfyUI but does not reload the page, so the page
  kept running the old AusBoss files and nothing said so. The page now checks
  when ComfyUI comes back and shows "AusBoss was updated" with the one thing
  to do: press F5. The message stays until you close it; it used to go away
  after 30 seconds.
- **Ctrl + Enter runs the workflow while you are typing in one of our boxes.**
  With the cursor in a Text node, a number box, the Seed box or a file name
  box, ComfyUI's shortcuts did nothing: Ctrl + Enter did not queue a run until
  you clicked outside the node. Our boxes now pass app shortcuts on to
  ComfyUI (Ctrl + Enter, Ctrl + Shift + Enter, Ctrl + S and the rest) and keep
  the keys you type and edit with to themselves, as ComfyUI's own text boxes
  do.

## 2.6.1 - 2026-10-03

- **LoRA Loader: Fetch Civitai info is back.** Open a LoRA's info card and
  click the button. Your browser asks civitai.com about that one file and the
  answer is saved next to the LoRA, so its title, base model, trigger words and
  Civitai link show up. Nothing is sent until you click, and the pack's server
  still never contacts anyone. A file Civitai doesn't know, such as an
  unpublished or hidden model, shows "Not found on Civitai". The gear menu has
  a switch to hide the button.
- **Ctrl + Shift drag-zoom works over our nodes with Nodes 2.0 turned on.**
  The mouse wheel already zoomed there, but dragging with Ctrl + Shift held
  did not start over Compare, the crop previews or a card's controls.

## 2.6.0 - 2026-10-03

- **The graph zooms and pans again while the pointer is over our nodes.**
  The mouse wheel did nothing over Compare, the Crop + Rotate + Pad previews,
  the video viewers, or any button or number box on a card, and the Ctrl +
  Shift drag-zoom and the middle-button pan did not start there either. They
  now work everywhere on a node, as they do on the empty canvas. A list or
  text box that can still scroll keeps the wheel until it reaches its end.
- **Round canvas to is now Divisible by, and says what it is for.** On Image
  Crop + Rotate + Pad and both Video Crop + Rotate + Pad nodes, it adds a few
  pixels of fill on the right and bottom so the width and height divide
  evenly by the number you pick. Some models need sizes divisible by 8, 16
  or 32; 1 = off. Saved workflows keep their value: the input is still
  `canvas_multiple`.
- **"Divisible by" boxes step to sizes you can use.** Divisible by, the
  resize Step on the same nodes, and Multiple on Load Image + Pad went 1, 9,
  17, 25 when you clicked the arrows or dragged from 1. They now go 1, 8, 16,
  24 and back down to 1. Shift still steps by 1, and a number you type stays
  as typed.
- **The rotate knob no longer gets stuck upside down.** On the Crop + Rotate +
  Pad nodes, a picture turned to 180° could not be turned back with the knob:
  one way it would not move, and the other way it snapped back as soon as the
  pointer passed straight left of the picture. Turning clockwise through 180°
  also made the picture jump. The knob now turns all the way round, either
  way, and past 180° carries on from -180°. (The pointer's angle flips sign
  left of the centre; it is now followed step by step, and the rotation wraps
  instead of stopping at the ends of the -180 to 180 range.)
- **Crop + Rotate + Pad nodes get corner handles and Centre buttons.** Drag
  one of the four new orange corners to make the canvas bigger or smaller and
  keep its shape, for example to zoom out before an outpaint. Before, that took
  four separate drags. Hold Alt (Option on a Mac) to grow or shrink all four
  sides at once. Two **Centre** buttons, next to Fill and Feather and in the
  editor's Padding section, put the picture in the middle side to side or top
  to bottom without changing the canvas size. Works on Image Crop + Rotate + Pad
  and both video nodes, on the node and in the editor. The rotate knob moves
  aside where a corner handle now sits. Saved workflows and the node inputs
  are unchanged.
- **Image Crop + Rotate + Pad shows the mask you draw.** After you paint a
  mask with Open in MaskEditor and press Save, the picture on the node now
  updates and shows the painted parts in teal. Before, it kept showing the
  old picture, so you could not tell a mask was there. The teal moves with
  the crop, the turn and the padding, and the full editor shows it too.
  See-through parts of a PNG show the same way. A new gear on the image
  source box turns the teal off. In the editor, Show blend now includes the
  painted parts.
- **Latent Size gives Qwen Image 2.1 the size you set.** With its latent
  wired straight into the sampler, a Qwen Image 2.1 picture came out twice as
  wide and twice as tall as the size on the node. It now comes out at the
  size shown, and other models are unchanged. (The latent now says how far it
  is downsampled, like ComfyUI's own empty-latent nodes, so ComfyUI can fit
  it to a model that packs pixels differently.)

## 2.5.2 - 2026-10-02

- **After an update, old files in your browser can no longer break AusBoss.**
  In Firefox, a page could keep running files from before an update even
  after Ctrl+Shift+R, so nodes lost their preview bar, card or editor until
  the browser's cache was cleared. Every update now gives the pack's files
  new addresses, so the browser always fetches the new ones. Restart ComfyUI
  and reload the page once; there is nothing to clear. (The server adds a
  version tag to the pack's own script imports as it serves them; the files
  on disk are unchanged.)
- **Stitch Inpaint's fill-color advice stays in the console.** A flat area
  can be intentional, so this check no longer opens a warning popup. If
  the image looks right, you can ignore the console message.

## 2.5.1 - 2026-10-01

- **Manager search finds AusBoss by its repo name.** Searching for
  `ComfyUI-AusBoss` or `AusBoss nodes` found nothing; only `ausboss` worked.
  The listing now uses those names too.
- **After an update, AusBoss no longer half-loads.** After updating the pack
  in Manager, some nodes could lose their card, editor or settings until the
  page was force-reloaded, because the browser kept using old copies of some
  files. The pack now asks the browser to check those files every time. A page
  that is already running old files shows "AusBoss was updated" with the
  one thing to do: press F5.

## 2.5.0 - 2026-09-30

- **See-through pictures now outpaint properly.** A product cutout with no
  background, a photo with see-through round corners, or a picture with a
  hole in it could come back on flat gray, or with a dark ring round the
  picture. Image Crop + Rotate + Pad now treats the see-through parts like
  the padding: they are filled, the mask marks them, the model paints them,
  and Stitch Inpaint never puts them back. A new last output,
  `prompt_image`, shows those parts as white. Wire it to whatever writes
  your prompt, so the prompt describes a real backdrop instead of the gray
  fill. The Krea 2 Outpaint and Krea 2 Rotate + Outpaint examples are wired
  this way. The `original` output also shows see-through parts as white
  instead of black, which fixes the Klein 9B Outpaint prompt as well. A part
  counts as see-through when it is less than 90% solid. Pictures without
  such parts come out exactly as before.
- **Save Image, Select Frame, Mask Refine and LaMa Inpaint keep their size in
  Nodes 2.0.** They grew to fit the picture they showed and covered the node
  below them, and after a run the picture showed twice. Now it fits inside
  the node, as in the classic view.
- **Nodes 2.0: undo no longer leaves a node showing its old settings.**
  After Ctrl+Z or Ctrl+Y, what you change on an AusBoss node reaches the run.
- **Workflow Note grows to fit its text.** A note saved a few pixels too
  short no longer hides its last row behind a scrollbar, and it can't be
  dragged shorter than its text. It never shrinks by itself.
- **Stitch Inpaint: Tone match now works with Seam set to blend in.** An
  outpaint can come back a little lighter, darker or warmer than your
  picture, and blend in used to keep that colour. With Tone match on, blend
  in now checks how the model repainted the strip of your picture next to
  the new area and takes that change back off the new area. It follows any
  edge, turned or straight, keeps blacks black, and leaves the colours alone
  when the change doesn't hold up along the edge. Blend in with Tone match
  at 0 stitches exactly as before, and the classic seam is unchanged.
- **Stitch Inpaint says when the new area comes back unpainted.** When an
  outpaint returns with plain bars or corners in the fill colour, a message
  and a console line say how much of the new area was left and what to
  try. It also catches a gray fill handed back a few shades darker, as
  Krea 2 can do. Painted pictures stay quiet, dark ones too.
- **Krea 2 outpaints now paint dark and colourful pictures too.** With the
  AnyPaint LoRA, a dark or very colourful picture could come back with its
  new area still gray: a gray frame around the picture, or a gray corner on
  a turned one. The model was copying the gray padding instead of painting
  it, whichever Krea 2 model file was loaded. Krea 2 Encode has a new
  `mask` input. Connect the pad node's mask to it, and the model sees the
  new area in your picture's own colour, the way AnyPaint was trained, and
  paints it. The Krea 2 Outpaint and Krea 2 Rotate + Outpaint examples are
  wired this way. They also feather the join 32 px instead of 12, which
  gives the model room to carry your picture over the edge: a thin strip of
  new area no longer comes back as a flat band with a hard line. Workflows
  without the link run exactly as before.
- **Pressing Run before loading a picture now says so.** When a picture or
  video loader has nothing picked (core Load Image and Load Video, Load
  Image + Pad, Image Crop + Rotate + Pad, Load Video and the Video Crop +
  Rotate + Pad nodes), the run stops before it starts, one message reads
  "Load a picture first:" with the node's name, and that node gets a red
  outline. Before, core Load Image started the run and failed with
  "[Errno 21] Is a directory". Loaders that are bypassed, muted, fed by a
  link or not needed by any output never stop a run, and runs sent
  straight to ComfyUI's API are not checked.
- **One problem, one error.** A missing picture on Image Crop + Rotate +
  Pad used to show "20 errors", the same message once per setting. Each
  AusBoss node now reports a problem once, on the setting it is about.
  The same fix lets ComfyUI check these nodes' values again: a number out
  of range or a choice that isn't offered is caught before the run instead
  of partway through it. A crop ratio from someone else's presets still
  runs, and uploads, subfolders and MaskEditor saves still load.
- **"No mask painted" instead of a size error.** Krea 2 Inpaint Masked,
  and any workflow that sends Load Image's mask to Crop For Inpaint, Mask
  Refine, Color Match or LaMa Inpaint, stopped with "Mask size (64, 64)
  does not match image size" when no mask was painted or a new picture was
  picked after painting one. It now says: "No mask painted: right-click
  your picture, choose Open in MaskEditor, paint the area, then click
  Save." LaMa used to hand the picture back unchanged in that case.
- **Save Video: the NVIDIA formats explain themselves.** Picking "mp4 h264
  nvenc" or "mp4 h265 nvenc" without an NVIDIA GPU now says those formats
  need one and to pick "mp4 h264" instead, rather than a bare encoder
  error.
- **Load Video and Video Crop + Rotate + Pad → Clip check the trim window
  when they run.** A start after the end, or Fixed frames longer than the
  video, is reported by the node as it loads the video, where a trim bound
  fed by another node has its real value.
- **Clip timeline: the bar always scrubs.** With Length on, as the LTX 2.3
  Video Outpaint example opens, dragging along the bar did nothing and IN
  would not move, with no word why. Now pressing or dragging anywhere on the
  bar moves the playhead, Length on or off. To move the whole clip, drag IN
  or the small grip in the middle of the kept part. When the Length already
  takes the whole clip, the Length row says "= the whole clip. Shorten it to
  move IN."
- **Preview switch: on again brings the picture back.** On Mask Refine,
  LaMa Inpaint, Select Frame and Save Image, turning the preview off and on
  again left an empty box and a shorter node until the next run. Now the
  node goes back to its height with the last result in it. If the node ran
  while the preview was off, the box says to run the workflow again instead
  of showing an older picture. Mask Refine's AUTO button now says what it
  does when you hover it.
- **Crop + Rotate + Pad: the padlock you can see and trust.** Reset and
  tapping the lit ratio turn it off. On the untouched picture it does
  nothing, so trimming there only trims. While it is on, the row says
  **Held**, new bands split evenly on both sides, and **Reset crop** also
  removes the bands it added. The lit ratio and the lock now look like every
  other "on" in the pack (solid teal), and hovering a button only outlines it.
- **Crop + Rotate + Pad: nothing added when there is nothing to add.** A
  picture or clip within about 1% of a ratio counts as that ratio, so a
  nearly 9:16 photo no longer gets a 1 px band. When the lit ratio is
  already the picture's shape, the size line under the picture says so
  ("already 9:16: pick another ratio or turn it"), instead of letting you pay
  for a render that paints nothing. A lit ratio saved in a workflow still
  applies to every new picture, and the size line names it where it acted
  ("pad to 16:9 1821×1024").
- **Crop + Rotate + Pad: the resize warning in plain words, with a fix.** It
  read "2.2% wider from steps". Now it says "2.2% wider: each side rounds to
  32 px", its tooltip names a Step that avoids it, and with Fit on pad an
  **Even out** button adds a few pixels of padding so the picture is not
  stretched at all.
- **Crop + Rotate + Pad: added space is easy to see.** Padding and the
  corners a turn opens are drawn in the real fill colour with a faint hatch,
  so black bands show on the black stage, and only the picture the crop cuts
  away is darkened. The round rotate knob keeps clear of the padding
  diamonds on wide canvases.
- **Crop + Rotate + Pad: controls that say what they need.** **Fit** is dimmed
  and says "pick a ratio first" until a ratio is lit. Over the picture, the
  cursor and small arrows show only the ways it can move.
- **Crop + Rotate + Pad: the full editor uses the node's controls.** Its
  sidebar has the node's ratio row, padlock and Fit switch instead of a list,
  a checkbox and two buttons. The rotation is a number box you can drag
  (Shift for 0.1°) instead of a slider that turned 57° for a 9 px nudge. The
  size box stays clear of the handles, and the number boxes look like the
  node's.
- **Crop + Rotate + Pad: big nodes stay tidy.** On a wide node the controls
  stop at 460 px, centred, and only the picture grows. A wide picture picked
  into a node sized for a tall one shrinks the picture area to fit it; the
  node never grows for a new picture, so it never covers the node below.
- **Clearer names on the Crop + Rotate + Pad nodes.** Align is **Round
  canvas to**, Snap is **Frames for** with LTX (8n+1), Wan (4n+1) and any,
  and Local path is **Server file**. Resize is an off | on switch like the
  pack's other switches, and **To start** and **Full clip** look like the
  buttons they are. Saved workflows are unchanged: only the words moved.
- **Compare: A and B follow the split line.** The A | B badge stayed in the
  middle while the line moved. Now A sits just left of the line and B just
  right of it.
- **Number boxes: Shift slows whole-number boxes.** On boxes like Feather,
  whose smallest step is already 1, Shift changed nothing. It now slows the
  drag, so Shift always means fine.
- **Workflow Note: models kept in a subfolder.** The note said "installed"
  while a loader asked for the bare file name, which ComfyUI could not find
  and marked red. Such a row now says where the file is ("in LTXV 2.3/")
  and a **Use it** button points those loaders at it.
- **A run from another workflow tab stays on its own tab.** ComfyUI files
  each node's result under the node's number, so when a run from one tab
  finished while you had another tab open, its video or picture turned up
  on the open tab's node with the same number. On a Video Crop + Rotate +
  Pad node it showed as a second video under the buttons and covered the
  node below. Now the Crop + Rotate + Pad nodes never show a second
  preview, AusBoss nodes ignore results from other tabs (Show Text and Seed
  no longer save another workflow's text or seed), and when you go back to
  the tab that ran, its Save Video, Show Text, Compare and other AusBoss
  panels show that run. Core nodes behave as ComfyUI has them.
- **Save Video and Compare keep their result when you switch tabs.** Go to
  another workflow tab and back, and the player said "Run to preview the
  saved video" (Compare: "Run to load the A/B previews") over a result it
  had just made. They show it again.
- **Nodes 2.0: Save Video shows the clip once.** It also drew ComfyUI's own
  copy of the clip under its player.
- **Crop + Rotate + Pad: the ratio buttons say what the canvas is.** A lit
  ratio is the shape the canvas has now. Drag a handle to another shape and
  it goes dark, the row says Custom, and the size line gives the real ratio
  (`1.49:1`); before, 16:9 stayed lit on a 1889×1280 canvas. Tap a ratio to
  pad to it, tap the lit one to go back to the whole picture. Keeping the
  shape while you drag is its own padlock button at the end of the row,
  instead of a second tap on the ratio. The button at the start turns the
  shape between portrait and landscape (16:9 to 9:16) and never throws away
  your crop; with nothing picked it only turns the ratio labels. Crop or
  pad is now a small **Fit** switch, so it no longer looks like a ratio.
  Rotating keeps a lit ratio, a ratio you tap before loading a picture is
  used when you load one, and dragging the picture itself moves it inside
  its padding.
- **Crop + Rotate + Pad: the editor uses the node's words.** Its Multiple
  and Steps are Round canvas to and Step, as on the node.
- **Crop + Rotate + Pad: the picture on the node stays big enough to see.**
  You can no longer drag the node so short that the preview becomes a
  thumbnail: the picture keeps at least three fifths of its width in
  height (200 to 340 px), and a new node opens that way. The "Choose an
  uploaded video" line under the picker goes away once you pick one, so the
  picture gets that room too. A workflow saved with a shorter node opens
  with it a little taller, and the LTX 2.3 Video Outpaint example is laid
  out for the new size. In Nodes 2.0 the node also stops at the width its
  buttons need instead of squeezing them.
- **Crop + Rotate + Pad: picking the first file in the list starts fresh.**
  In a workflow saved with no file picked, like the examples, picking the
  first file in the list kept the rotation, crop and padding the workflow
  was saved with, which were made for a different picture. Any other file
  already started over. Now the first file does too, and it is padded to
  the ratio that is lit on the node. This goes for the image node and both
  video nodes.
- **Mask Refine: Fill holes can leave the part you kept alone.** Paint
  everything except a person or a pet, turn on **Fill holes**, and it
  filled them in too, so the part you meant to keep was painted over. The
  new **Max hole size** sets the biggest hole Fill holes fills, as a percent
  of the picture. At 2, the small gaps a quick brush leaves still fill, and
  a person, pet or object you left unpainted stays. It starts at 0, which
  fills every hole as before, so saved workflows run the same.
- **The red "missing file" warning clears when you pick a file.** Open a
  workflow that was saved with a picture you don't have and ComfyUI marks
  Load Image + Pad red and lists it under Setup required. Picking your own
  picture in the node used it, but the red box and the warning stayed on,
  even though the workflow ran. They now clear as soon as you pick a file.
  Every control on the node cards now tells ComfyUI when you change it, so
  its own checks stay in step with what you set.
- **Crop For Inpaint: workflows saved before 2.4.0 now open with Stay in
  picture on.** In 2.4.0 most of them opened with the switch off and kept
  the old crop, the one that runs past the picture's edges, while the same
  workflow sent through the API ran with it on. Both now get the new crop,
  as the 2.4.0 notes said they would. Turn the switch off on the node for
  the old crop. A switch you set yourself keeps its setting.
- **Fewer example workflows.** The examples are down to the seven that
  show what these nodes do that core ComfyUI doesn't: outpainting and
  inpainting that put your original picture back, lining an edit back up
  with its source, and removing a watermark from a clip. They are Krea 2
  Outpaint, Krea 2 Inpaint Masked, Krea 2 Rotate + Outpaint, Klein 9B
  Outpaint, LTX 2.3 Video Outpaint, Qwen Image 2.1 Edit + Realign and Simple
  Video Watermark Remover. Krea 2 Inpaint Masked and Krea 2 Rotate + Outpaint
  are new.
- **The example workflows open with their loaders empty.** Every image and
  video loader in them is saved with no file picked, so you load your own
  picture or clip. The pier photo and the pier clip are still in
  `example_workflows/inputs/` if you want to try one first.
- **Krea 2 Outpaint example: the padding follows your picture.** The
  example now pads with Image Crop + Rotate + Pad instead of Load Image +
  Pad. Pick a ratio or drag the orange handles, and the padding fits
  whatever image you load; before, it was saved in pixels for the sample
  picture. The prompt is written from the padded picture.
- **Saved workflows keep only the nodes' own settings.** Each node card and
  panel used to save an empty value of its own, and a setting added to a
  node in a later version could open holding it. That is how Stitch
  Inpaint's Seam and Crop For Inpaint's Stay in picture went wrong in older
  workflows. Workflows you save now leave the cards and panels out, and
  workflows saved before still open exactly as they did.
- **Workflows from the 1.x versions open with the right switches.** In LaMa
  Inpaint, Mask Refine and Select Frame the preview switch showed on, but no
  preview was made. It now opens on and works. LoRA Loader's settings showed
  Stop on missing LoRA off, even though the node still stopped the run. It
  now shows on, matching what the node does.
- **The other examples got the same smaller layout.** Klein 9B Outpaint,
  LTX 2.3 Video Outpaint, Qwen Image 2.1 Edit + Realign and Simple Video
  Watermark Remover now have named groups for your input, the models and
  the result, with the plumbing in two boxes. Node titles use the real node
  names, so you can find them in the node search.
- **Simple Video Watermark Remover needs no other node pack.** It finds the
  mark with ComfyUI's own SAM 3.1 (ComfyUI 0.20 or newer) instead of
  ComfyUI-RMBG, so there is nothing extra to install and no 3.45 GB
  download on the first run. On the sample it also stopped painting out a
  tram's number plate next to the mark.
- **Klein 9B Outpaint example: no second face on tight portraits.** Its
  automatic description used to describe the person, and Klein then painted
  them a second time under the join. It now describes only the setting. The
  padding follows your picture, as in Krea 2 Outpaint.
- **Examples no longer carry the sample's turn and padding.** Krea 2
  Outpaint and Krea 2 Rotate + Outpaint open with an empty loader but still
  saved the sample's padding and turn, and the first file in your input
  folder could pick them up. They now save none. Krea 2 Outpaint opens with
  no ratio picked, so your picture isn't padded until you choose one.
- **Krea 2 Inpaint Masked example: Stay in picture is on.** The example had
  it saved off, so a big painted area was cropped past the picture's edge
  and painted smaller and softer.
- **Krea 2 Inpaint Masked example: the person you keep stays.** Paint
  everything around a person or a pet to give them a new background, and
  the example used to paint over them too. Its Mask Refine now has Max hole
  size at 2, so brush gaps still fill and what you left unpainted stays. The
  note also says to paint right up to what you keep, and to change one
  thing per run.
- **Klein 9B Outpaint example: the seam blends in.** With the classic seam,
  the new area's blacks could come back a hazy gray-green, and a turned
  picture could show a line along its edge. The example now uses blend in
  with Tone match. Its note says a big pad can grow a second hand or face,
  and that the result is about 1.6 MP.
- **Qwen Image 2.1 Edit + Realign example: the edit changes only what you
  ask for.** Its prompt writer could widen a request: "remove the photos
  from the wall" also took the fridge handle and the magnets. It now keeps
  everything the request doesn't name. A transparent PNG's see-through
  parts are filled with gray before the edit, instead of coming back black.

## 2.4.0 - 2026-09-29

- **Load Video accepts a wired start or end time.** Connecting another
  node (such as Math Expression) to Load Video's start or end time made the
  whole graph fail to queue with an error. It now queues and runs. A wired
  time that turns out to be bad still stops the run with a clear message.
- **Stitch Inpaint: a Seam choice for outpaints.** On a turned or padded
  outpaint, the join between your picture and the new area could show a
  lighter band and a smeared strip. Set the new **Seam** to **blend in** to
  fade the model's picture into yours instead: it hands over a little way
  inside your picture, where the two already line up, and leaves the new
  area exactly as the model painted it. On seven Krea 2 outpaints the colour
  step at the join shrank by 85 to 95%. It is the pick for turned pictures
  and for outpaints with Tone match off; with straight padding and Tone
  match on, classic usually looks as good. Seam sits in the gear menu in the
  card's corner, so the node keeps its size. With blend in on, Tone match and
  Fix edge halo dim, since blend in does not use them, and a **blend in**
  chip shows beside the gear. **classic** stays the default, so saved
  workflows render exactly as before, and Crop For Inpaint stitchers still
  paste the classic way.
- **Krea 2 Outpaint no longer promises inpainting.** Its Workflow Note and
  the Krea 2 Outpaint Model Patch help page said you could paint over part
  of the picture with the mask editor and pad at the same time. That does
  not work: Load Image + Pad does not take a painted mask. Both now say the
  workflow only extends the picture outward.
- **Krea 2 Outpaint Model Patch help: Crop For Inpaint wants `whole
  canvas`.** The page said a Crop For Inpaint stitcher spreads the reference
  over the full frame. On `source rectangle` the reference is pinned to
  where the crop sat in the full picture instead, so the page now says to
  pick `whole canvas` with one.
- **Crop For Inpaint keeps its crop inside the picture.** When the painted
  area was big, or the picture small, the crop could reach past the
  picture's edges, and the extra space was filled with stretched copies of
  the edge pixels. On a portrait with the coat painted over, only 42% of
  what the model saw was the picture, and the new jacket was drawn at about
  half size, then scaled back up. A new **Stay in picture** switch, on by
  default, stops the crop at the edges instead. In 8 test renders with wide
  masks the new area came out sharper every time (28-80% more fine detail),
  and a "tall window" request that the padded crop turned into more
  bookshelves came out as asked. Saved workflows whose crop ran past the
  picture now render a little differently; switch it off for the old crop.
- **Resolution Master is now called Latent Size.** That name already belongs
  to another node pack, so this node gives it back. Only the name changed:
  saved workflows and API graphs load and run as before, because the node's
  id (`AUSBOSS_NODES_Resolution`) is the same. A node you gave your own title
  keeps it; a title that starts with "Resolution Master 🆎" gets the new name
  in its place. The example is now `Latent Size (AusBoss).json`.
- **Latent Size can be resized.** Drag its corner to make it wider or
  taller, so it lines up with the nodes around it. The controls stretch with
  it, and the canvas preview takes any extra height. It still opens at its
  usual size, and it can be as narrow as 320 pixels.
- **LoRA Loader: a choice for long names.** Gear menu → **Long names**:
  `end` (the default, as before) cuts a name that does not fit at the end;
  `middle` cuts the middle instead, so the checkpoint number at the end
  (`…_000004000`, `…_epoch_10`) stays readable in a narrow node. The picker
  now opens wide enough for long names, and when one still does not fit it
  shortens the folder first and keeps the end of the file name.
- **LoRA Loader goes narrower.** Touching its corner used to make it jump to
  424 pixels wide, and it could not be made narrower than that. It now goes
  down to 320 pixels (392 with separate model and CLIP strengths). The
  frontend adds 104 pixels to a panel's minimum width when it works out how
  narrow a node may go; these two nodes now take that back off.

## 2.3.0 - 2026-09-27

- **Run Timer no longer slows the whole canvas (#77).** Once the readout held
  a time, its glow ran a blur filter on the graph canvas three times a frame,
  and Chrome pays for each as a pass over the entire canvas: a test graph
  dropped from 60 fps to about 17 while panning. The glow is now painted into
  a small layer only when the digits change and copied every frame, so the
  readout looks the same and the canvas stays at 60 fps.
- **LoRA Loader accepts a LoRA file that is a link.** A LoRA kept on another
  drive and linked into `models/loras` was refused as "escapes the loras
  folders" and then reported missing, which stops the run in a workflow
  set to stop on a missing LoRA. The check now reads the path as written, so
  a linked file loads as it does in ComfyUI's own loaders, and a name that
  climbs out of the folder with `..` is still refused.
- **Qwen Image 2.1 Edit example: the consistency LoRA.** Qwen Image 2.1
  restyles often come back about 4-5% taller and shifted off the source's
  frame. The example now loads the Qwen Image 2.1 Consistency LoRA
  (`ausboss/Qwen-Image-2.1-Consistency-LoRA` on Hugging Face) in a LoRA
  Loader between the diffusion model and the reference cache: step 1500 is
  on, and the tighter step 2000 file is one switch away. Over 36 held-out
  restyles the worst corner moved 24.3 px (median) without it and 1.6 px
  with it. The Loader stops the run when the file is missing instead of
  quietly rendering plain Qwen 2.1; switch its row off to run without it.
  The Workflow Note lists both files, and the picture beside the example is
  a new render with the LoRA.
- **New node (experimental): Realign to Source 🆎.** Lines an edited
  picture back up with the original. Qwen Image 2.1 often draws edits,
  especially style changes, slightly zoomed in or shifted, by a different
  amount every seed. The node measures how far the edit moved and moves it
  back. For the best result, pad the picture with Load Image + Pad's new
  `mirror` fill before editing and plug its `stitcher` into the node: the
  edit gets room to move, and you get your picture back with real picture
  all the way to the edges. `report` says how far the edit had moved, and
  `empty_mask` marks any strip that slid off the edge. Tested on 166 Qwen
  2.1 edits: style edits went from 35.5 px off at the worst corner to 4.6 px
  (median). With a 64 px mirror margin, 1 of 16 edits kept an empty strip,
  against 13 of 16 without one. New example: **Qwen Image 2.1 Edit +
  Realign**. Type a short edit like "make it a soft watercolor painting",
  and Qwen3-VL 8B, the text encoder the edit already loads, writes the full
  instruction before Qwen edits a padded copy and Realign lines it back up.
- **Load Image + Pad: a `mirror` fill.** Flips the picture outward at every
  edge, so the padding looks like more of the scene. It is the best margin
  before an edit you realign: Qwen Image 2.1 zoomed in to fill a mirror
  margin on 2 of 16 edits, against 7 with edge-pixel padding and 5 with
  flat gray. Saved workflows keep their fill.
- **Settings menus no longer overlap in short windows.** When a node's gear
  menu was taller than the window allowed, its rows were squeezed and the
  descriptions ran into each other. The menu now scrolls instead. This
  affects every node's gear menu.
- **LTX 2.3 Video Outpaint example: LoRA Loader 🆎.** The distilled LoRA
  and the outpaint IC-LoRA now load in one LoRA Loader 🆎 instead of two
  core loaders, with the same files and strengths.
- **Load Image + Pad takes a wired image.** A new optional `source_image`
  socket pads an image from another node instead of the chosen file, so a
  step before it (putting a transparent picture on white, say) no longer
  has to be saved and loaded back. The Source row dims while it is wired,
  and the on-node canvas shows the last image it padded. Saved workflows
  load unchanged: the socket is appended and has no widget.
- **Editors can be closed without saving.** The Crop + Rotate + Pad editor
  (image, video and clip) gains a **Cancel** button beside Save & close, and
  Escape now cancels instead of saving. When something changed, Cancel asks
  first, and Discard puts the node back exactly as it was when the editor
  opened. The Workflow Note editor asks the same before Cancel, Escape or a
  click outside throws edits away, and a JSON edit carried back to the form
  no longer survives a Cancel.
- **Save Image: a preview switch, and plainer wording.** The saved picture
  now sits in the pack's preview panel with the same small `PREVIEW` switch
  as Select Frame and Mask Refine; off, the picture goes away and the node is
  shorter (the file is saved and listed in the queue either way). The
  Workflow row now reads **Embed workflow: no | yes**.
- **The Qwen3-VL caption steps keep Text Generate's thinking on.** Krea 2's
  text encoder is Qwen3-VL-4B-Instruct, which has no thinking mode; with
  thinking off, ComfyUI appends an empty think block and the model often
  stops at once, so Krea 2 Prompt from Image could write nothing. Krea 2
  Prompt from Image, Krea 2 Outpaint, Klein 9B Outpaint and both MiniMax H3
  image workflows now keep it on, and the Krea notes say why.
- **Seed: switching to Random rolls a new seed right away.** The mode
  only rewrites the seed after a queue, so the first queue after
  switching from Fixed used to repeat the last run and ComfyUI returned
  the cached result. Switching from Fixed to Step takes the first step
  the same way; flipping Step's direction leaves the number alone.
- **Source lists preview the file under the pointer.** Load Image + Pad,
  Load Video and the crop / rotate / pad editors replace the browser's plain
  drop-down, where you picked by filename alone, with a list that shows the
  hovered picture or plays the hovered clip (muted, with its size and
  length) and filters as you type. Arrow keys, Enter and Escape work too.
  The saved value is still the node's own `image` / `video` widget.
- **Crop + Rotate + Pad: feather softens the mask only.** Image Crop +
  Rotate + Pad and both Video Crop nodes also faded the picture into the
  fill colour, unlike Load Image + Pad. Outpaint models read that ramp as
  content: the Qwen 2.1 outpaint LoRA painted a darker band along a tilted
  edge, and LTX's IC-LoRA left feathered black bars unpainted. The stitcher
  kept the faded pixels too, so Stitch's colour match measured its drift
  against them and pulled the fill toward grey (colour error 3 → 18 on a
  straight pad at feather 24). The picture now keeps a hard edge against
  the fill at any feather; the mask, and the stitch blend built from it, are
  unchanged. Saved workflows with feather above 0 get a hard-edged `image`.
- **Stitch Inpaint's tone match no longer pulls a rotated outpaint toward
  the fill colour.** On a Crop + Rotate + Pad canvas that was rotated and
  padded (a canvas multiple's few extra pixels count), `color_match` read
  the rotation's empty corners as picture and shifted the whole fill, by
  up to 33 dE on a flat test. It now reads only picture pixels at each
  seam. Load Image + Pad and Crop For Inpaint stitch exactly as before.
- **Load Image + Pad no longer adds a strip along an edge you did not
  pad.** Rounding the canvas to Multiple put the leftover on the right and
  bottom whatever you padded, so the published Krea 2 Outpaint workflow
  (top and bottom padded, Multiple 16) grew a 6 px grey strip down the
  photo's right edge. Krea painted it flat and lighter, the feather opened
  the photo beside it to the sampler, and Stitch Inpaint's color match read
  the strip as a seam and darkened that band. The leftover now joins a side
  you padded (the right or bottom one when both are). Where you padded
  neither left nor right, or neither top nor bottom, a Budget scales the
  photo onto the multiple instead, keeping its shape, and without a Budget
  the photo loses those few pixels evenly from both edges; the node's
  canvas shows them as −N px. Saved workflows can come out slightly
  different: with only the left or top padded, the photo sits up to one
  multiple minus a pixel further right or down (15 px at 16, 63 px at 64);
  with a pair of edges unpadded, that side can be one multiple smaller
  without a Budget, and with one the photo's scale shifts a little, which
  can move either side by a multiple or so. The shipped examples pad every side and
  are unchanged. Crop + Rotate + Pad keeps the old rule for now.
- **Image Crop + Rotate + Pad: `stitch_blend` and `stitch_grow`.** The
  stitcher's blend was fixed at 32 px; it now has the clip node's two
  optional inputs (defaults 32 and 0), and the editor shows the same
  Inpaint & Stitch section with Show blend.
- **Crop + Rotate + Pad: rotating keeps the crop.** The crop keeps its size
  and stays over the same part of the picture, from the knob, the editor's
  slider, its number box and Reset rotation alike. The slider used to throw
  the crop away (a centred 1:1 crop jumped to the top), and the knob slid it
  off the picture as the canvas grew.
- **Crop + Rotate + Pad: the size explains itself.** A line under the picture
  names every step that sets the output size (`crop → pad → align → resize`),
  warns when the resize Step stretches the picture by more than 1% and when
  Align pads a strip of fill ahead of a resize, and the editor's panel lists
  the same steps. Ticking Resize on the node now shows the resize **Step** next
  to the megapixel budget.
- **Crop + Rotate + Pad: exact aspect sizes.** A crop at a locked ratio no
  longer loses a pixel to rounding (21:9, 9:21, source), so the size shown on
  the node always equals the run. A few saved crops come out 1 px larger.
- **Image Crop + Rotate + Pad: API prompts saved before the resize inputs
  existed validate again**; the four resize inputs are optional.
- **Video Crop + Rotate + Pad → Clip: one way to set the length.** The Fixed
  frames and Limit boxes are gone from the node face. OUT ends the clip, and a
  **Length** switch (off by default) sets it by a frame count instead: OUT then
  follows IN at that distance and the count survives a video swap. OUT always
  sits on the last frame the run outputs (Every nth and Snap included), where
  Limit used to end the clip short of it. Connecting `fixed_frames` or
  `frame_load_cap` hands the length to that input: the OUT handle goes away and
  only IN is left to set. No inputs changed; saved Limit values read as a
  Length, and an old Fixed frames value becomes one on the first edit.

## 2.2.0 - 2026-09-24

- **Save Image and Save Video save to the output folder itself by
  default** (`image_...`, `video_...`) instead of an `AusBoss` subfolder,
  and the example workflows save without a folder too. Saved workflows keep
  whatever prefix they already have.
- **The pack makes no network requests.** LoRA Loader's Civitai lookup is
  removed: the info-card button, its gear-menu switch and the server route.
  A `.civitai.info` sidecar already beside a LoRA, from an earlier lookup or
  another tool, still fills in the title, base model, Civitai trigger words
  and model link. The lookup's hash cache,
  `ComfyUI/user/ausboss/lora_hashes.json`, is no longer used and can be
  deleted.
- Recreate node and Replace with AusBoss nodes create links through one
  shared helper that calls LiteGraph's `connectSlots` directly: the same
  checks and callbacks as before, without the index-based connect call that
  the Registry scan reads as a network socket. Release preflight fails when
  shipped code contains an HTTP or socket client, or that connect call.

### Video

- Load Video, both video transform nodes and their previews count time from
  the video stream's first frame. Transport streams (`.mts`, `.m2ts`,
  `.mpg`) and MP4s whose video starts late loaded the wrong window or no
  frames at all; seeks now start from a keyframe, and audio stays in step
  with the picture.
- Video Crop + Rotate + Pad → Frame gains the megapixel resize the image
  and clip nodes have, as optional inputs so older API prompts still run,
  and both it and Image Crop + Rotate + Pad append `width` and `height`
  outputs.
- The three Crop + Rotate + Pad faces share one set of controls: a canvas
  row with fill colour, feather in pixels and the resize budget where the
  node has one, and Open editor | Reset crop | Reset. The image node's
  feather was an on/off box and had no fill colour; only it had a full
  Reset. Reset clears rotation, crop and padding and keeps fill, feather
  and Align.
- The video transform panels no longer vanish when the graph is zoomed out.
- Dropping an AusBoss-saved video on Load Video restores its trim and
  sampling values again; current frontends' own upload handler had taken
  the drop.
- Select Every Nth takes an optional `fps` and appends an `fps` output
  divided by nth, so a thinned clip keeps its duration.
- Stitch Inpaint no longer fails when a video model returns fewer frames
  than the stitcher holds (LTX keeps 8n+1).
- Save Video honours ComfyUI's `--disable-metadata`, and shows its CRF and
  Metadata rows only for the formats that read them.

### Image, mask and LoRA

- Load Image + Pad has a Reset padding button on its stage.
- Save Image: with `on_existing` set to error, the whole batch is checked
  before any file is written. Editing a legacy exact name no longer
  overwrites the filename prefix, the Browse popup no longer closes itself
  and closes on Esc, and Embed workflow is an off | embed pill like every
  other boolean on a card.
- LoRA Loader: a row skipped because its file is missing adds no trigger
  words (rows parked at strength 0 still do). Every number is a scrub
  control, including the gear menu's default strength and step and the
  info card's suggested range, which can be left at "any". The gear menu's
  Reset no longer folds separate CLIP strengths into the model strengths,
  and row edits enter undo history.
- Krea 2 Encode's tooltips and help describe both outpaint setups: VLM
  reference on for AnyPaint, off for Registered Outpaint.

### Pack-wide

- Replace with AusBoss nodes keeps the saved settings of missing nodes;
  current frontends give their placeholders stand-in widgets that it read
  instead, so every replacement started from defaults.
- Clicking a node's **?** badge no longer starts a drag; Run Timer, which
  has no title bar, has **About this node** in its menu.
- Copy buttons report a blocked clipboard instead of a false success (plain
  http on a LAN address has no clipboard API), and Show Text gets one.
- Messages that used a blocking `alert()` or only the console are toasts.
- Errors name the node you are using: Save Video, the Clip node, Stitch
  Inpaint and the padding nodes no longer borrow another node's name.
- Gear menu resets keep the settings that belong to the node itself.
  Compare's mode and Mask Refine's AUTO enter undo history.
- The optional live status and runtime badges sit above the left end of
  the title bar, clear of the frontend's own node-source badge.

### Examples

- Three new examples. Video Reframe and Slow Motion and Dataset Frames from
  a Clip need no models; LaMa Object Removal needs only `big-lama.pt`.
- The node tour and the watermark remover take the other examples' naming:
  `Video Node Tour (AusBoss)` and `Simple Video Watermark Remover (AusBoss)`.
- Loaders select the official file names from their download links and
  carry matching download info, so a fresh install finds every model the
  Workflow Note lists. The caption encoders link the Qwen3-VL 8B file they
  load, SAM3 Segment names ComfyUI-RMBG, and six LoRA Loaders save their
  missing-file rule.
- Krea 2 Outpaint turns VLM reference back on, the AnyPaint recipe its note
  describes, and works on a 1.6 MP canvas budget like Klein 9B Outpaint. At
  full size a big photo's canvas (4 MP) painted its new sky darker, creased
  at the corners and cut invented limbs at the old edge. The node tour thins with Select Every Nth and carries the rate
  through it.
- Every example has a valid id, opens at a zoom that draws widget text,
  drops other tools' leftover metadata, stores its named widget values in
  agreement with the loaded ones, and stops promising audio from the silent
  sample clip.

### Repository

- README: install through ComfyUI-Manager or comfy-cli, a corrected upgrade
  note, working commands for the optional extras, the pack-wide tools, and
  links to the changelog, contributing guide and security policy. Help
  pages that had drifted from their nodes are corrected, and the 1.2.0
  changelog heading is back.
- The Registry archive leaves out the README media (14 MB to 7 MB), and the
  preflight lists the real archive and holds it to a size budget.
- Publishing happens only when main's version changes, after the offline
  checks pass. Pull requests also run the standard-library Python tests, a
  JavaScript syntax check and ruff.
- A node API snapshot test fails when a released input or output is
  renamed, reordered, removed or newly required.
- Add SECURITY.md, CONTRIBUTING.md, issue and pull request templates,
  `.editorconfig` and `.gitattributes`; remove a finished checklist that
  was committed with 2.1.0 and two dated review reports.

## 2.1.0 - 2026-09-22

- LoRA absorption preserves repeated applications and upstream → stack →
  downstream order. Shared MODEL/CLIP paths, used auxiliary outputs, a bypassed
  destination or linked stack values leave the original loaders untouched.
- Rename the editor’s Reset all action to Reset transform and explain which
  settings it keeps. Keep the selected video frame during a transform reset
  so the picture and timeline stay in agreement. Document the Clip node’s original-frame output in README.

- Video Clip: add Fixed frames for an exact-length selection. Drag either
  handle or the highlighted band to move both ends together. Duration follows
  output fps; frame/audio counts stay aligned. Existing frame caps retain their
  maximum-limit behavior. Too-short sources report the required duration.

- Refresh related examples: Krea/Klein Outpaint and both image-guided H3 graphs
  describe their sources with tested Qwen3-VL caption paths. Krea reuses its
  own text encoder; Klein and H3 list the extra caption model download.
  Setup cards explain manual prompts and Krea's caption sampling settings.
- LTX Outpaint captions the unpadded original frame. H3 First + Last Frame
  no longer hardcodes the ending timestamp. Krea Studio includes LoRA trigger
  words, the LoRA Stack example saves a prompt sidecar, and the transform
  example compares results against the new original outputs.

- LoRA Loader: refresh restored rows when widget values arrive after node
  configuration, including undo, without switching workflow tabs.
- Video transform uploads stream into the input folder instead of buffering
  through the image-upload endpoint, allowing files over 100 MB.
- All Crop + Rotate + Pad nodes: add Crop / Pad mode, crop-only ratio locking,
  Reset crop, and pixel alignment on the node face. Image and frame nodes
  append stitcher and original outputs; the clip node appends original frames.
- Image Resize: new nodes start in megapixels mode; saved modes are retained.

- Add Qwen Image 2.1 Text to Image and Edit examples with numbered stage
  groups, model download cards, AusBoss size and seed controls, and PNG
  saving. Text to Image includes an empty optional LoRA stack; Edit uses
  source-matched Qwen conditioning and a before/after comparison.

- Video Crop + Rotate + Pad → Clip: distinguish source and output fps in
  the trim footer, including a connected numeric rate and Every nth.

- LoRA Loader: separate single-row removal from a red, trash-marked
  Delete all LoRAs action with confirmation. LoRA files are never deleted.

- LoRA Loader: absorb rgthree Lora Loader Stack and JPS Lora Loader nodes
  on either side of the connected model chain. Preserve disabled JPS rows
  and rgthree's linked strengths; refuse linked settings or an overflowing
  stack before bypassing the source loaders.
- Video Crop + Rotate + Pad → Clip: add optional `force_rate`, `start_frame`,
  `end_frame`, and `frame_load_cap` sockets. Connected frame bounds lock the
  matching timeline handle; a connected cap locks Limit. Rate conversion
  drops or repeats frames while preserving playback timing.
- Image Resize: add compact W/H labels beside the paired size fields.

- LTX 2.3 Video Outpaint example: disable Stitch Inpaint color matching,
  which can spread moving seam content into flickering dark or light bands
  across the generated area. Source restoration and blending remain on.
- LoRA Loader: right-click a row to insert an empty LoRA slot above or
  below it, preserving the order and settings of the existing stack.

## 2.0.2 - 2026-09-10

- The LoRA loader validates the SHA-256 used in its fixed Civitai URL and
  refuses redirects, so the lookup cannot follow another host.
- The completion chime is a small WAV generated in memory and played
  through an audio element, preserving the sound without WebAudio graph
  connections or a bundled audio asset.
- **Save Image writes only inside ComfyUI's output folder.** `output_dir`
  used to take any absolute path, so any client that can reach the
  unauthenticated `/prompt` route could make the server write an image and a
  caption `.txt` of its choosing into any folder ComfyUI can write,
  overwriting by default - one step from code execution through a custom
  node's `requirements.txt`. `output_dir` now takes a subfolder name inside
  the output folder, like ComfyUI's own Save Image; absolute paths, drive
  letters, `~` and `..` are refused before the run, and the card's path
  preview says so as you type. Workflows that saved into an absolute folder
  need a subfolder name instead.
- **Local path mode reads only ComfyUI's input, output and temp folders.**
  The 2.0.1 `AUSBOSS_TRANSFORM_LOCAL_PREVIEW` switch that opened the rest of
  the disk is gone; a refused path says where the video has to be.
- Save Image checks the complete image and caption destinations, and Save
  Video checks both the prefix and final file, rejecting symlinks that lead
  outside the output folder. Windows drive and alternate-stream syntax is
  rejected before filesystem access.

## 2.0.1 - 2026-09-09

- **Local path mode is opt-in beyond ComfyUI's folders.** The video
  transform nodes' `local_path` used to be read by every queued run, which
  means any client that can reach the unauthenticated `/prompt` route could
  make the server open any video on the disk. By default the mode now reaches
  only ComfyUI's input, output and temp folders, for queued runs and editor
  previews alike; starting ComfyUI with `AUSBOSS_TRANSFORM_LOCAL_PREVIEW=1`
  restores full-disk access on that server. Nothing else in the pack reads a
  path or contacts a host taken from a widget.
- **Video timeline overhaul (Video Crop + Rotate + Pad → Clip / → Frame).**
  The rail under the node's preview is now a real timeline: press or drag it
  to scrub a **playhead** on the node face, no editor needed, and the frame
  picker's face got the same rail for its output frame. IN and OUT are
  frames on the source's grid (the boxes take frame numbers; the stored
  seconds are derived and resolve back to exactly those frames), the
  playhead rides on a dragged handle so the stage shows the first or last
  frame the run keeps and stays there on release, and the bright part of
  the selection is what reaches the output after the frame limit and Snap.
  The editor's slider is replaced by the same rail, plus **Set IN / Set
  OUT** buttons and **I** / **O** keys. The Snap select no longer clips at
  the node's minimum width.
- **Scrubbing no longer flickers.** The storyboard tile only stands in
  while it is nearer the target than the frame already on the stage (with
  one keyframe per clip it used to be frame 0 on every pointer move), and
  storyboard tiles are now decoded at their target times instead of the
  keyframe before them. Two backend fixes: asking the scrub session for the
  frame it already decoded returned the frame after it, so every drag
  release landed one frame late; and served preview frames are kept in a
  small cache so revisiting a region costs no decode.
- **Swapping the clip no longer breaks the canvas.** Choosing another video
  used to reset the fill to grey, the feather to 24 and clear the padding -
  silently, since none of those showed on the node - which is precisely what
  the LTX outpaint LoRA cannot work with. A new source now keeps fill,
  feather, the resize budget, Snap and Limit, and is padded to the lit
  format chip; only rotation, crop and the trim window start over. Both
  video nodes also gained a canvas row under the format chips (fill swatch,
  feather, resize budget), so those values are visible and editable on the
  node face. A fresh clip node now starts outpaint-ready - black fill,
  feather 0 - and the editor's **Reset all** returns to the node's own
  defaults instead of the grey, feathered canvas the image nodes keep.
- **Aspect lock.** Tapping a lit format chip locks the format (padlock on
  the chip); crop and padding drags then keep the canvas at that aspect
  with the other axis's padding following, and a padding handle stops
  where the other axis would have to go negative. A third tap clears the
  bands and the lock. **Lock aspect** in the editor's Crop section is the
  same switch.

## 2.0.0 - 2026-09-07

- **Breaking: LM Studio Chat is removed.** The Registry identified an
  unrestricted server-side request through its workflow-controlled endpoint.
  The node, HTTP helper, frontend, help page, and tests are removed. Existing
  workflows using `AUSBOSS_NODES_LmStudioChat` must replace that node; a Text
  node can supply a fixed prompt where live chat is unnecessary. Other public
  mapping keys remain unchanged.
- Added Resolution Master, Seed, Workflow Note, Run Timer, and Video Crop +
  Rotate + Pad → Clip, alongside 15 organized example workflows.
- The README now includes eight visuals using actual editor screenshots and
  tested renders, including an animated video outpaint comparison.
- Release PRs now run offline validation and frontend tests in Actions. A
  separate Registry approval check reports the exact version's status and
  review reason after publishing, with manual rechecks that do not republish.

- Klein 9B Outpaint now samples the encoded padded image through a noise mask and uses a 64 px feather. Controlled comparisons showed a cleaner seam than the previous empty latent and 24 px feather; Stitch Inpaint still preserves the protected source exactly.
- Completed the public-pack readiness review: grouped README sections cover every public node; all example graphs have setup notes, stage groups, and matching thumbnails. Added the model-free Image and Video Transform example for both editors and Align Image. Corrected installed model selections, literal line breaks in the LoRA example note, card-driven layout overlaps, and the tour's sample and timing instructions.
- Load Image + Pad now uses a widget card for source/upload, fill, feather, alignment, and budget, with individually linkable exact padding controls. Text uses a growing multiline card, and Krea 2 Outpaint Model Patch exposes both reference placement and KV caching in its card.
- The watermark example keeps SAM3 detection while removing rgthree presentation helpers and the Easy Use frame-count display. Its setup card names ComfyUI-RMBG, and SAM3 unloads between branches to leave GPU memory for LaMa.
- Release preflight now checks saved links in both directions, stage containment, title-bar overlaps, and setup-note formatting. Backend tests have a process-isolated runner so ComfyUI stubs cannot leak between test files.

- **LoRA Loader 🆎** now stops on a missing LoRA by default: an enabled row whose file cannot be found fails validation before sampling with an error that names the file and says where the switch is, instead of warning and rendering without it — what scripted and agent-driven runs need. Gear menu → **Stop on missing LoRA** (API input `on_missing`, `"error"` by default or `"skip"`) restores the old warn-and-skip behaviour per node; graphs saved before the input existed get the default.

- Added rendered MiniMax H3 Text to Video and First + Last Frame examples, plus a model-free Resolution Master example. Corrected H3 duration rounding to never undershoot the requested seconds. Tested and corrected the Klein PixaOutpaint prompt and conditioning; the protected source interior remains pixel-exact.

- **Resolution Master 🆎** joins the public pack: an explicit orientation toggle, ratio chips, canvas handles, sub-1 MP budgets and an empty latent output. Corrected zoomed drags, bounded extreme ratios, linked-axis controls and restore behavior; removed the external font request.

- **Five new showcase workflows.** `Klein 9B Inpaint` (a painted mask
  through Mask Refine 🆎 and Crop For Inpaint 🆎, Klein 9B edits only that
  crop, Stitch Inpaint 🆎 puts it back), `Klein 9B Edit` (Image Resize 🆎
  sets the 1 MP working size and Image Size 🆎 keeps the output the
  source's shape), `Klein 9B Outpaint` (Load Image + Pad 🆎 on any side at
  once, PixaOutpaint in the LoRA Loader 🆎, a padded reference and masked
  Flux 2 starting latent),
  `MiniMax H3 Image to Video` (Image Resize 🆎 to H3's 768 px canvas,
  Float 🆎 + Math Expression 🆎 for the model's 17k+5 frame grid, the turbo
  LoRA model-only, Save Video 🆎 with the model's own audio) and `Krea 2
  Prompt from Image` (core Text Generate on the Krea 2 text encoder, Show
  Text 🆎, the prompt wired into Krea 2 Encode 🆎). Each opens with a
  Workflow Note 🆎 and ships a thumbnail; a masked copy of the sample
  picture joins `example_workflows/inputs/`. Every node in the pack now
  appears in at least one example, including the node tour.

- **Krea 2 outpaints on every side at once.** The `Krea 2 Outpaint`
  example is rebuilt around yijunwang2's **AnyPaint** LoRA
  (`krea2_anypaint_rank32`). The old one-axis rule was never a Krea 2
  limit: the patch's registered placement is the contract of the same
  author's Registered Outpaint LoRA, which was trained on a source spanning
  one whole canvas axis - and the shipped example did not load that LoRA at
  all. AnyPaint is trained the other way round: the grey-padded canvas is
  the reference, spread over the whole frame, and the sampler's noise mask
  keeps the known pixels, so left, right, top and bottom can grow in one
  pass. Krea 2 Outpaint Model Patch 🆎 gained an optional `placement`
  input for it - `source rectangle` (the default, the old behaviour) or
  `whole canvas` - and its help page explains which LoRA wants which.
  Saved graphs load unchanged.

- **Outpaint seams: no more dark band, no more corner diagonals.** A
  four-side outpaint used to show a faded band along the source's edges
  and 45° lines running out of its corners. Measured on the pier sample:
  the model paints the new area a few percent off the source's tone on
  every side (fill colour makes no difference), the feathered sampler mask
  smears that step into the band inside the source, and the pad feather
  merged its per-side ramps with a maximum, whose iso-lines crease at the
  corners and print as diagonals. Stitch Inpaint 🆎's `color_match` now
  reads the drift ACROSS each seam - the generated pixels just outside
  against the original pixels just inside, line by line - instead of
  inside the mixed band, and blends the sides by distance instead of
  picking the nearest, so the correction turns the corner smoothly and the
  band gets exactly the share the sampler gave it. Load Image + Pad 🆎's
  feather (and every stitcher built from it) now unites its ramps instead
  of taking their maximum: identical along a side, bilinear in the corner.
  Both outpaint examples run with `color_match` 1 again; their seam steps
  drop from 2-6 % to under 1 % of luminance.


- **Video Crop + Rotate + Pad → Clip 🆎.** The transform nodes' third
  member: one rotate, crop and pad applied to every frame of a trimmed
  video, with Load Video's `start_seconds` / `end_seconds`, `every_nth`
  and `max_frames`, and the same outputs (frames, the window's audio,
  frame count, fps, size, duration) plus the generated-area `mask` — so a
  clip can lose a border or a tilt, or grow the black bands a video
  outpaint paints into. It shares the frame picker's editor (the timeline
  picks the preview frame; scrubbing never re-runs the clip) and gains the
  image node's megapixel resize, which the editor now shows for any node
  that carries those widgets. Frames go through the transform in chunks
  with the queue's progress bar and cancel serviced between them. It also
  emits a **stitcher** (a ninth output, after the existing eight) built from
  the final resized frames, so Stitch Inpaint pastes the source back over a
  generated clip without a Crop For Inpaint node; the editor's right sidebar
  gained an **Inpaint & Stitch** section - blend ramp, a stage overlay of
  where the paste lands, and grow behind a disclosure - kept separate from
  the padding feather. The feathered paste mask is now one shared helper
  for every stitcher producer. A **Snap** select on the trim strip
  (`frame_snap`: free / 8n+1 / 4n+1) drops trailing frames to a count the
  video model keeps, so `frame_count`, the audio window and the stitcher
  match the clip that comes back; the showcase workflow wires the clip's
  size and count into the empty latent and snaps at 8n+1.

- **Transform nodes: drop a video, pad to a format in one tap, a sharp
  preview at any zoom, trim without losing the playhead.** A video file
  dropped onto Video Crop + Rotate + Pad (frame or clip) uploads and
  becomes the source, as core's upload widgets do for their nodes. A row of
  format chips right under every transform preview (16:9, 9:16, 1:1, 4:3
  ...) pads the whole source to that aspect with centered fill bands - the
  editor's Pad to aspect without opening it; the lit chip clears it again.
  The node preview's backing store now follows the graph zoom (up to 4x),
  so zooming in on the node no longer shows a blurry, pixelated stage.
  Dragging an IN/OUT handle now peeks at the frame under the handle and
  returns to the playhead on release, instead of moving the scrub bar and
  the saved preview position along with the trim.

- **Stitch Inpaint takes a shorter generated batch.** A stitcher built
  from more frames than came back is trimmed to the leading ones with a
  console note instead of failing after the run - video models keep 8n+1
  or 4n+1 frames and drop the tail. More inpainted frames than source
  frames is still an error.

- **Save Image redesigned as one card.** Folder with a Browse into the
  output folder, Filename, a live path preview that turns into the first
  file written after a run, the name tags as chips - Counter (on, the next
  free number for that stem, never a collision), Date, Time, Size and
  Batch # - PNG / lossless WebP (new) / lossless JXL pills, and an Embed
  workflow switch. Two link-only inputs: `filename` takes the exact name
  from upstream (its image extension swapped for the chosen format's, a
  blank value stops the run rather than inventing a name) and
  `caption_text` writes the paired .txt. The old widgets stay underneath in
  their saved order, so existing workflows load as they were and a legacy
  `exact_name` shows in the field tagged *exact*. Local names lose core's
  trailing underscore (`shot_00001.png`, not `shot_00001_.png`); numbering
  restarts at 00001 beside the old files without touching them.

- **Align Image drops its offset outputs.** `offset_x` / `offset_y` were
  never wired in practice; the node stops at image, width, height. A saved
  workflow that linked them loses those two links.

- **Select Frame, Mask Refine and LaMa Inpaint previews can be switched
  off.** A thin bar sits between the settings and the picture - the node's
  tools (Mask Refine's AUTO) on the left, a small `preview` switch on the
  right. Off, the picture's box is gone and the node is that much shorter;
  the switch stays where it was, and the node writes no file to the temp
  folder (a new optional `preview` input carries the choice).

- **Units live inside the scrub box** (`px`, `MP`, `×`), ahead of the
  chevrons, and every single-field row in a card reserves the same slot
  for one whether it has a unit or not, so the numbers down a card share
  one centre line - a `px` no longer nudges its number left of the row
  above.

- **Widget cards: the classic canvas widgets are gone from every node
  face.** Image Resize, Color Match, Stitch Inpaint, Crop For Inpaint,
  Mask Refine, Save Image, Save Video, Load Video, Align Image, Frame
  Interpolate, Math Expression, Select Every Nth, Split Batch, Select
  Frame, Merge Batches, Integer, Float, LaMa Inpaint, Krea 2 Encode and
  the Krea 2 Outpaint Model Patch now carry one compact card in place of
  the full-width rows with an arrow at each end: numbers are the pack's
  scrub control, short choices a segmented pill, long ones a select,
  booleans an off | on pill as wide as the other controls, hex colors a
  swatch. Rows that only mean something in
  one mode (a resize target's size, a pad color) show in that mode; the
  rarely-touched settings fold behind one disclosure (Crop For Inpaint's
  targets and extend, Save Image's exact-name and folder, Mask Refine's
  More). The widgets underneath are untouched - saved workflows, the API
  format and widget-to-input links work as before, and a row driven by a
  link dims out. Shared in `js/shared/widget_card.mjs`.

- **Links still land on card rows.** The frontend only draws a widget's
  input socket while a link is being dragged or once it is connected, at
  the widget's own place - which a hidden widget no longer had. Each row
  now lends its position to the widget it stands for: drag a link over a
  card and a socket appears beside every row that can take it, drop it on
  the row (the socket, the label or the field itself) and that widget is
  driven by the link, exactly as with the classic widget. One socket per
  row, so no row holds two linkable fields: Image Resize's width and
  height, Frame Interpolate's two rates and Save Video's fps and crf keep
  their side-by-side layout but their sockets sit with the node's inputs
  (under `image` / `mask`), where a link greys the field out like the old
  converted input; Crop For Inpaint's target and extend values, Mask
  Refine's levels and Load Video's size and every-nth / limit are single
  rows now, one socket each.

- **Math Expression: `a`, `b`, `c` are sockets.** The three values arrive
  on the node's left edge and take a `FLOAT` or an `INT` (an image width
  wires straight in); the card is the expression alone. An unwired value
  reads as 0. A workflow that had typed a constant into `a`, `b` or `c`
  should carry it in the expression instead - those boxes are gone.

- **Krea 2 Encode is one card.** The prompt, the negative prompt and the
  VLM reference switch sit in a single panel; the prompt box takes the
  node's spare height when it is dragged taller. The node is unchanged
  underneath: a plain two-prompt encoder without a VAE and reference, and
  an edit/outpaint encoder with them (checked both ways on a Krea 2 turbo
  render).

- **A node that loaded shorter than its new card grows on load.** A
  workflow saved before a card or the preview bar existed kept the old
  node height, which squeezed the panel under its floor and clipped it
  flat (LaMa Inpaint's preview box); the node now takes at least the
  height its widgets ask for.

- **LoRA Loader: the bar scale follows the enabled rows.** Switching a
  row off hands the shared strength scale to the strongest row still in
  play; the dimmed row's own bar clamps at the edge meanwhile.

- **Workflow Note 🆎: the card for sharing a workflow.** A big title, a
  Markdown how-to, the models the workflow needs with Download buttons
  grouped under the `📂 ComfyUI/models/<folder>` they belong in, the node
  packs it depends on, and the author's links — the note every shared
  workflow carries, without a second pack. Every model file and node pack
  on the card is checked against the install that opened it (teal dot and
  an *installed* pill when found, subfolders included; red dot and the
  Download button when not), so the person who downloaded the workflow
  sees what is left to do before the first run. A pencil opens the
  editor (form or raw JSON; *Detect from this workflow* fills the pack
  list from the open graph); the Banner layout turns the same node into
  a title label. Stored as JSON in one STRING widget; rendered as text,
  never HTML; only http(s) URLs become links.

- **Seed 🆎: the seed that remembers what ran.** One INT wire, one
  card: the number (click to type, ⧉ copies), a Random / Fixed / Step
  segment that drives the sampler's own after-generate control, and the
  buttons a run needs — New seed rolls and pins one, Use last run puts
  back the seed the last run actually used (reported by the backend, so
  it is right even after Random has already advanced the box) and pins
  it, ▾ lists the last eight. The history saves with the workflow.

- **Run Timer 🆎: a stopwatch for the whole queue.** One black readout
  with no title bar, no pack badge, no wires and no padding — the node
  is the display, painted by the node itself on the classic canvas, so
  it drags from anywhere and resizes by the corner with the digits
  scaling along (a DOM panel stands in under the Nodes 2.0 renderer).
  Starts on `execution_start`, ticks, holds the total at the end (amber
  while running, teal done, red failed); the last time saves with the
  workflow and the right-click menu lists the few before it.

- **Stitch Inpaint: `color_match`.** An outpaint often comes back a step
  lighter or warmer than the picture it extends, and the seam shows even
  when the content continues perfectly. The new 0..1 control measures
  that drift in the feathered band — where the sampler's pixels and the
  true pixels overlap, so it reads the model's own shift rather than
  comparing unrelated content — per padded side and per line along the
  seam (sky and water drift differently), smoothed — and pulls the
  pasted region back onto the original's tone before the blend. Source
  pixels stay bit-identical. Off by default; the outpaint showcase ships
  with it at 1.

- **Panels hide their storage widgets under Nodes 2.0 too.** The Vue
  renderer ignores the classic canvas collapse and filters widgets on
  its own `options.hidden` flag, so the Seed card, the Workflow Note, the
  LoRA loader and Load Image + Pad all showed their raw storage widget
  above the panel there. The shared hide helper now throws both switches.
  Run Timer's Nodes 2.0 fallback also drops the renderer's 225px minimum
  width and its footer badge, so the readout stays the whole node.

- **The Registry archive stops shipping the workshop.** A documented
  `.comfyignore` keeps tests, offline scripts, CI and the developer docs
  out of the published zip (comfy-cli's packer honours it),
  which also removes the test fixtures the Registry scanner kept flagging.
  `release_preflight.py` now checks the file covers those paths and never
  swallows a runtime one, parses every example workflow, and pairs each
  thumbnail with its workflow; the stale thumbnail generator is gone.

- **Showcase workflows** in `example_workflows/`, four graphs on
  ComfyUI core plus this pack and nothing else. **Krea 2 Studio**: draft,
  then refine - the plain Krea 2 Turbo draft goes through a learned 4x
  upscaler, Image Resize lands it on a 2.3 MP budget, and a second
  KSampler repaints it at denoise 0.15 with the same prompt and seed
  (measured against plain resize, learned-only, pixel-pass and
  latent-upscale routes on a portrait, a tarot illustration and a street
  scene: 0.12-0.2 is clean, 0.3 speckles skin, latent upscale is worst);
  Color Match keeps the draft's tone, a gentle core sharpen finishes,
  Compare A/B shows final against draft, and every stage bypasses on its
  own (each combination verified to execute); about 15 s on a 5090. An
  **LTX 2.3 video outpaint** that turns a 9:16 clip into 16:9 - the clip
  node pads the black bars an outpaint IC-LoRA paints new scene into,
  core LTX nodes only (`LTXV Add Guide` + `Get IC-LoRA Parameters`, no
  Lightricks pack), then Stitch Inpaint puts the original frames back
  from the clip's own stitcher with `color_match` and Save Video keeps
  the clip's audio; about a minute for 97 frames at 1280×704 on an RTX
  5090, with a 9:16 sample clip in `example_workflows/inputs/`. Plus the
  Krea 2 one-axis outpaint and a Krea 2 text-to-image with the LoRA
  Loader, each with a matching preview JPG and `properties.models`
  download metadata on the loaders so ComfyUI's own missing-model check
  offers the files too.

## 1.3.0 - 2026-08-31

- **LoRA Loader: strength bars you can grab.** Every named row paints a
  center-zero bar behind its name — teal right of center for positive model
  strength, muted red left for negative, a brighter cap at the value's edge —
  on one shared scale (the stack's largest magnitude, floored at 1.0) so the
  everyday 0..1 range reads absolutely and one strong row rescales the whole
  stack instead of clipping. The name is also a scrub surface: drag it to
  change the strength, bar riding along; a plain click still opens the
  picker. Both have gear-menu off switches.

- **LoRA Loader: absorb the loader chain.** A gear-menu action walks the
  model chain on both sides of the node and lifts every recognized loader —
  core `LoraLoader` / `LoraLoaderModelOnly`, rgthree's Power Lora Loader,
  Pixaroma's loader, another AusBoss loader; Reroutes walked through — into
  the stack, appended below your existing rows in chain order, then
  bypasses the originals, so an old
  workflow's loader daisy-chain collapses into one node without changing
  what the graph computes. Names resolve against this install's list,
  duplicates are skipped not doubled, a fan-out stops the downstream walk,
  and a row imported with unequal model/CLIP strengths flips that node into
  separate-strengths mode so the difference stays visible.

- **LoRA Loader: moved and missing files just work.** A row whose file
  moved folders resolves by name at run time (exact → unique
  case-insensitive path → unique basename, one console note) and shows a
  dashed border naming the file the run will use; a genuinely missing LoRA
  warns once and skips its row instead of failing the whole run, and
  validation no longer blocks the queue over a missing file. The bar's new
  reconnect button — and ComfyUI's own R refresh, quietly — re-checks the
  list and rewrites repaired rows in place. Thumbnails, the info card, and
  range lookups all use the resolved name.

- **LoRA Loader: row awareness.** Rows show just the file name by default
  (full path in the tooltip, folders kept in the picker; gear switch to
  restore), and any LoRA loaded on two rows wears an amber duplicate ring —
  same basename under different folders is deliberately not flagged, since
  the stack would truly load both files.

- **LoRA Loader: the master pill remembers.** It now cycles mixed → all on
  → all off → back to the mixed setup it destroyed; every hand-made row
  toggle refreshes the memory, so an accidental master click is always one
  more click from home.

- **LoRA Loader: the control bar rides the slot band.** The
  templates/master/reconnect/gear cluster moved up into the empty middle of
  the output-slot band, cutting ~52px of dead space from every node; slot
  dots stay wirable beside it. The add button is now **+ LoRA** and lives
  inside the stack container, pinned to its bottom edge. Strengths are
  unified by default on every new node — the separate-strengths switch is
  per-node and no longer leaks into the stored default.

- **The README stops advertising a stale release.** The front-page badge
  said 1.0.0 through two releases; it is now a dynamic shields.io badge
  that reads the version out of `pyproject.toml` on main at view time, so
  it can never go stale, and `release_preflight.py` gained a third check
  that keeps it the dynamic kind (a hardcoded badge fails preflight). The
  README also names the real ComfyUI-floor key (`requires-comfyui`).

- **Image Crop + Rotate + Pad: resize the output to a megapixel budget.**
  A new resize block (off by default) scales the transformed result to a
  pixel budget with core Scale Image to Total Pixels semantics — megapixels
  × 1024², aspect preserved, each dimension rounded to `resolution_steps` —
  using the chosen filter (lanczos, area, bicubic, bilinear, nearest-exact);
  the mask always resizes bilinear so feathered edges cannot ring. The big
  editor gains a Resize output section and its status names the exact
  resized size; appended after the stable V1 widgets, so saved workflows
  keep loading.

- **Image Crop + Rotate + Pad: a quick row under the canvas.** Reset
  (rotation, crop, and padding in one click), a Feather on/off that
  remembers the amount it turns off, and the Resize toggle with its
  megapixel box — the everyday knobs without opening the editor.

- **Image Crop + Rotate + Pad: the size readout moved off the pixels.**
  The output dimensions now sit centered just below the image (flipping
  above when the bottom edge leaves the stage) instead of overlapping the
  corner of the picture being judged, and they show the resize target too:
  `576 x 1024 → 768 x 1344`.

- **Scrubbable numbers become a pack standard.** The LoRA loader's strength
  box grew into a shared control (`js/shared/scrub_input.mjs`): drag the
  value to scrub it, click to type an exact value, chevron arrows step,
  Shift is always the fine step. First adopters are the Image Crop + Rotate
  + Pad megapixel boxes (quick row and editor) and the editor's resolution
  steps; new numeric fields use it by convention.

- **LoRA Loader: drag-to-reorder actually drops now.** The row preview
  reparents the row mid-drag, and a reparent silently releases pointer
  capture — so the pointerup never landed, the drop never committed, and the
  row rode the cursor until a re-render snapped it back. The gesture now
  listens on the window for its whole lifetime instead of trusting capture.

- **LoRA Loader: step arrows on every strength box.** A third way to set a
  strength next to scrubbing and typing: small up/down chevrons step by the
  configured step (default 0.05); Shift steps by 0.01. Out-of-range tinting
  and the suggested-range tooltip carry over to the new box.

- **LoRA Loader: layout matches the hand.** The templates, stack toggle,
  on-count and settings now sit together in one bordered cluster directly on
  top of the row stack, and **+ Add LoRA** is pinned to the node's bottom
  edge, where it stays however tall the node is dragged — the row stack
  flexes in between. The third output was renamed `trigger_words` →
  `triggers` for a narrower slot label; output links ride slot indices, so
  saved workflows reconnect unchanged.

- **LoRA Loader: Civitai lookup actually completes.** The fetch read the
  response with a single `StreamReader.read(n)`, which returns whatever the
  buffer holds — the first ~1KB TCP chunk — not the full body. A real hit is
  ~150KB of JSON, so every successful lookup died mid-parse as "Civitai
  lookup failed" while only the 404 path worked. The body is now accumulated
  to EOF with the size cap enforced per chunk.

- **LoRA Loader: calmer picker hover.** Moving the mouse down the LoRA list
  used to rebuild the whole list on every row crossed — repositioning the
  popup, blinking the hover thumbnail, and risking the click landing on a
  detached row. The highlight now moves by class swap only.

- **Fixed the clipped flat edge under the LoRA stack — and the same latent
  bug pack-wide.** The frontend mounts every DOM widget's element inside a
  ~10px frame, so the element gets ~20 fewer CSS pixels of height than the
  layout allocates; the LoRA panel demanded its exact pixel sum with only
  10px of slack, so the stack's rounded bottom border was clipped flat on
  every render. The panel now follows the node's height (`fillNodeHeight`)
  with a floor that carries the frame allowance — now a shared
  `WIDGET_FRAME` constant — and the same allowance fixed Load Video's trim
  strip (clipped by 22px at minimum height) and Compare's caption row
  (shaved by 2px). The Video Crop + Rotate + Pad fallback panel also gained
  the width guards every other panel already had.

## 1.2.0 - 2026-08-27

- **New: Replace with AusBoss nodes 🆎 (prototype).** A canvas-menu and
  command-palette action that finds third-party nodes in the open workflow —
  missing-node placeholders and installed types alike — and offers to swap
  the ones this pack can stand in for: VHS Load Video/Video Combine, KJNodes
  ColorMatch and GrowMaskWithBlur, LayerStyle LaMa, and the easy/Derfuu
  image-size nodes. Nothing changes silently: a preview lists every
  candidate with a per-node opt-out, widget values translate across (VHS
  format ids to Save Video 🆎 formats, KJ color methods to lab/mkl/histogram,
  frame trims to seconds where the rate is known), and anything that cannot
  carry losslessly is flagged in the preview instead of guessed — a
  frame-index trim without a known fps stays at the default with a "check
  trim" note. Each swap remaps links by declared name/slot mapping, rolls
  back on failure, and the whole apply is one undo step. Nodes with no
  equivalent (model loaders, WanVideo pipeline nodes, controlnet
  preprocessors) are listed with the reason they are refused; multi-node
  swaps are declared but wait for phase 2. The map and its widget
  translators live in `js/shared/replace_map.mjs` under node:test coverage.

- **New node: Image Resize 🆎.** The single most common reason a shared
  workflow drags in a heavy pack, as one dependency-free node: target an
  exact width+height, a longest or shortest edge, a megapixel budget, or a
  scale factor, then stretch, fit, cover-crop, or pad when the aspect
  changes — pad fills with a color and marks the new bars as 1.0 in the
  mask output, the pack's usual generated-area contract. `divisible_by`
  snaps the result to a clean multiple (16 for WAN), 0 in a size widget
  keeps the source, an optional mask rides through the identical
  transform, and resampling is lanczos (PIL, in float), bicubic, bilinear,
  nearest, or area.

- **Added the Utility group** — nine small nodes for the gaps that used to
  mean installing a 200-node pack for a text box: **Text 🆎**, **Integer 🆎**
  and **Float 🆎** (typed constants on their own wires), **Show Text 🆎**
  (shows the string it receives on the node face — selectable for copying,
  saved with the workflow — and passes it through), **Math Expression 🆎**
  (arithmetic over a/b/c with FLOAT and INT outputs, parsed with `ast`
  against a whitelist and never `eval`'d, so a shared workflow cannot
  smuggle code through it), **Select Every Nth 🆎**, **Split Batch 🆎** and
  **Merge Batches 🆎** (IMAGE-batch thinning, splitting and joining, with an
  explicit resize policy instead of a silent one when sizes differ), and
  **Free Memory 🆎** (a wildcard passthrough that unloads comfy's models and
  empties the CUDA cache between heavy stages — every step fail-soft and
  imported at run time, so a core API move skips the step instead of
  deleting the node).

- **Video I/O polish: format-aware Save Video, drop-to-restore, an honest
  Load Video label.** Save Video's face now follows the chosen format —
  `crf` hides for `mov prores`, `mkv ffv1` and `gif`, which ignore it, and
  `save_metadata` hides for `gif` and `webp`, which cannot carry it; hidden
  widgets keep their position and value, so saved workflows are untouched
  and switching back restores the number. Dropping a video onto a Load
  Video node (as opposed to onto empty canvas, which still restores the
  whole embedded workflow) makes it that node's source — copied into the
  input folder, identical re-drops reusing the existing file — and an
  AusBoss save also restores the trim, `every_nth`, `max_frames`, sizing
  and FRAME values its embedded workflow stored. And since the preview
  cannot re-render frame drops, its label now reports what one Run will
  actually load — `0:04.0 of 0:10.0 · 48 frames @ 12 fps`, or
  `1 frame at 0:05.2` in FRAME mode — computed from the source's probed
  frame rate with `every_nth` and `max_frames` applied, and omitted rather
  than guessed when a deciding value arrives over a link.

- **LoRA Loader: rows drag to reorder.** Every row grew a dotted grip; drag it
  and the stack shuffles live under the pointer, committing to the serialized
  widget only on drop — an abandoned drag never dirties the workflow. LoRAs
  apply in row order, so order is part of the recipe; the right-click Move
  up/down items remain for one-step moves.

- **LoRA Loader: hover thumbnails on rows, not just in the picker.** Hovering
  a row's name floats the LoRA's sidecar preview image beside the cursor, the
  same way the picker list already did; both now share one floating element
  that follows the pointer and flips sides at the screen edge. It appears only
  once the image has actually loaded, so a LoRA with no preview file shows
  nothing instead of an empty bordered box, and nothing on the node ever
  shifts.

- **LoRA Loader: the info card states the file's size and modified date**,
  read from disk by the same route that serves its trigger words — quick
  ground truth for "which of these two 143 MB epochs is the newer one".

- **New node: Save Image 🆎.** PNG or lossless JPEG XL (optional
  `pillow-jxl-plugin`, listed as the pack's `jxl` extra), workflow
  embedding on or off — and an `exact_name` mode that saves under exactly
  that filename with no counter suffix, so a caption or edit pass keeps
  the source file's name: `photo123.jpg` in, `photo123.png` out, paired
  with the `photo123.txt` sidecar the optional `caption` input writes.
  `on_existing` decides overwrite/skip/error, `output_dir` accepts a
  subfolder of ComfyUI's output or an absolute dataset path, and the node
  returns the saved `file_path`. Classic prefix+counter saving that never
  overwrites remains the default.

- **The registry description now names the nodes.** Manager search matches
  against the description text, so "a curated collection of polished
  nodes" told searchers nothing — it now lists every node family, and the
  keywords grew to match.

- **Image Resize never invents pixels unless explicitly asked.** In every
  target mode except `width+height` the box is derived from the source's
  own aspect, so there is nothing to letterbox against — yet `pad` used to
  answer a `divisible_by` snap by inventing a sliver of bar (one bottom
  row on an 855×480 source at longest_edge 512, /16). All scale-derived
  modes now resolve the snap the way `fit` always has: an invisible
  sub-half-step resize, a black mask, nothing for the user to think
  about. Bars — and white in the mask — can only appear when a
  `width+height` box that disagrees with the source is combined with
  `pad`, which is the one place they are the explicit request.

- **Added `example_workflows/ausboss_node_tour.json`** — a model-free tour
  that wires 17 node types into one runnable graph: load and thin a clip,
  split and rejoin the batch, pad-resize with the bars masked, de-flicker
  against the first frame everywhere except those bars, retime back to
  double rate, free VRAM, and save — with the fps, frame budget, filename
  prefix, and CRF all arriving over wires from Math Expression, Image Size,
  Text, and Integer nodes, the saved path landing in Show Text, and first
  vs last frame in the A/B panel. Pick any video and Queue; nothing else
  is required.

- **The flagship node color deepened to slate-teal.** The pack-wide default
  scheme now pairs a deep slate-teal title (`#14424d`) with a softly lifted
  near-black body (`#161f21`) — quieter on a busy canvas than the original
  bright teal. Nodes in saved workflows still wearing the old pair upgrade
  automatically on load (`LEGACY_SCHEME_PAIRS`); colors a user picked by
  hand are untouched, as ever.

- **An optional completion chime.** A new off-by-default setting
  (🆎 AusBoss → Notifications → Completion sound) plays a soft two-note
  WebAudio chime when the prompt queue empties, so a long video render can
  run unwatched in another window. No audio asset ships; the tone is
  synthesized on the spot.

- **Stale text and metadata cleaned up across the pack.** Image Compare
  A/B's description and tooltip now describe the A/B toggle instead of the
  removed hold mode; Krea 2 Outpaint Model Patch gained the `RETURN_NAMES`
  its socket label was missing; `seek_mode`, `crop_x`/`crop_y`, and the four
  `pad_*` inputs gained the tooltips the pack's own rules require; Frame
  Interpolate no longer answers a "rife" search it cannot honor; and LaMa
  Inpaint moved into the Inpaint category beside its crop/stitch companions.

- **Four nodes gained the outputs real workflows kept asking for.** Stitch
  Inpaint now also returns `blend_mask` — the feathered paste band in
  original-image coordinates, so the docs' own stitch-then-Color-Match loop
  wires directly. Save Video, which had no outputs at all, returns the saved
  file's absolute path for chaining. Select Frame accepts negative frame
  numbers counting from the end (`-1` is the last frame — the
  feed-the-last-frame-to-I2V move). Image Size adds a `count` output for the
  batch size. All outputs are appended, so saved workflows load unchanged.

- **Six help pages caught up with their nodes.** Color Match's page (which
  still described a single-method node), Align Image, Crop For Inpaint (ten
  undocumented inputs), Load Image + Pad (the Krea 2 outputs), LM Studio
  Chat (the history output and gear-menu controls), and Load Video
  (every_nth / max_frames) now match what ships.

- Fixed `tests/test_inpaint_crop_helpers.py` ending its direct run at a
  mid-file `unittest.main()`: the two canvas-stitcher test classes defined
  below it never executed. The block moved to the end of the file; all 68
  tests (up from 57) run and pass.

- **Load Video can pick a single frame.** A FRAME button on the preview turns
  the trim strip into a frame picker: only the frame at the marker loads, as a
  one-image batch ready for image workflows. Click or drag the rail to scrub,
  or type an exact time into the AT field; playback runs the whole source
  freely while picking, and the trim window comes back untouched when the
  toggle turns off. Backed by a `single_frame` widget appended after the
  existing inputs, so saved workflows keep loading unchanged.

- **Image Compare A/B: nothing is drawn over the picture any more.** The
  status chip that sat in the top-left corner carried the resolution and a
  hint about how to use the panel; it covered part of the image to say
  something you only need once. The resolution moved to a caption centred
  under the panel, and when the two sides are different sizes both are named
  there - the panel scales them to fit, so nothing else on screen would show
  it. The empty and error states still use the middle of the stage.

- **Image Compare A/B's HOLD became an A/B toggle.** Press-and-hold meant the
  comparison only existed while a mouse button was down. Each click now swaps
  the whole panel and the button says which side you are looking at, so you
  can flick between them - which is how a small difference actually becomes
  visible. A workflow saved on `hold` opens on the toggle it became rather
  than dropping back to slide.

- Updated `example_workflows/simple_video_watermark_remover.json`: the
  overview still credited `SimpleWatermarkRemover` (the deprecated
  compatibility id) rather than LaMa Inpaint 🆎, still called the node Refine
  Mask, and its GitHub link pointed at `github.com/auboss`, which does not
  exist. It also gained model-setup and requirements sections, consistent
  node titles, and the mask settings its single-frame test was missing - that
  path shipped with every Mask Refine control at zero, so the frame it
  previewed was not the result the full run would produce.

- **Renamed Refine Mask 🆎 to Mask Refine 🆎.** The mapping key
  (`AUSBOSS_NODES_RefineMask`) is unchanged, so saved workflows are unaffected,
  and "refine mask" is now a search alias. ComfyUI's node search cuts at 64
  results and only ranks a name that STARTS with what you typed near the top -
  as "Refine Mask" this node came 121st for "mask" and was never on screen.
  It is 15th now. Search aliases cannot fix this on their own: the frontend
  indexes them but drops them from that ranking because they are a list rather
  than a string, so they decide whether a node is found at all, not where.

- **Mask Refine, LaMa Inpaint and Select Frame preview their own result**, in
  a panel that now follows the node's height like every other stage in the
  pack. It was pinned at 140px, correctly, while it showed a small thumbnail
  of the node's INPUT; showing the result makes it a viewport onto a picture,
  and the guard that classifies panels as growing or fixed has been updated to
  match - moving a panel between those two sets is now explicitly the call to
  review whenever what a panel displays changes, not only when one is added.
  The panel used to show whatever fed the node's input, which is nothing at
  all when a segmentation node is upstream - Mask Refine's panel was blank
  however the mask turned out. Each now returns its result as a preview and
  the panel shows that, falling back to the input thumbnail before the first
  run. ComfyUI's own preview for these nodes is stood down, so the picture
  appears once, in the panel, instead of also underneath the node.

- **Fixed: LaMa Inpaint finished a single image with an empty panel.** Frame
  previews were only attached when the batch had more than one frame, on the
  assumption that one image would preview through the output path - which
  does not exist for a node that is not an output node.

- **Mask Refine opens on `expand` and `blur`**, with `fill_holes`, `smooth`,
  `black_point`, `white_point` and `edge_refine` behind a **MORE** button.
  Hidden widgets keep their values and their saved order, so nothing changes
  for a workflow that set them. A new **AUTO** button sets `expand` and `blur`
  from the mask's size, scaled off the 8/4 that was hand-tuned for the video
  watermark workflow at 576px: a feather is a fraction of the picture, not a
  fixed pixel count.

- **Save Video gained formats, pingpong and a metadata switch.** Alongside
  mp4 h264/h265 and webm vp9 there are now `mp4 h264 nvenc` and
  `mp4 h265 nvenc` (GPU encoding), `webm av1`, `mov prores` (ProRes HQ),
  `mkv ffv1` (bit-exact lossless), `gif` and `webp`. `pingpong` bounces the
  clip for a seamless loop without repeating the turnaround frames, and
  `save_metadata` turns off embedding the prompt and workflow. Both are
  appended after `format`, where positional widget values cannot shift.
  `fps` steps in whole frames now but stays a FLOAT - an INT would refuse
  Load Video's `fps` link and would round 29.97 to 30, drifting picture away
  from audio. `mov` files now carry the embedded workflow too; they silently
  did not before.

- Removed Save Video's **↻** reload button. It only ever re-fetched the
  preview already on screen, and after a page reload there was no saved file
  in memory for it to fetch at all.

- **Frame Chooser 🆎 was removed from the public pack**
  (`AUSBOSS_NODES_FrameChooser` is gone). Pausing the graph for an
  interactive pick is a bigger surface than the rest of the pack - a server
  route, a resumable pause, a panel that has to survive a reload - and it has
  open issues that are not worth holding a release for. A saved workflow
  using its id will report it as missing.

- Renamed **Video Crop + Rotate + Pad 🆎** to **Video Crop + Rotate + Pad →
  Frame 🆎**. The old name reads like it transforms a clip; it takes one frame
  out of a video and returns a single image, and the editor's timeline is there
  to *find* that frame rather than to trim a range. "grab frame", "extract
  frame" and "frame from video" join the search aliases. The mapping key
  `AUSBOSS_NODES_VideoCropRotatePad` is untouched — it is the
  workflow-compatibility contract — so saved workflows are unaffected.

- Video Crop + Rotate + Pad 🆎: the preview no longer stretches when the node is
  resized. Its canvas is CSS-stretched to whatever box the panel is given, but
  the backing store is only re-sized when something draws — and the panel's
  resize observer sat inside an `image`-only branch next to the interactive drag
  handlers, so the image node redrew on resize and the video node, a passive
  preview with no other reason to redraw, kept painting its last frame into a
  box that had changed shape. Latent until panels started taking the node's
  leftover height, because before that the box could not change shape without a
  width change forcing a relayout. A test now fails if the observer is gated on
  node kind again, or if a canvas-painting panel ships without one.

- Added **Krea 2 Encode 🆎** and **Krea 2 Outpaint Model Patch 🆎**.
  Together they make Krea 2 outpaint the source instead of
  painting something next to it: the encode attaches reference latents to the
  positive conditioning (and emits the negative from the same node, so a turbo
  graph at CFG 1.0 stops carrying a second text encode that does nothing), and
  the patch registers those reference tokens into the target grid at the
  rectangle the stitcher records. Reference latents with no position are only
  a style hint — the model borrows the look and reinvents the content, which
  is the failure this pair fixes.

  The patch reaches into comfy's flux attention layers, so it imports them when
  you run it rather than at startup: a core release that moves one surfaces as
  an error on that node instead of deleting it from the menu and leaving saved
  workflows reporting it missing.

- Krea 2 Outpaint Model Patch 🆎 warns when the source is padded on **both**
  axes. The model places the source spanning one whole canvas axis; the
  reference pipeline splits anything else into two passes, and doing it in one
  is not a slightly worse result — the extended region breaks up. The warning
  reports the spare pixels on each axis, because the usual cause is not a
  deliberate second pad but `canvas_multiple` rounding the other axis up by a
  few pixels, which breaks the span just as completely.

- Load Image + Pad 🆎 gained a `reference` output — the unpadded source, fitted
  to a 384px long edge and a multiple of 16, ready for reference conditioning.
  It is **appended** after `stitcher`, not inserted, because a workflow stores
  links by output slot index and anything else would silently rewire every
  saved graph.

- The stitcher now records where the source sits on the canvas, as
  `source_bbox` in pixels and `bbox_normalized` in 0..1. Padding knows the
  rectangle exactly, so it rides along with the canvas rather than on a
  parallel wire that can be left unplugged. Stitching itself never reads
  either key, so an older stitcher still stitches identically.

- Removed **Drop Shadow 🆎** (`AUSBOSS_NODES_DropShadow`). The result never
  looked like a real cast shadow — a mask offset, grown and blurred has no
  contact darkening and no perspective, so it read as a sticker halo rather
  than something in the scene, and that is a limit of the approach rather than
  a tuning problem. A saved workflow containing the node will report it as
  missing on load; delete it, or composite the shadow in an image editor.

- Removed **Pad Image 🆎** (`AUSBOSS_NODES_PadImage`). Load Image + Pad 🆎 does
  the same job from the same stage and starts from the file, so keeping a
  second node whose only difference was taking an IMAGE wire earned its slot in
  the menu twice over from one idea. A saved workflow containing it will report
  it as missing on load. The padding helpers, the modes and the mask are
  unchanged — they were always shared, and Load Image + Pad keeps all of them
  plus feather, canvas rounding and the megapixel target.

- Load Image + Pad gained a `stitcher` output, so an outpaint can
  put the source back exactly. Feed it to the existing **Stitch Inpaint 🆎**
  with the sampled result and every pixel outside the padded band comes back
  bit-identical to the input — only the new padding is the model's work, which
  is what stops a full-canvas sample from quietly resoftening the whole photo.
  No new node: padding now builds the same stitcher shape Crop For Inpaint
  emits (the crop is simply the whole canvas), so one stitch node serves both.
  The output is appended last, so saved workflows keep their existing links.

- Compare: the A/B stage now grows when you drag the node **taller**, not only
  wider. Its panel declared a `computeSize`, and the widget layout gives any
  widget that defines one a fixed height and leaves it out of the leftover-space
  split — so the stage was sized purely from the node's width (capped at 520px)
  and extra height became dead space under the image. It now declares only a
  minimum, which puts it in the split and lets it take the height that is left.
  The node also opens at a 16:9-ish default instead of inheriting one from the
  removed calculation; saved workflows keep their own size.

- LoRA Loader: the "wrong base model" warning now *measures* the result instead
  of guessing from names. It compares comfy's applied-patch count across the
  model and CLIP before and after each row, and warns — naming the LoRA — when
  a row patched nothing, which is what a mismatched LoRA actually does. The old
  check keyed off comfy's model *class name* against a hardcoded table that
  covered 8 of the 81 classes comfy ships, so on anything newer than Flux
  (Krea 2, Qwen, WAN, LTXV, Z-Image, Chroma, HiDream, …) it read "unknown" and
  silently skipped the check; an SD 1.5 LoRA on Krea 2 did nothing to the image
  and said nothing about it. The new check needs no table, no LoRA metadata,
  and works on every model family.
- LoRA Loader: a LoRA's declared base model is read only from the declarative
  metadata keys. `ss_sd_model_name` is the trainer's source *filename*, and
  mining it for substrings labelled any `..._v1.safetensors` as SD1.5 and
  anything with `xl` in the name as SDXL — a wrong label on a working LoRA.
  Families newer than the known-name table now show what the file declares
  (`krea2`) instead of nothing.
- LM Studio Chat: reasoning that the server returns in its own
  `reasoning_content` field now reaches the `thinking` output. Reasoning models
  report two ways — inline `<think>` tags inside the content, or that sibling
  field (what LM Studio sends for gemma/qwen-style hybrids) — and only the
  first was read, so with those models the entire reply landed in a field the
  node never looked at and `text` came back silently blank.
- LM Studio Chat: an empty answer now says why instead of returning "". When
  the model produced reasoning but no answer, the node reports whether it ran
  out of tokens mid-thought (naming the max_tokens budget it hit) or simply
  answered nothing, and points at the fix. A reasoning model can spend an
  entire small token budget thinking, which read as "the node is broken".
  instead of magic numbers. Each of Top-p, Top-k, Min-p, Repeat penalty and
  Presence penalty has a checkbox, a reset button that appears once you change
  it, and — for the 0-1 ones — a slider beside the number. Ticking one on
  starts from LM Studio's own default (top-p 0.95, top-k 40, min-p 0.05,
  repeat 1.1) rather than the value that means "off", and ticking it back on
  returns the value you had before. Unticked still sends nothing, so the
  payload, the widgets, and existing workflows are byte-for-byte unchanged;
  what changed is that "off" now looks off instead of requiring you to know
  that top-p 1 happens to mean off.
- Settings menus: editing one row no longer reverts the others. The menu seeds
  from the open node's values, but each save handed back a value set rebuilt
  from stored defaults, so changing any one setting silently replaced every
  other row with whatever the stored default was — visible as a value quietly
  reverting on a node whose saved workflow differed from those defaults.
- LoRA Loader: fixed the templates popover — a blanket `.ausboss-lora-menu
  button` rule outranked the specialized buttons inside it, forcing them to
  `width: 100%`, which clipped **Save** off the panel edge and stretched each
  saved row's delete `×` across the whole row. The rule now targets only the
  menu's direct children, which are the plain list rows. Action buttons also
  read as buttons: matching 26px height with the name field, a border, and
  pressed/keyboard-focus states.

## 1.1.1

- Registry metadata only; no node behaviour changes. The ComfyUI version floor
  now actually reaches the registry: comfy-cli reads it from a `[tool.comfy]`
  key named `requires-comfyui`, and the pack had been declaring
  `supported_comfyui_version`, which is silently ignored - so 1.1.0 published
  with an empty floor and Manager would not have refused an install on an
  incompatible core.
- Declared `Operating System :: OS Independent` so the registry records the
  supported-OS list. Accelerator classifiers are deliberately omitted rather
  than asserting untested hardware.
- License publishes as a readable name instead of the literal string
  `{"file": "LICENSE"}`. The LICENSE file itself is unchanged, still MIT.


## 1.1.0

- Image Crop + Rotate + Pad: the node's compact preview is now the editor stage in miniature — grab the crop squares, pad diamonds, and rotate knob (with a live degree readout) right on the node, and the panel grows with the node. Fit-only there, so the wheel keeps zooming the graph; the full editor keeps zoom, pan, and the sidebars, and both surfaces run the same hit-test and drag code, so they cannot drift. The video node's panel stays a passive preview.
- Added `AUSBOSS_NODES_LoadImagePad`: a Load Image with an on-node outpaint canvas — drag any edge of the final rect to set that side's padding (the whole edge is the handle; the badge shows the true output size after rounding), with the four Pad Image fills, a mask feathered inward across the seam, canvas-multiple rounding, and a megapixel target that rescales the source *before* padding so the mask seam stays crisp. Outputs image, mask, and the final width/height as INTs.
- Pad Image: the same on-node handle canvas — drag the final rect's edges to set the padding over a live preview of the input image (fed by execution, so it fills in after the first run; a wireframe stands in before that). Widgets, outputs, and saved workflows are unchanged.
- Drop Shadow: a `blend` choice — normal (the old mix toward the color) or multiply, which darkens the backdrop by the color and keeps its texture — plus a `shadow_mask` output carrying the effective shadow alpha for compositing downstream.
- Align Image: `offset_x`/`offset_y` INT outputs locate the original's top-left inside the aligned output (positive after pad, negative after crop, 0 after resize), so an un-align crop after sampling needs no manual math.
- Color Match: `reference_mode: first_frame` matches every frame of a batch to the batch's own first frame — the one-node video flicker fix; the reference input is optional in that mode.
- Crop For Inpaint: `target_megapixels` rescales the crop to a sampler-friendly area (explicit target_width/height still wins), `rescale_algorithm` picks the resize filter for both directions of the round trip (recorded in the stitcher), and `extend_left/right/up/down` grow the frame itself for outpainting — the new bands are replicate-filled, masked for painting, and become part of the stitched output.
- Save Video: a `format` choice — mp4 h264 (default, unchanged), mp4 h265, or webm vp9 with Opus audio (resampled to 48 kHz when needed). CRF applies to all three; bt709 tagging and the embedded workflow ride along.
- Load Video: `every_nth` keeps one frame in N (the fps output divides to match, so real time survives downstream), and `max_frames` stops the decode after that many kept frames instead of loading and discarding — long clips no longer have to fit in memory.
- LoRA Loader: the bar's ▤ button saves and applies named templates of the whole stack (browser-persisted, case-insensitive replace, sorted menu). A LoRA whose metadata names a different base-model family than the connected checkpoint now logs one clear console warning at apply time.
- LM Studio Chat: a `history` input/output pair (`AUSBOSS_CHAT_HISTORY`) chains multi-turn conversations across chat nodes — reasoning blocks and image payloads are deliberately not replayed — and a `json_schema` widget forces structured JSON replies via LM Studio's response_format.
- Cleanup: the dead module-level `NODE_ID` variables left over from before the literal-mapping-key convention are gone from every node file.
- Removed: `AUSBOSS_NODES_SelectFrameRange` and the Video Bundle family (`AUSBOSS_NODES_VideoBundle`, `AUSBOSS_NODES_VideoUnbundle`, `AUSBOSS_NODES_VideoBundleEdit`). Core ComfyUI's `ImageFromBatch` covers contiguous-range selection, and the core `VIDEO` wire (`CreateVideo` / `GetVideoComponents`) is now the ecosystem-standard way to move a whole video on one connection, which is what `AUSBOSS_VIDEO` existed for. Workflows using the removed keys keep their other nodes; replace those four with the core equivalents. Select Frame and Image Size stay.
- Display names traded the " (AusBoss)" suffix for the pack's 🆎 signature — "LoRA Loader 🆎", "Color Match 🆎". Typing "ausboss" still surfaces everything through the 🆎 AusBoss category, the AUSBOSS_NODES_ id prefix, and each node's search aliases; mapping keys are untouched, so saved workflows load exactly as before.
- Fixed: the LM Studio Chat endpoint toolbar rendered as a sliver that clipped its buttons — the DOM-widget wrapper takes its height from the getMinHeight option, which the toolbar never declared.

- Every AusBoss node now wears the brand look out of the box: the teal-title scheme the video nodes shipped with became the "AusBoss" row in the appearance table and the pack-wide default, and Load/Save Video stopped hard-painting themselves so the appearance setting (and the per-node color menu) governs them like everyone else. "Theme default" remains available for anyone who wants uncolored nodes.
- Every AusBoss node grew a quiet "?" badge in the title bar; clicking it opens a card built from the node's own DESCRIPTION and input/output tooltips, so the docs on screen are exactly the docs in the source.
- New gear-settings menus, persisted in the browser: the LoRA Loader's gear holds default strength, strength step, separate model/CLIP strengths, the trigger-word separator, hide-extension, thumbnail, and Civitai-lookup preferences; LM Studio Chat's gear holds the advanced sampling knobs (top-p, top-k, min-p, repeat and presence penalty), thinking control with custom reasoning tags, LM Studio idle-unload TTL, and a free-ComfyUI-VRAM-first switch. The LM Studio values ride hidden standard widgets, so they save with the workflow and reach the API like any widget.
- LoRA Loader restyle: one control language — a full-width filled Add button, a master-toggle bar with the gear, and the rows inside an inset stack container with a dashed empty state; the serif "i" is gone.
- Align Image: crop mode gained `crop_position` (center/top/bottom/left/right) choosing which part of the frame survives; the widget only shows while mode is crop.
- Color Match: a `method` choice — `lab` (the old behavior), `rgb`, `mkl` (full covariance mapping), and `histogram` (exact per-channel distribution) — plus `invert_mask`, and tooltips that spell out the mask contract (it scopes the fix and passes through unchanged, which is why there is no mask output).
- Crop For Inpaint: the selection can now be inverted (`invert_mask`), grown or shrunk (`mask_grow`), and edge-softened (`mask_blur`) before cropping, and `context_pixels` adds flat margin on top of `context_factor`'s growth.
- Fixed: A/B Compare could get stuck in HOLD — in hold mode the stage captured the pointer on press, which retargeted the release and ate the mode button's click. The modes are now two dedicated SLIDE/HOLD buttons, and presses that start on the toolbar never reach the stage behaviors.

- Fixed the LoRA panel (and every DOM panel) overflowing after a node was resized narrower: the frontend sizes a panel's wrapper as `widget.width ?? node.width`, and LiteGraph's layout plants `widget.width` during draws - once planted, it outranks the node width forever, so the wrapper kept an old, wider width and parked the row's controls outside the border. All six panels now discard those writes (`keepDomWidgetWidthAuto`), so the wrapper tracks the node in both directions. Diagnosed from a live browser measurement and verified end-to-end against a planted stale width.

- Fixed: the LoRA Loader's strength box and info button could hang past the node's right edge. The panel now sizes its padding inside the widget's box, clips anything oversized, and declares its minimum width to the layout so the node cannot be resized out from under the row. A pack-wide test now requires every DOM panel to carry the same guards.
- The same containment sweep covered every DOM panel: Frame Chooser gained the resize floor older frontends read (`minNodeSize`), the input-preview thumbnail clips at its root, and the pack-wide test now requires the full guard set - border-box, an overflow clip, and a minimum width on both frontend layout paths - of every panel.
- Added `AUSBOSS_NODES_AlignImage`: snap an image's width and height to a clean multiple (16, 32, ...) by nearest-resize, center-crop, or replicate-pad, with the new size as INT outputs — for Qwen image models and anything else that wants cleanly divisible sizes.
- Added `AUSBOSS_NODES_ImageSize`: width, height, longest edge, and shortest edge as INT outputs.
- Added `AUSBOSS_NODES_LmStudioChat`: prompt + optional image to a local LM Studio (or any OpenAI-compatible) server. Empty model uses whatever is loaded, `<think>` blocks land on their own output, the seed re-rolls the cached reply, and every error names what to fix. Stdlib HTTP - no new dependencies.

- Performance: mask dilation and erosion run as one separable pass instead of one 3x3 pool per pixel of growth - bit-identical, measured 6-7x at 32 px, and it feeds Drop Shadow's grow, Refine Mask's expand, and the matting trimap. The trimap's morphology is also built once per batch instead of once per frame (27x on that stage: 11.0 s -> 0.4 s for 48 frames of 832x480). Pad Image's pillarbox backdrop blurs at quarter resolution when the blur is heavy (6-7x on the stage that was ~90% of the node; mean difference ~0.001 in a backdrop that is then dimmed - light blurs keep the exact full-resolution path). Frame Interpolate estimates optical flow exactly once per source pair however small batch_size is, where a batch_size of 1 used to re-solve each pair once per output frame (4x the RAFT work at 24 -> 120 fps); the guide-image batch is no longer duplicated up front, and the scene-cut scan drops a full-chunk temporary.

- Fixed: a Frame Chooser pause survived being cancelled by an ordinary workflow load. LiteGraph clears the graph by removing every node, so undo, switching workflow tabs, Clear Workflow and opening another file all fired the teardown that a deleted node uses to release its pause - silently interrupting a run that was still going, with no way to get it back.
- Fixed: answering "keep all" wrote the whole batch out as `1,2,...,N` into `pick_list`, pinning a batch-size-independent answer to one batch. The next run then dropped any frames past the end of that list, or failed outright on a shorter clip. It now writes the empty answer it was given.
- Fixed: `pick_list` is only written back under `keep last selection`. It pre-answers the node, so filling it in automatically meant a chooser left at the default `always pause` paused exactly once and never again.
- Fixed: Refine Mask's `smooth` no longer flattens a mask that is already soft; it applies only the change it made to the jaggy edge. Binary masks are bit-identical to before.
- Fixed: Refine Mask's `blur` now reaches the `matting` edge-refine solve instead of being thresholded back out of the trimap.
- Fixed: Frame Interpolate's copy path honours `batch_size`. It gathered every copied frame at once, which on a long clip at an integer multiple was a multi-gigabyte allocation on the frames device that no setting could bound.
- Fixed: live status and runtime badges appear for nodes inside a subgraph, and a subgraph pause renders on the node that actually paused. Colon-prefixed execution ids are resolved by walking the subgraph chain rather than by stripping the prefix, which could match an unrelated node with the same number.
- Fixed: choosing the Custom node colour scheme while the stored colour is unreadable no longer strips the colour off every AusBoss node.
- Fixed: an unreadable colour in Drop Shadow or Pad Image names its own node and widget in the console instead of blaming Transform, and one node's warning no longer silences another's.
- Fixed: a malformed Frame Chooser answer returns 400 rather than 500 - a non-ASCII token and a JSON body that is not an object both used to throw out of the route and strand the pause.
- Fixed: `pick_list` rejects Unicode digits. `²` raised a bare `ValueError` during validation and `٣` was silently read as frame 3.
- Fixed: `scripts/validate_nodes.py` parses `NODE_MODULES` instead of matching it anywhere in the text, and an unregistered node module is now an error rather than a warning - it used to exit 0 with no output at all. It also refuses mapping keys declared outside `nodes/`, which is how the registry test fixtures came to be advertised to ComfyUI-Manager as installable nodes; they are now `.py.txt`.

- Added `AUSBOSS_NODES_ColorMatch`: LAB mean/std transfer that harmonizes an inpainted or stitched region against its source, with optional mask and strength.
- Added `AUSBOSS_NODES_PadImage` with color, edge, edge-pixel, and pillarbox-blur fills, returning a mask over exactly the new padding for outpainting.
- Added `AUSBOSS_NODES_DropShadow` for padded and reframed compositions.
- Added `AUSBOSS_NODES_FrameInterpolate`: fps-based interpolation (24 to 30 works, not just whole multiples) with blend and optical-flow methods, bounded memory, and scene-cut detection that holds across hard cuts instead of morphing.
- Refine Mask gained a jaggy-melting `smooth` control, black/white point levels, and optional `guided filter` and `matting` edge-refine tiers.
- Stitch Inpaint gained an optional `fix_edge_halo` toggle that removes the rim left by compositing a feathered seam twice; pixels outside the blend stay bit-identical either way.
- Frame Chooser gained a countdown with timeout policies, reload recovery, a `pick_list` pre-answer for headless reruns with automatic writeback, stale-answer rejection, a keyboard map, and a notice when a pause begins out of sight. A pause now resolves exactly once: whichever of a keep, a cancel, an expiring countdown or a second tab gets there first decides it, and the ones that lose are refused instead of overwriting the decision or reporting a success they did not have.
- Load Video exposes a lazy core `VIDEO` output and Save Video accepts a core `VIDEO` input, so the pack interoperates with ComfyUI's own video nodes; a connected video's frame rate wins over the fps widget.
- Video decode and encode now run off the executor thread with per-frame progress, so long jobs no longer block the UI.
- Added a live per-node status badge (`frame i/N` during a LaMa video inpaint), About-page badges, a toast for the stale-frontend warning, and a Custom node color scheme.
- Fixed registry discovery: mapping keys are now string literals, so ComfyUI-Manager can see the pack's nodes and offer to install it for a shared workflow. `scripts/validate_nodes.py` now enforces the whole registry contract - each mapping assigned exactly once at module level to a non-empty dictionary literal with string-literal keys, its name never used again (no `update()`, no `del`, no aliasing it into a variable that mutates it later), matching keys across the two mappings, and no key claimed by two modules. Permanent public ids are checked against the keys parsed out of those literals rather than any mention of the id in the file.

- Added `AUSBOSS_NODES_FrameChooser`: pause the graph on a clickable filmstrip and keep only the frames you pick, with a no-pause "keep last selection" mode.
- Added `AUSBOSS_NODES_CropForInpaint` + `AUSBOSS_NODES_StitchInpaint`: native-resolution masked inpainting with a bit-exact paste-back contract and video batch broadcasting.
- Added the `AUSBOSS_VIDEO` bundle wire (`Video Bundle` / `Unbundle` / `Bundle Edit`) carrying frames, audio, fps, and derived info on one connection.
- Added `AUSBOSS_NODES_Compare`: slide or hold A/B image comparison that passes A through.
- LoRA Loader: master on/off pill with a mixed state, folder-grouped picker with hover preview thumbnails and shared-prefix stripping, and per-LoRA suggested strength ranges that tint out-of-range values.
- Load Video: trim IN/OUT are typed timecodes (`h:mm:ss.s`), decodes are memory-guarded with a clear oversized-trim error, seeks respect stream start time, and audio extraction is lazy.
- Save Video: output is tagged bt709 with a matching conversion matrix, and dropping a saved mp4 onto the canvas restores its embedded workflow.
- Widget values for the transform and video nodes now serialize by name with validated migration from older positional workflows.
- New Chrome settings: favicon/tab-title queue status and per-node runtime badges.

- Added `AUSBOSS_NODES_LoadVideo` with a single responsive player, draggable IN/OUT trim range, bounded playback, matched audio, and info outputs.
- Added `AUSBOSS_NODES_RefineMask` with expand/shrink, hole filling, feathering, and an inverted output.
- Added `AUSBOSS_NODES_SaveVideo` writing H.264 mp4 with muxed audio, embedded workflow metadata, and a responsive loopable result viewer.
- Added `AUSBOSS_NODES_SelectFrame` with one-based, range-checked batch selection.
- Added `AUSBOSS_NODES_LaMaInpaint` with bounded-VRAM video processing and explicit `models/lama` checkpoint discovery.
- Added a compatibility alias for the published `SimpleWatermarkRemover` workflow contract.
- Added the repaired Simple Video Watermark Remover example workflow.
- Added an `AusBoss node color` setting (Settings → 🆎 AusBoss) with curated schemes that recolor every AusBoss node live; hand-colored nodes keep their own colors.
- Added `AUSBOSS_NODES_LoraLoader`: a stacked multi-LoRA node with drag-to-scrub strengths, a keyboard-first searchable picker, per-row trigger words (file metadata, one-click Civitai fetch, and your own saved words), and a `trigger_words` output.
- Added `AUSBOSS_NODES_SelectFrameRange` returning a one-based sub-batch plus its actual frame count.
- Added a right-click `Recreate node (AusBoss)` utility that rebuilds a node from the current definition, preserving values and links, with full rollback.
- Added adaptive title ink, a per-node right-click `AusBoss color` override, and subgraph-aware color sweeps.
- Added live previews: LaMa video inpaints stream each finished frame to the node face, and Refine Mask / LaMa Inpaint show their upstream input before the graph runs.
- Added `%date:...%`-style filename tokens to Save Video, tolerant `fill_color` parsing (hex, CSV, floats, CSS names), an `Alt+E` open-editor command, and user-editable aspect presets via `ausboss_presets.json`.
- DOM panel edits now register with ComfyUI's undo/modified tracking, and a console warning fires when the browser runs stale cached pack JavaScript.
- Added `scripts/release_preflight.py` catching pyproject BOMs and JS/Python version drift.

## 1.0.0

- Added `AUSBOSS_NODES_ImageCropRotatePad`.
- Added `AUSBOSS_NODES_VideoCropRotatePad`.
- Added a shared full-screen rotate, crop, and pad editor with compact node previews.
- Added exact video-frame preview routes and input-folder/local-path modes.
- Added generated-area masks covering transparency, rotation voids, and padding.
- Added rich node help, example workflows, automated backend/frontend tests, and Registry metadata.
- Editor rotated-size math now matches Pillow's `expand=True` output exactly at every angle.
- Video frame preview uses keyframe seeking with a sequential fallback, so scrubbing long videos stays fast.
- Editor previews of local paths outside ComfyUI's folders are opt-in via `AUSBOSS_TRANSFORM_LOCAL_PREVIEW=1`; queued workflows are unaffected.
- Timeline scrubbing now renders immediately with a latest-wins request pump and reduced-size scrub frames, landing a full-resolution frame on release; playback and held arrow keys use the same light path. Server caches per-file video metadata so each scrub frame opens the container once.
- Video decodes run off the web server's event loop in persistent per-file decoder sessions (with an idle reaper that releases file locks), so a slow decode can never stall the ComfyUI UI and stepping forward decodes only the frames in between.
- A keyframe storyboard builds in the background after a video is selected; dragging the timeline shows the nearest storyboard tile with zero network latency, then the exact decoded frame replaces it.
- The rotation handle moved to the source's top-right corner, drawn with a crisp vector rotate glyph, clear of the top padding handle.
