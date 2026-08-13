// Recreate node (AusBoss) — right-click utility on every AusBoss node.
//
// After a node definition changes (new widget, renamed slot, updated
// defaults), instances saved in open workflows keep their stale shape.
// This rebuilds the instance from the current definition: widget values
// are carried over by name, links are re-attached by slot name, and
// position/size/title/colors/flags/mode/properties survive. Slots or
// widgets that no longer exist are skipped silently. Any failure rolls
// the graph back and keeps the original node.
import { app } from "/scripts/app.js";

const MENU_LABEL = "Recreate node (AusBoss)";

function isAusbossNode(node) {
  const comfyClass = node?.comfyClass || "";
  return comfyClass.startsWith("AUSBOSS_NODES_") || comfyClass === "SimpleWatermarkRemover";
}

// graph.links is a plain object on older frontends and a Map on newer ones.
function lookupLink(graph, linkId) {
  if (linkId == null) return null;
  return graph.links?.get?.(linkId) ?? graph.links?.[linkId] ?? null;
}

// Resolve everything to node ids and slot positions up front so the
// snapshot stays valid even after individual links are torn down.
function snapshotNode(node, graph) {
  const widgetValues = new Map();
  for (const widget of node.widgets || []) widgetValues.set(widget.name, widget.value);

  const inputs = [];
  for (const input of node.inputs || []) {
    const link = lookupLink(graph, input.link);
    if (!link) continue;
    inputs.push({ name: input.name, originId: link.origin_id, originSlot: link.origin_slot });
  }

  const outputs = [];
  (node.outputs || []).forEach((output, slot) => {
    const targets = [];
    for (const linkId of output.links || []) {
      const link = lookupLink(graph, linkId);
      if (link) targets.push({ nodeId: link.target_id, slot: link.target_slot });
    }
    if (targets.length) outputs.push({ name: output.name, slot, targets });
  });

  return {
    widgetValues,
    inputs,
    outputs,
    pos: [...node.pos],
    size: [...node.size],
    title: node.title,
    color: node.color,
    bgcolor: node.bgcolor,
    flags: { ...(node.flags || {}) },
    mode: node.mode,
    properties: { ...(node.properties || {}) },
  };
}

function applySnapshot(fresh, shot) {
  fresh.pos = [...shot.pos];
  if (shot.title != null) fresh.title = shot.title;
  // Assign undefined rather than delete so the properties stay reactive
  // under the Nodes 2.0 renderer.
  fresh.color = shot.color ?? undefined;
  fresh.bgcolor = shot.bgcolor ?? undefined;
  fresh.flags = { ...(fresh.flags || {}), ...shot.flags };
  if (typeof shot.mode === "number") fresh.mode = shot.mode;
  fresh.properties = { ...(fresh.properties || {}), ...shot.properties };

  for (const widget of fresh.widgets || []) {
    if (shot.widgetValues.has(widget.name)) widget.value = shot.widgetValues.get(widget.name);
  }

  // Size last, once widgets exist, and never below the definition minimum.
  const minimum = fresh.computeSize?.() || [0, 0];
  const size = [Math.max(shot.size[0], minimum[0]), Math.max(shot.size[1], minimum[1])];
  if (fresh.setSize) fresh.setSize(size);
  else fresh.size = size;
}

function reconnectInputs(fresh, shot, graph) {
  for (const input of shot.inputs) {
    const origin = graph.getNodeById(input.originId);
    const slot = fresh.findInputSlot?.(input.name);
    if (!origin || slot == null || slot < 0) continue; // vanished slot
    origin.connect(input.originSlot, fresh, slot);
  }
}

function reconnectOutputs(fresh, shot, graph) {
  for (const output of shot.outputs) {
    const slot = fresh.findOutputSlot?.(output.name);
    if (slot == null || slot < 0) continue; // vanished slot
    for (const target of output.targets) {
      const targetNode = graph.getNodeById(target.nodeId);
      if (targetNode) fresh.connect(slot, targetNode, target.slot);
    }
  }
}

// Wiring the replacement's outputs steals the target inputs from the
// original, so a rollback has to hand any stolen link back.
function repairOriginalOutputs(node, shot, graph) {
  for (const output of shot.outputs) {
    for (const target of output.targets) {
      const targetNode = graph.getNodeById(target.nodeId);
      if (!targetNode) continue;
      const current = lookupLink(graph, targetNode.inputs?.[target.slot]?.link);
      if (current?.origin_id === node.id) continue; // never stolen
      node.connect(output.slot, targetNode, target.slot);
    }
  }
}

function rebuildNode(node) {
  const graph = node.graph || app.graph;
  let fresh = null;
  let shot = null;
  try {
    shot = snapshotNode(node, graph);
    fresh = globalThis.LiteGraph.createNode(node.comfyClass || node.type);
    if (!fresh) throw new Error("no current definition for " + node.type);
    graph.add(fresh);
    applySnapshot(fresh, shot);
    reconnectInputs(fresh, shot, graph);
    reconnectOutputs(fresh, shot, graph);
    graph.remove(node);
    graph.afterChange?.();
    app.canvas?.setDirty?.(true, true);
  } catch (error) {
    try {
      if (fresh) graph.remove(fresh);
      if (shot) repairOriginalOutputs(node, shot, graph);
      app.canvas?.setDirty?.(true, true);
    } catch (rollbackError) {
      // Nothing more can be done safely; the warn below still fires.
    }
    console.warn(
      "[AusBoss] Recreate node rolled back; the original node was kept. " +
        (error?.message || error)
    );
  }
}

app.registerExtension({
  name: "AusBoss.RecreateNode",
  getNodeMenuItems(node) {
    if (!isAusbossNode(node)) return [];
    return [{ content: MENU_LABEL, callback: () => rebuildNode(node) }];
  },
});
