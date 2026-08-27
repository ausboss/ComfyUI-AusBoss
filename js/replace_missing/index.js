// Replace Missing Nodes 🆎 — swap known third-party nodes for AusBoss ones.
//
// Detection finds nodes whose type is unregistered (missing-node
// placeholders after a workflow load) or registered third-party types the
// replace map knows. The command shows a preview dialog — what would
// change, per-node tier and flags, per-node opt-out — and only a confirmed
// apply rewrites the graph, recreate-style: snapshot, build the AusBoss
// node, carry translated widgets, remap links, and roll back on failure.
// This is purely a graph rewrite; no third-party class name is ever
// registered on the backend.
import { app } from "/scripts/app.js";
import { BRAND, notifyAusbossChange } from "../shared/index.mjs";
import {
  decodeWidgetValues,
  findReplacement,
  mapInputName,
  mapOutputSlot,
  planReplacements,
} from "../shared/replace_map.mjs";

const COMMAND_LABEL = "Replace with AusBoss nodes 🆎";

function notify(detail, severity = "info") {
  const toast = app.extensionManager?.toast;
  if (toast?.add) toast.add({ severity, summary: "AusBoss", detail, life: 5000 });
  else console.log(`[AusBoss] ${detail}`);
}

// graph.links is a plain object on older frontends and a Map on newer ones.
function lookupLink(graph, linkId) {
  if (linkId == null) return null;
  return graph.links?.get?.(linkId) ?? graph.links?.[linkId] ?? null;
}

function isRegistered(type) {
  return Boolean(globalThis.LiteGraph?.registered_node_types?.[type]);
}

// Live widgets when the definition exists; the serialized values (object or
// positional array) when the node is a missing-type placeholder.
function serializedWidgetValues(node) {
  if (Array.isArray(node.widgets) && node.widgets.length) {
    const values = {};
    for (const widget of node.widgets) {
      if (widget?.name != null) values[widget.name] = widget.value;
    }
    return values;
  }
  return node.widgets_values ?? null;
}

function collectCandidates(graph) {
  const candidates = [];
  for (const node of graph?._nodes ?? []) {
    const type = String(node?.comfyClass || node?.type || "");
    if (!type) continue;
    const registered = isRegistered(type);
    if (registered && !findReplacement(type)) continue;
    candidates.push({
      id: node.id,
      type,
      title: node.title,
      registered,
      widgetValues: serializedWidgetValues(node),
      node,
    });
  }
  return candidates;
}

function displayNameFor(type) {
  return globalThis.LiteGraph?.registered_node_types?.[type]?.title ?? type;
}

// ------------------------------------------------------------------- apply

// Same resolution discipline as Recreate node 🆎: everything becomes node
// ids and slot positions up front so the snapshot survives link teardown.
function snapshotNode(node, graph) {
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
    inputs,
    outputs,
    pos: [...node.pos],
    size: [...node.size],
    title: node.title,
    color: node.color,
    bgcolor: node.bgcolor,
    flags: { ...(node.flags || {}) },
    mode: node.mode,
  };
}

// A rollback has to hand back any target input the replacement's outputs
// stole from the original before the failure.
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

// Swap one node for its AusBoss replacement. Returns the names of links
// that could not carry across; throws (after rolling back) on hard failure.
function swapNode(row, graph) {
  const node = row.node;
  const entry = row.entry;
  let fresh = null;
  let shot = null;
  const dropped = [];
  try {
    shot = snapshotNode(node, graph);
    fresh = globalThis.LiteGraph.createNode(row.target);
    if (!fresh) throw new Error("no definition for " + row.target);
    graph.add(fresh);

    fresh.pos = [...shot.pos];
    // A custom title carries; the old node's default title must not — the
    // replacement keeps its own AusBoss display name. Placeholders title
    // themselves with the missing type, which counts as a default too.
    if (shot.title && shot.title !== row.type && shot.title !== node.constructor?.title) {
      fresh.title = shot.title;
    }
    // Assign undefined rather than delete so the properties stay reactive
    // under the Nodes 2.0 renderer.
    fresh.color = shot.color ?? undefined;
    fresh.bgcolor = shot.bgcolor ?? undefined;
    fresh.flags = { ...(fresh.flags || {}), ...shot.flags };
    if (typeof shot.mode === "number") fresh.mode = shot.mode;

    for (const widget of fresh.widgets || []) {
      if (widget.name in row.widgets) widget.value = row.widgets[widget.name];
    }

    for (const input of shot.inputs) {
      const newName = mapInputName(entry, input.name);
      const slot = newName != null ? fresh.findInputSlot?.(newName) : -1;
      const origin = graph.getNodeById(input.originId);
      // connect() runs LiteGraph's own type validation, so an incompatible
      // pair fails into the dropped list instead of mis-wiring the graph.
      const link =
        origin && slot != null && slot >= 0 ? origin.connect(input.originSlot, fresh, slot) : null;
      if (!link) dropped.push(`input ${input.name}`);
    }

    for (const output of shot.outputs) {
      const newSlot = mapOutputSlot(entry, output.slot);
      const valid = newSlot != null && newSlot >= 0 && (fresh.outputs || [])[newSlot];
      for (const target of output.targets) {
        const targetNode = graph.getNodeById(target.nodeId);
        const link = valid && targetNode ? fresh.connect(newSlot, targetNode, target.slot) : null;
        if (!link) dropped.push(`output ${output.name}`);
      }
    }

    // Size last, once widgets exist, and never below the definition minimum.
    const minimum = fresh.computeSize?.() || [0, 0];
    const size = [Math.max(shot.size[0], minimum[0]), Math.max(shot.size[1], minimum[1])];
    if (fresh.setSize) fresh.setSize(size);
    else fresh.size = size;

    graph.remove(node);
    return dropped;
  } catch (error) {
    try {
      if (fresh) graph.remove(fresh);
      if (shot) repairOriginalOutputs(node, shot, graph);
    } catch (rollbackError) {
      // Nothing more can be done safely; the caller still reports.
    }
    throw error;
  }
}

function applyPlan(rows) {
  const graph = app.graph;
  const replaced = [];
  const failed = [];
  let droppedCount = 0;
  // One gesture, one undo step: batch every swap between a single
  // beforeChange/afterChange pair, then let the tracker snapshot once.
  graph.beforeChange?.();
  try {
    for (const row of rows) {
      try {
        const dropped = swapNode(row, graph);
        replaced.push(row.type);
        droppedCount += dropped.length;
        if (dropped.length) {
          console.warn(
            `[AusBoss] Replace: ${row.type} #${row.id} carried over without ` +
              `${dropped.join(", ")} — reconnect those by hand.`
          );
        }
      } catch (error) {
        failed.push(row.type);
        console.warn(
          `[AusBoss] Replace rolled back ${row.type} #${row.id}; the original ` +
            `node was kept. ${error?.message || error}`
        );
      }
    }
  } finally {
    graph.afterChange?.();
    app.canvas?.setDirty?.(true, true);
    notifyAusbossChange();
  }
  let detail = `Replaced ${replaced.length} node${replaced.length === 1 ? "" : "s"}.`;
  if (droppedCount) detail += ` ${droppedCount} link${droppedCount === 1 ? "" : "s"} dropped (see console).`;
  if (failed.length) detail += ` ${failed.length} rolled back (see console).`;
  notify(detail, failed.length ? "warn" : "success");
}

// ------------------------------------------------------------------ dialog

const TIER_BADGE = {
  swap: { text: "swap", color: BRAND },
  pair: { text: "phase 2", color: "#8a7a3a" },
  refuse: { text: "no match", color: "#8a4a3a" },
  none: { text: "unknown", color: "#555" },
};

function ensureStyles() {
  if (document.getElementById("ausboss-replace-style")) return;
  const style = document.createElement("style");
  style.id = "ausboss-replace-style";
  style.textContent = `
    .ausboss-replace-overlay { position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,0.55); display: flex; align-items: center;
      justify-content: center; }
    .ausboss-replace-dialog { background: #181818; color: #ddd;
      border: 1px solid #333; border-top: 2px solid ${BRAND};
      border-radius: 8px; width: min(640px, 92vw); max-height: 82vh;
      display: flex; flex-direction: column;
      font: 13px/1.45 sans-serif; box-shadow: 0 12px 40px rgba(0,0,0,0.5); }
    .ausboss-replace-dialog header { padding: 12px 16px 4px; font-size: 15px;
      font-weight: 600; }
    .ausboss-replace-dialog .ausboss-replace-sub { padding: 0 16px 10px;
      color: #999; }
    .ausboss-replace-list { overflow-y: auto; padding: 0 8px;
      border-top: 1px solid #2a2a2a; border-bottom: 1px solid #2a2a2a; }
    .ausboss-replace-row { display: flex; gap: 10px; padding: 10px 8px;
      border-bottom: 1px solid #222; align-items: flex-start; }
    .ausboss-replace-row:last-child { border-bottom: none; }
    .ausboss-replace-row input { margin-top: 3px; accent-color: ${BRAND}; }
    .ausboss-replace-badge { flex: none; margin-top: 1px; padding: 1px 7px;
      border-radius: 9px; font-size: 11px; color: #101010; font-weight: 600; }
    .ausboss-replace-what { min-width: 0; }
    .ausboss-replace-arrow { color: ${BRAND}; }
    .ausboss-replace-note { color: #b09a55; }
    .ausboss-replace-reason { color: #999; }
    .ausboss-replace-dialog footer { padding: 12px 16px; display: flex;
      gap: 10px; justify-content: flex-end; }
    .ausboss-replace-dialog button { padding: 6px 16px; border-radius: 5px;
      border: 1px solid #444; background: #262626; color: #ddd;
      cursor: pointer; font: inherit; }
    .ausboss-replace-dialog button.ausboss-replace-apply {
      background: ${BRAND}; border-color: ${BRAND}; color: #081413;
      font-weight: 600; }
    .ausboss-replace-dialog button:disabled { opacity: 0.45; cursor: default; }
  `;
  document.head.appendChild(style);
}

function line(parent, className, text) {
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;
  parent.appendChild(div);
  return div;
}

function showPlanDialog(rows) {
  ensureStyles();
  const overlay = document.createElement("div");
  overlay.className = "ausboss-replace-overlay";
  const dialog = document.createElement("div");
  dialog.className = "ausboss-replace-dialog";
  overlay.appendChild(dialog);

  const header = document.createElement("header");
  header.textContent = COMMAND_LABEL;
  dialog.appendChild(header);
  line(dialog, "ausboss-replace-sub", "Preview — nothing changes until you apply. Untick a row to keep that node.");

  const list = document.createElement("div");
  list.className = "ausboss-replace-list";
  dialog.appendChild(list);

  const checks = [];
  for (const row of rows) {
    const rowEl = document.createElement("label");
    rowEl.className = "ausboss-replace-row";

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = row.tier === "swap";
    check.disabled = row.tier !== "swap";
    rowEl.appendChild(check);
    checks.push({ check, row });

    const badgeSpec = TIER_BADGE[row.tier] ?? TIER_BADGE.none;
    const badge = document.createElement("span");
    badge.className = "ausboss-replace-badge";
    badge.textContent = badgeSpec.text;
    badge.style.background = badgeSpec.color;
    rowEl.appendChild(badge);

    const what = document.createElement("div");
    what.className = "ausboss-replace-what";
    const head = document.createElement("div");
    head.append(`#${row.id} ${row.title ? row.title + " — " : ""}${row.type}`);
    if (row.target && row.tier === "swap") {
      const arrow = document.createElement("span");
      arrow.className = "ausboss-replace-arrow";
      arrow.textContent = "  →  ";
      head.append(arrow, displayNameFor(row.target));
    }
    what.appendChild(head);
    for (const flag of row.flags) line(what, "ausboss-replace-note", "⚠ " + flag);
    if (row.reason) line(what, "ausboss-replace-reason", row.reason);
    rowEl.appendChild(what);
    list.appendChild(rowEl);
  }

  const footer = document.createElement("footer");
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  const apply = document.createElement("button");
  apply.className = "ausboss-replace-apply";
  const close = () => overlay.remove();
  const refreshApply = () => {
    const count = checks.filter((c) => c.check.checked).length;
    apply.textContent = count ? `Replace ${count} node${count === 1 ? "" : "s"}` : "Replace";
    apply.disabled = !count;
  };
  for (const { check } of checks) check.addEventListener("change", refreshApply);
  refreshApply();
  cancel.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  apply.addEventListener("click", () => {
    const selected = checks.filter((c) => c.check.checked).map((c) => c.row);
    close();
    if (selected.length) applyPlan(selected);
  });
  footer.append(cancel, apply);
  dialog.appendChild(footer);
  document.body.appendChild(overlay);
}

// ----------------------------------------------------------------- command

function run() {
  const candidates = collectCandidates(app.graph);
  const rows = planReplacements(candidates, {});
  if (!rows.length) {
    notify("No replaceable third-party nodes in this workflow.");
    return;
  }
  // planReplacements copies row data; reattach the live nodes for apply.
  const byId = new Map(candidates.map((c) => [c.id, c.node]));
  for (const row of rows) row.node = byId.get(row.id);
  showPlanDialog(rows);
}

app.registerExtension({
  name: "ausboss.replace.missing",
  commands: [
    { id: "AusBoss.ReplaceMissing", label: "AusBoss: " + COMMAND_LABEL, function: run },
  ],
  getCanvasMenuItems() {
    return [{ content: COMMAND_LABEL, callback: run }];
  },
});
