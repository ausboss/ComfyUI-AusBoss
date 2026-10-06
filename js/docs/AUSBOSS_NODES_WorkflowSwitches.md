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

In a LoRA Loader it changes single rows, found by file name. A row you did
not change keeps whatever strength you give it later.

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
- **Frame button** (four corners): brings the part into view.
- **Three dots** (on a switch you made):
  - **Rename**. Double-clicking the label does the same.
  - **Select its nodes** shows on the canvas what the switch holds.
  - **Add the selected** and **Take out the selected** change what it holds.
    Select nodes or groups first.
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

## Technical details

- **What bypass passes on.** A bypassed node, or box, hands on its first
  input of the same kind as its output. For a step with two picture inputs,
  wire the picture that should pass through into the first one. A node with
  no input of that kind (a decode: latent in, picture out) passes nothing,
  so the nodes that read it belong in the same switch.
- **A switch finds its nodes by id.** A deleted node drops out of its
  switch. A copy of a node is not in the switch, and a pasted copy of the
  card switches the same nodes as the original.
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
- **Switch everything on** and **off** also move every settings switch.
- It stores which nodes each switch holds, the values it remembers and its
  settings. Whether a row is on is read from the nodes themselves, so a saved
  workflow reopens showing what is really on, however it was switched.
- It never runs and has no wires. It is left out of the prompt, so it cannot
  change a result or slow a run.
- One card holds up to 40 switches.
