# Workflow Switches

Turn parts of a workflow off and on from one small card. Each row is a
switch with a name. **off** skips that part, **on** runs it again.

Use it when a workflow makes more than one result and you do not always want
all of them, or when a long workflow has steps you sometimes skip, such as
an upscale at the end.

## Make a switch

1. Select the nodes of one part on the canvas. A box (subgraph) and its Save
   Image, for example.
2. Press **+ Switch from 2 selected** on the card.
3. Type a name and press Enter.

One click on its pill now turns every node you picked off, and the next click
turns them on again.

Groups work too. Every group on the canvas gets a switch of its own, unless
you change that under **Settings**. A group can also be part of a switch you
make: select it together with the nodes.

## A switch that changes settings

A switch can also change values instead of turning nodes off. One click can
set **Steps** to 8 and turn a speed LoRA's row on, and the next click puts
both back.

1. Make a switch from the nodes whose settings should change.
2. Set those nodes the way they should be when the switch is **on**. Select
   them, open the switch's three dots and pick **Save the 2 selected as
   on**.
3. Set them the way they should be when it is **off**, select them again and
   pick **Save the 2 selected as off**.

The switch now changes only the values that differ between the two. Those
nodes are no longer turned off by it.

In a LoRA Loader it changes single rows, found by file name, and only
whether each row is on. The strength stays yours: turn a row down to 0.6 and
it stays at 0.6 whichever way you switch. A strength changes only when you
saved that row at one strength for on and another for off. Rows the switch
does not change keep whatever you give them. The same works for the LoRA
rows on a subgraph box (LoRA Loader's gear, **Rows on the box**): select the
box itself and save its on and off.

A LoRA Loader group works the same way. Save the switch once with the group
on and once with it off, and the switch turns the whole group on and off.
Each LoRA in the group keeps its own on/off, so you can still leave one out
by hand, and a LoRA added to the group later goes with it.

A LoRA row or group a switch sets shows a lock in the LoRA Loader. Click the
lock to take it over: this switch then leaves it alone.

## A switch with two sides

Sometimes one choice means "use this" and "leave that out" at the same time.
When you edit a picture, the picture decides the size, so the node that sets
the size should sit out. When you make a new picture, it is the other way
round.

One switch can do both. Give it an **off side**: nodes that run **only while
the switch is off**. Say the switch is **Edit a picture**, it holds the node
*Your picture*, and *Latent Size* is on its off side:

- **on**: *Your picture* runs. *Latent Size* is switched off, so it looks
  bypassed.
- **off**: *Your picture* is switched off. *Latent Size* runs.

To set it up:

1. Make the switch from the nodes that should run while it is on, here
   *Your picture*.
2. Select the nodes that should run only while it is off, here *Latent Size*.
3. Open the switch's three dots and pick **The 1 selected runs only while this
   is off**.

A small sign of two arrows beside the label shows that a switch has an off
side. Point at it to see which nodes. To take a node off that side again,
select it and pick **Take the 1 selected off that side**.

## One pill to pick from

Sometimes the switches on a card are choices, and exactly one should be in
use: mask by words or by a click, say, or one of three upscalers. The card
can show them as one pill. Each switch is a part of the pill, the one in use
is filled, and a click on another one changes to it.

1. Make a switch for each choice.
2. Open **Settings** and set **One at a time** to **on**.
3. Set **Show as** to **one pill**.

One choice is always picked. A click on the filled one does nothing, so
nobody can switch them all off or switch two on.

Up to four short names sit side by side. With more choices, or with long
names, the card shows a list to pick from instead. The card gets wider when
the names need the room.

In the edit view the pill sits above the rows. You pick in the pill, and the
rows keep their frame button and three dots. After **Done** only the pill is
left. To edit again, right-click the node and pick **Edit switches**.

A workflow can be saved with none of the choices on, or with several. The
pill then shows that as it is, with an amber edge. Click the one you want
and the others are switched off.

## The small view

Press **Done** and the card shrinks to the labels and their switches. That is
the view to save a finished workflow with.

To change it again, double-click a label, or right-click the node and pick
**Edit switches**.

## What off does

- **bypass** (the default, purple nodes): each node hands its input straight
  on. Switch off a step in the middle of a chain and the picture still
  reaches the steps after it.
- **mute** (grey nodes): the nodes do not run, and nothing that needs their
  output runs either.

Pick one under **Settings → When off**.

Put a part's Save or Preview in the same switch as the part. With the Save
off, nothing asks for that result, so ComfyUI skips the work and never loads
the models only that part needs.

## The edit view

- **off | on**: click anywhere on the pill to flip the switch. Off turns off
  every node of the row, on sets them all to run. It is one undo step.
- **Mixed**: when only some of a row's nodes run (one bypassed by hand, say)
  the pill is striped and a count shows how many run, such as **1/2**. Click
  the half you want, off or on, to set them all. A settings switch reads **changed** when one of
  its values was set by hand to something else, and **half set** while only
  one side is saved.
- **Frame button** (four corners): brings the part into view. For a switch
  with an off side, it brings both sides into view.
- **Three dots** (on a switch you made):
  - **Rename**. Double-clicking the label does the same.
  - **Select its nodes** shows on the canvas what the switch holds.
  - **Add the selected** and **Take out the selected** change what it holds.
    Select nodes or groups first.
  - **The selected run only while this is off** and **Take the selected off
    that side** give the switch an off side, see above.
  - **Save the selected as on** and **Save the selected as off** make it a
    switch that changes settings, see above.
  - **Move up** and **Move down** change the order.
  - **Delete this switch** removes the row. The nodes stay as they are.
- Right-click the node for **Switch everything on** and **Switch everything
  off**.

## Settings

Open **Settings** at the bottom of the edit view.

- **When off**: bypass or mute, see above.
- **Groups**: which groups get a switch of their own, listed under the
  switches you made. **No groups**, **Every group**, **Numbered groups**
  (titles that start with a digit, such as *1 · Load*) or **Titles
  matching…**, which takes comma-separated words in **Match**.
- **Group order**: **canvas** reads the way a workflow does, column by column
  from the left and top to bottom inside a column. **title** sorts by title,
  with numbers in numeric order (*2 · …* before *10 · …*).
- **One at a time**: switching a row on switches the other rows off. Use it
  for alternatives, such as two upscalers.
- **Show as** (there while One at a time is on): **rows** gives every switch
  a row with its own off | on. **one pill** shows them as one pill to pick
  from, see above.

## Technical details

- **What bypass passes on.** A bypassed node, or box, hands on its first
  input of the same kind as its output. For a step with two picture inputs,
  wire the picture that should pass through into the first one. A node with
  no input of that kind (a decode: latent in, picture out) passes nothing,
  so the nodes that read it belong in the same switch.
- **A switch finds its nodes by id.** A deleted node drops out of its
  switch. A copy of a node is not in the switch. A card copied together with
  its nodes and groups switches the copies, so a whole workflow pasted into
  a new tab keeps working switches. A card copied on its own switches the
  same nodes as the original.
- **A node in two switches** is changed by either. The other row then reads
  mixed. A node that two parts share needs no switch: ComfyUI only runs what
  a result needs.
- **On turns on everything in the row**, including a node you bypassed by
  hand.
- Nodes that never run, such as notes, a Workflow Note or a Run Timer,
  switch with their row but never make it read mixed.
- A box switches as a whole, as Ctrl+B does. Nothing inside it runs while it
  is off.
- A node belongs to a group when the group's box holds the centre of the
  node, the rule ComfyUI uses to decide what moves with a group.
- The card lists the parts of the graph it sits on. Inside a box it lists
  that box's nodes and groups. It never switches itself or another Workflow
  Switches node.
- **What a settings switch remembers.** Saving a side stores every text,
  number and on/off value of the selected nodes, by control name. Only the
  ones that differ between on and off are ever written. A value longer than
  20,000 characters is not stored. One switch remembers up to 40 nodes.
- **A LoRA row's strength.** A switch sets a row's model or CLIP strength
  only when its saved on and off give that row different ones. Otherwise it
  sets only whether the row is on, so a strength changed by hand never makes
  the row read changed or partly on. The row's triggers are never touched.
- **Switch everything on** and **off** also move every settings switch and
  every off side.
- **How a switch with an off side reads.** It is on when its own nodes run
  and its off side does not, off when it is the other way round, and mixed
  otherwise. The count on a mixed row, such as **2/3**, counts the nodes of
  both sides.
- **A node is on one side only.** Putting it on one side takes it off the
  other, and a node that a saved workflow lists on both stays on the on side.
  A node you picked by hand stays on the side you picked it for, even when a
  group on the other side holds it too. When groups of both sides hold it, it
  stays on the on side.
- **One at a time** switches the other rows off, which runs their off sides.
  A node that one row runs and another switches off ends up running, and the
  row you switch on has the last word.
- **A pill or a list.** Two to four rows are a pill when their names fit on
  a card no wider than 400 px. More rows, or longer names, are a list. With
  one row the card stays in the row view. Groups listed on the card are
  choices too, and a row with no nodes cannot be picked.
- **A click on a choice** does what One at a time does: that row goes on and
  every other row off, their settings and off sides included. A row that is
  only partly on is striped, as in the row view.
- **Switch everything off** is left out of the right-click menu while the
  card shows as one pill.
- **The pill is stored as one more setting**: `"show": "pill"` beside
  `"exclusive": true`, in the node's `ausboss_workflow_switches` property.
  `"show": "rows"`, or no `show` at all, is the row view. So a workflow saved
  by an older version of this pack opens as rows, and an older version
  ignores the setting.
- **The off side is stored next to the nodes it belongs to**, as `nodes_off`
  and `groups_off` beside `nodes` and `groups`. They are left out while
  nothing is on the off side, so a workflow that does not use it is saved as
  before. An older version of this pack ignores the off side.
- It stores which nodes each switch holds, the values it remembers and its
  settings. Whether a row is on is read from the nodes themselves, so a saved
  workflow reopens showing what is really on, however it was switched.
- It never runs and has no wires. It is left out of the prompt, so it cannot
  change a result or slow a run.
- One card holds up to 40 switches.
