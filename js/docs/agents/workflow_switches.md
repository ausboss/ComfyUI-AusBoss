# Workflow Switches: a guide for AI agents

Give this page to an AI agent and it can add switches to a ComfyUI workflow
for you. Nobody has to click through menus: the agent writes the card straight
into the workflow file.

**If you are the agent:** the card is one node in the workflow file. It has no
wires. It lists which nodes each switch controls, in one property. Pick the
recipe below that fits, add the card, and set the nodes' starting state.

## Before you start

- **Edit the file ComfyUI saves with Save**, the one with a `nodes` list. The
  card never reaches a run, so it has no place in the API format. For an API
  prompt, leave out what should not run.
- **Use the `id` of each node** in `nodes`, and of each box in `groups`.
- **Stay on one level.** The card controls nodes on its own level of the
  graph. From the main graph it can switch a whole subgraph node, or change a
  control that subgraph node shows, but not reach a node inside it.
- **Read a control's name** from the node's `widgets_values_named` in the file,
  or from `/object_info/<node type>` on the ComfyUI server.

## Add the card

Add this to `nodes`. Give it an `id` no other node has, and raise
`last_node_id` if it is lower than that `id`. Pick a free `pos` so it covers
nothing, and the next free number for `order`.

```json
{
  "id": 50,
  "type": "AUSBOSS_NODES_WorkflowSwitches",
  "pos": [0, 0],
  "size": [320, 100],
  "flags": {},
  "order": 0,
  "mode": 0,
  "inputs": [],
  "outputs": [],
  "title": "Workflow Switches",
  "properties": {
    "cnr_id": "ausboss-nodes",
    "ausboss_show_edit": false,
    "ausboss_workflow_switches": {
      "off": "bypass",
      "groups": "none",
      "exclusive": false,
      "show": "rows",
      "switches": []
    }
  },
  "widgets_values": []
}
```

Then fill `switches` from a recipe. Keep `"groups": "none"`: the default,
`"all"`, gives every group on the canvas a row of its own.

`show` is `"rows"`, one off | on row per switch, or `"pill"`, one pill to pick
from. A row's `id` is a whole number from 1, new on its card only. A workflow
can have several cards.

## Set the starting state

The card remembers nothing about what is on. It reads each node's own `mode`,
so the file decides how the workflow opens.

| `mode` | What the node does |
| --- | --- |
| `0` | Runs |
| `4` | Bypassed: passes its input on, and ComfyUI doesn't check it |
| `2` | Muted: passes nothing on, and ComfyUI doesn't check it |

For a part that opens switched off, set `"mode": 4` on its nodes, Save Image
nodes included. With `"off": "mute"` on the card, use `2`.

To change a value in the file, change it in both `widgets_values` and
`widgets_values_named`. The two have to agree.

## Recipes

### An optional part

One row that turns some nodes off and on: an upscale at the end, say.

```json
"switches": [
  { "id": 1, "title": "Upscale", "nodes": [12, 13], "groups": [] }
]
```

To switch a whole group of nodes, put the group's `id` in `groups`.

### Pick one part

One pill: picking a name turns its nodes on and the other rows' nodes off. Open
it with one row's nodes at `0` and the rest at `4`. Up to 4 names sit in a
pill, more become a list.

```json
"exclusive": true,
"show": "pill",
"switches": [
  { "id": 1, "title": "Photo", "nodes": [20, 21], "groups": [] },
  { "id": 2, "title": "Drawing", "nodes": [22], "groups": [] }
]
```

A node both parts use goes in neither row.

### One switch that changes settings

The row sets values instead of turning nodes off. `on` and `off` are keyed by
node id, as text, then by control name. Give every node both sides.

```json
"switches": [
  {
    "id": 1,
    "title": "Fast",
    "nodes": [],
    "groups": [],
    "on": { "5": { "steps": 8 } },
    "off": { "5": { "steps": 20 } }
  }
]
```

Only values that differ between the two sides change. Values are text, numbers
or true/false.

A LoRA Loader 🆎 keeps its rows in one text value, `loras`. Save the whole text
on both sides with only the row's `enabled` different, and the switch moves
that row alone.

### Named choices

The simplest way to pick between settings, and to run one of two branches. Each
choice is one way of setting a node, so it has `on` and no `off`. A card of
choices is always one pill, so give other switches a card of their own.

To run one of two branches, wire both into ComfyUI's If/Else Switch (type
`ComfySwitchNode`, control `switch`, inputs `on_true` and `on_false`):

```json
"exclusive": true,
"show": "pill",
"switches": [
  { "id": 1, "title": "Soft", "choice": true, "nodes": [3], "groups": [], "on": { "6": { "switch": true } } },
  { "id": 2, "title": "Big", "choice": true, "nodes": [4, 5], "groups": [], "on": { "6": { "switch": false } } }
]
```

Here node 6 is the If/Else, and each choice's `nodes` are the nodes only that
branch needs. Open the file with the If/Else set to the picked choice, that
choice's nodes at `0` and the others' at `4`.

List a branch's nodes every time. ComfyUI checks every node that is on before
it runs anything, so a missing model in the branch nobody picked stops the run
unless its nodes are off.

Keep these out of a choice's `nodes`: the node the choice sets, because
switching it off would undo the choice, and any node both branches use. Both
branches must end in the same type, such as a picture.

### A row with two sides

`nodes_off` holds nodes that run only while the row is off. Use it when turning
one thing on should turn another off.

```json
{ "id": 1, "title": "Edit a picture", "nodes": [7], "groups": [], "nodes_off": [8] }
```

Open it with one side at `0` and the other at `4`.

## Check your work

Open the workflow in ComfyUI, then:

- **A row says "empty":** none of its ids match a node on the card's level.
- **A row says "mixed", or a pill shows no pick:** the saved `mode`s or values
  don't match any one row. Fix the starting state.
- **A row does nothing:** a value's control name is wrong, or both sides hold
  the same value.
- **A choice says "needs one more":** no other choice differs from it.

## Limits

A card holds up to 40 rows. A title is up to 60 characters, and a row up to
400 nodes. A row can set values on up to 40 nodes.
