// Workflow Switches: the decisions behind js/workflow_switches/index.js.
// Which nodes a switch holds, whether it reads on, off or mixed, which rows
// the card lists and in what order, and which node modes a click changes. No
// DOM and no app import, so tests/workflow_switches.test.mjs runs it under
// node:test.
//
// A switch is either one the user made from picked nodes and groups (stored
// in the node's properties, by id) or a group listed on its own. The truth
// lives in the nodes' own modes. Nothing here remembers what a switch was;
// every answer is read fresh from the graph, which is why a saved workflow,
// an undo or a mode changed by hand elsewhere always shows right.

// LiteGraph's node modes. Mute is the frontend's "never".
export const MODE_ALWAYS = 0;
export const MODE_NEVER = 2;
export const MODE_BYPASS = 4;

export const SETTINGS_PROPERTY = "ausboss_workflow_switches";

export const TITLE_MAX = 60;
export const SWITCHES_MAX = 40;
export const MEMBERS_MAX = 400;

export const DEFAULT_SETTINGS = Object.freeze({
  off: "bypass", // what a switched-off part does: "bypass" | "mute"
  groups: "all", // which groups get a row of their own: "all" | "numbered" | "matching" | "none"
  match: "", // comma-separated title text, read when groups is "matching"
  order: "canvas", // group rows: "canvas" (the way the workflow reads) | "title"
  exclusive: false, // one at a time: switching a row on switches the other rows off
  switches: Object.freeze([]), // the switches made from picked nodes: { id, title, nodes, groups }
});

const CHOICES = {
  off: ["bypass", "mute"],
  groups: ["all", "numbered", "matching", "none"],
  order: ["canvas", "title"],
};

export function cleanTitle(title) {
  return String(title ?? "").replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
}

// Node and group ids as a workflow stores them: numbers, or text for a
// frontend that names them. Anything else is dropped, and so is a repeat.
export function cleanIds(list, limit = MEMBERS_MAX) {
  const seen = new Set();
  const ids = [];
  for (const raw of Array.isArray(list) ? list : []) {
    let id = null;
    if (typeof raw === "number" && Number.isFinite(raw)) id = raw;
    else if (typeof raw === "string" && raw.trim()) id = raw.trim();
    if (id === null || seen.has(String(id))) continue;
    seen.add(String(id));
    ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

// The made switches, whatever a saved workflow or a hand edit left there.
// Every switch keeps a small whole-number id of its own; a missing or
// repeated one is replaced, so two rows are never told apart by title.
export function normalizeSwitches(raw) {
  const switches = [];
  const used = new Set();
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item !== "object") continue;
    let id = Number(item.id);
    if (!Number.isInteger(id) || id < 1 || used.has(id)) {
      id = 1;
      while (used.has(id)) id += 1;
    }
    used.add(id);
    switches.push({
      id,
      title: cleanTitle(item.title) || `Switch ${id}`,
      nodes: cleanIds(item.nodes),
      groups: cleanIds(item.groups),
    });
    if (switches.length >= SWITCHES_MAX) break;
  }
  return switches;
}

// Settings from a node property: unknown values fall back to the defaults,
// never throw.
export function normalizeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const settings = { ...DEFAULT_SETTINGS };
  for (const [key, allowed] of Object.entries(CHOICES)) {
    if (allowed.includes(source[key])) settings[key] = source[key];
  }
  if (typeof source.match === "string") settings.match = source.match.slice(0, 200);
  if (typeof source.exclusive === "boolean") settings.exclusive = source.exclusive;
  settings.switches = normalizeSwitches(source.switches);
  return settings;
}

export function offMode(settings) {
  return settings?.off === "mute" ? MODE_NEVER : MODE_BYPASS;
}

// A node runs unless it is muted or bypassed.
export function isRunning(mode) {
  return mode !== MODE_NEVER && mode !== MODE_BYPASS;
}

// ---------- geometry ----------

// Half-open, like LiteGraph's own isInRect: a point on a box's right or
// bottom edge is outside it, so two boxes that touch never share a node.
export function isInRect(x, y, rect) {
  return x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3];
}

// The rule the frontend uses to decide what moves with a group: a node
// belongs to every group whose box holds the centre of the node's box.
export function centreInside(rect, bounds) {
  return isInRect(bounds[0] + bounds[2] * 0.5, bounds[1] + bounds[3] * 0.5, rect);
}

function usableRect(rect) {
  return (
    rect != null && typeof rect.length === "number" && rect.length >= 4
    && [0, 1, 2, 3].every((index) => Number.isFinite(Number(rect[index])))
    && (Number(rect[2]) > 0 || Number(rect[3]) > 0)
  );
}

function toRect(rect) {
  return [Number(rect[0]), Number(rect[1]), Number(rect[2]), Number(rect[3])];
}

// A node's box as LiteGraph measures it: the body plus its title bar. The
// canvas re-measures every node on every frame it draws (the same pass that
// decides which nodes are visible), so the cached boundingRect is current;
// a node never measured yet is measured here from its position and size.
export function nodeBounds(node, { titleHeight = 30, collapsedWidth = 80 } = {}) {
  if (usableRect(node?.boundingRect)) return toRect(node.boundingRect);
  const pos = node?.pos ?? [0, 0];
  const size = node?.size ?? [0, 0];
  // Title modes: 1 = no title, 2 = transparent title; neither adds a bar.
  const bar = node?.title_mode === 1 || node?.title_mode === 2 ? 0 : titleHeight;
  const x = Number(pos[0]) || 0;
  const y = (Number(pos[1]) || 0) - bar;
  if (node?.flags?.collapsed) return [x, y, Number(node._collapsed_width) || collapsedWidth, titleHeight];
  return [x, y, Number(size[0]) || 0, (Number(size[1]) || 0) + bar];
}

export function groupBounds(group) {
  for (const rect of [group?.boundingRect, group?._bounding]) {
    if (usableRect(rect)) return toRect(rect);
  }
  const pos = group?.pos ?? [0, 0];
  const size = group?.size ?? [0, 0];
  return [Number(pos[0]) || 0, Number(pos[1]) || 0, Number(size[0]) || 0, Number(size[1]) || 0];
}

// The smallest box around several boxes, or null for none: what the frame
// button brings into view for a switch whose nodes sit apart.
export function unionRect(rects) {
  let box = null;
  for (const rect of rects ?? []) {
    if (!usableRect(rect)) continue;
    const [x, y, w, h] = toRect(rect);
    if (!box) box = [x, y, x + w, y + h];
    else box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x + w), Math.max(box[3], y + h)];
  }
  return box ? [box[0], box[1], box[2] - box[0], box[3] - box[1]] : null;
}

// ---------- reading a graph ----------

// Whether a node's mode changes what a run does. A subgraph node's does
// (while it is off nothing inside it runs) even though the frontend calls it
// virtual; other virtual nodes - notes, primitives, reroute nodes - never
// run, and neither does a node with no outputs that is not an output node (a
// Workflow Note, a Run Timer). Those still switch with their part, but they
// never make it read mixed.
export function modeMatters(node) {
  if (node?.isSubgraphNode?.() === true) return true;
  if (node?.isVirtualNode) return false;
  const definition = node?.constructor?.nodeData;
  if (definition && !definition.output_node && !(node.outputs?.length > 0)) return false;
  return true;
}

// What a switch shows. Only nodes whose mode changes a run are counted (a
// note inside a group never makes it read "mixed"); a part of nothing but
// such nodes is read from all of them, and one holding no node at all is
// "empty".
export function partState(members, counts = () => true) {
  const counted = members.filter(counts);
  const pool = counted.length ? counted : members;
  if (!pool.length) return { state: "empty", on: 0, total: 0 };
  const on = pool.filter((node) => isRunning(node.mode)).length;
  const state = on === 0 ? "off" : on === pool.length ? "on" : "mixed";
  return { state, on, total: pool.length };
}

// Every node a switch may touch, with its box. `skip` leaves nodes out
// entirely (a Workflow Switches node never switches itself or another one).
export function placeNodes(nodes, { skip = () => false, measure = {} } = {}) {
  const placed = [];
  for (const node of nodes ?? []) {
    if (!node || skip(node)) continue;
    placed.push({ node, rect: nodeBounds(node, measure) });
  }
  return placed;
}

// Every group of a graph with the nodes inside it and its state. `counts`
// says whose mode decides the state (see partState).
export function readGroups(groups, placed, { counts = () => true } = {}) {
  return [...(groups ?? [])].filter(Boolean).map((group) => {
    const rect = groupBounds(group);
    const members = placed.filter((entry) => centreInside(rect, entry.rect)).map((entry) => entry.node);
    return {
      kind: "group",
      group,
      rect,
      title: String(group.title ?? ""),
      color: typeof group.color === "string" && group.color ? group.color : null,
      members,
      ...partState(members, counts),
    };
  });
}

// The made switches with the nodes they hold right now: the picked nodes
// that still exist, plus whatever sits inside a picked group at this moment.
// An id whose node or group is gone is passed over, never removed here: a
// graph that is still loading has not got all its nodes yet.
export function readSwitches(switches, placed, groupRows, { counts = () => true } = {}) {
  const nodeById = new Map(placed.map((entry) => [String(entry.node.id), entry]));
  const groupById = new Map();
  for (const row of groupRows ?? []) {
    const id = row.group?.id;
    if (id !== undefined && id !== null && !groupById.has(String(id))) groupById.set(String(id), row);
  }
  return (switches ?? []).map((entry) => {
    const members = [];
    const seen = new Set();
    const rects = [];
    let gone = 0;
    for (const id of entry.nodes ?? []) {
      const hit = nodeById.get(String(id));
      if (!hit) {
        gone += 1;
        continue;
      }
      if (seen.has(hit.node)) continue;
      seen.add(hit.node);
      members.push(hit.node);
      rects.push(hit.rect);
    }
    for (const id of entry.groups ?? []) {
      const row = groupById.get(String(id));
      if (!row) {
        gone += 1;
        continue;
      }
      rects.push(row.rect);
      for (const node of row.members) {
        if (seen.has(node)) continue;
        seen.add(node);
        members.push(node);
      }
    }
    return {
      kind: "switch",
      entry,
      rect: unionRect(rects),
      title: entry.title,
      color: null,
      members,
      gone,
      ...partState(members, counts),
    };
  });
}

// ---------- which groups, in which order ----------

export function matchTerms(text) {
  return String(text ?? "")
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

// "numbered" keeps the titles that start with a digit - the stage groups of
// a workflow laid out as 1 · Load, 2 · Create, ... - and "matching" keeps
// titles containing any of the comma-separated terms (no terms, no filter).
// "none" lists no group at all: only the made switches show.
export function groupListed(title, settings) {
  const text = String(title ?? "").trim();
  if (settings?.groups === "none") return false;
  if (settings?.groups === "numbered") return /^\d/.test(text);
  if (settings?.groups === "matching") {
    const terms = matchTerms(settings.match);
    const lower = text.toLowerCase();
    return !terms.length || terms.some((term) => lower.includes(term));
  }
  return true;
}

// Canvas order is the way a left-to-right workflow reads: column by column,
// and top to bottom inside a column. A group joins the column on its left
// when it starts before that column's narrowest centre line, so a stage
// stacked under another reads straight after it (1, 2 | 3, 4 | 5 ...), where
// a row-by-row order would jump across the canvas and back.
export function canvasOrder(items, rectOf = (item) => item.rect) {
  const sorted = [...items].sort((a, b) => rectOf(a)[0] - rectOf(b)[0] || rectOf(a)[1] - rectOf(b)[1]);
  const columns = [];
  let column = null;
  let centre = Infinity;
  for (const item of sorted) {
    const [x, , w] = rectOf(item);
    if (column && x < centre) {
      column.push(item);
      centre = Math.min(centre, x + w * 0.5);
      continue;
    }
    column = [item];
    centre = x + w * 0.5;
    columns.push(column);
  }
  return columns.flatMap((members) => members.sort((a, b) => rectOf(a)[1] - rectOf(b)[1] || rectOf(a)[0] - rectOf(b)[0]));
}

const TITLE_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

// Title order compares numbers as numbers, so "10 · Save" follows "9 · Upscale".
export function titleOrder(items, titleOf = (item) => item.title) {
  const canvas = canvasOrder(items);
  const place = new Map(canvas.map((item, index) => [item, index]));
  return [...items].sort((a, b) => TITLE_COLLATOR.compare(titleOf(a), titleOf(b)) || place.get(a) - place.get(b));
}

// The rows the card shows: the made switches in the order they were made
// (or moved to), then the listed groups in the chosen order.
export function listedRows(switchRows, groupRows, settings) {
  const listed = (groupRows ?? []).filter((row) => groupListed(row.title, settings));
  const ordered = settings?.order === "title" ? titleOrder(listed) : canvasOrder(listed);
  return [...(switchRows ?? []), ...ordered];
}

// ---------- switching ----------

// The mode changes one click makes: every node of the row turns on (always)
// or off (bypass or mute), exactly what the frontend's own "Bypass Group
// Nodes" / "Set Group Nodes to Always" do. One at a time first turns every
// other listed row off and then this one on, so a node two rows share ends
// up on. Returns [node, mode] pairs for the nodes that change.
export function switchPlan(rows, target, on, settings) {
  const off = offMode(settings);
  const modes = new Map();
  if (on && settings?.exclusive) {
    for (const row of rows) {
      if (row === target) continue;
      for (const node of row.members) modes.set(node, off);
    }
  }
  for (const node of target?.members ?? []) modes.set(node, on ? MODE_ALWAYS : off);
  return [...modes].filter(([node, mode]) => node.mode !== mode);
}

// Every listed row on or off at once (the node's right-click menu).
export function switchAllPlan(rows, on, settings) {
  const mode = on ? MODE_ALWAYS : offMode(settings);
  const modes = new Map();
  for (const row of rows) for (const node of row.members) modes.set(node, mode);
  return [...modes].filter(([node, value]) => node.mode !== value);
}

// ---------- making and changing switches ----------

function withSwitches(settings, switches) {
  return { ...normalizeSettings(settings), switches };
}

function pickedIds(picked) {
  return { nodes: cleanIds(picked?.nodes), groups: cleanIds(picked?.groups) };
}

// A name for a new switch, from what was picked: the one box (subgraph) in
// the selection, else the one group, else the first node. `picked` carries
// titles here, not ids: { nodes: [{ title, box }], groups: [{ title }] }.
// A name already on the card gets a number, so two rows never read the same.
export function suggestTitle(picked, taken = []) {
  const nodes = picked?.nodes ?? [];
  const groups = picked?.groups ?? [];
  const boxes = nodes.filter((node) => node?.box);
  let base = "";
  if (boxes.length === 1) base = boxes[0].title;
  else if (groups.length === 1) base = groups[0].title;
  else if (nodes.length) base = nodes[0].title;
  else if (groups.length) base = groups[0].title;
  base = cleanTitle(base) || "Switch";
  const used = new Set(taken.map((title) => cleanTitle(title).toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let number = 2; number < 1000; number += 1) {
    const next = cleanTitle(`${base.slice(0, TITLE_MAX - 4)} ${number}`);
    if (!used.has(next.toLowerCase())) return next;
  }
  return base;
}

// A new switch at the end of the list. Returns the new settings and the
// switch's id, or id null when there is no room for another.
export function addSwitch(settings, { title, nodes, groups } = {}) {
  const current = normalizeSettings(settings);
  if (current.switches.length >= SWITCHES_MAX) return { settings: current, id: null };
  const id = current.switches.reduce((highest, entry) => Math.max(highest, entry.id), 0) + 1;
  const entry = { id, title: cleanTitle(title) || `Switch ${id}`, ...pickedIds({ nodes, groups }) };
  return { settings: withSwitches(current, [...current.switches, entry]), id };
}

function changeSwitch(settings, id, change) {
  const current = normalizeSettings(settings);
  return withSwitches(current, current.switches.map((entry) => (entry.id === id ? { ...entry, ...change(entry) } : entry)));
}

// An empty name keeps the old one: a switch is never left without a label.
export function renameSwitch(settings, id, title) {
  const next = cleanTitle(title);
  return changeSwitch(settings, id, (entry) => ({ title: next || entry.title }));
}

export function removeSwitch(settings, id) {
  const current = normalizeSettings(settings);
  return withSwitches(current, current.switches.filter((entry) => entry.id !== id));
}

// One place up (-1) or down (+1) the list; the ends stay put.
export function moveSwitch(settings, id, step) {
  const current = normalizeSettings(settings);
  const from = current.switches.findIndex((entry) => entry.id === id);
  const to = from + (step < 0 ? -1 : 1);
  if (from < 0 || to < 0 || to >= current.switches.length) return current;
  const switches = [...current.switches];
  [switches[from], switches[to]] = [switches[to], switches[from]];
  return withSwitches(current, switches);
}

export function addMembers(settings, id, picked) {
  const extra = pickedIds(picked);
  return changeSwitch(settings, id, (entry) => ({
    nodes: cleanIds([...entry.nodes, ...extra.nodes]),
    groups: cleanIds([...entry.groups, ...extra.groups]),
  }));
}

export function removeMembers(settings, id, picked) {
  const drop = pickedIds(picked);
  const nodes = new Set(drop.nodes.map(String));
  const groups = new Set(drop.groups.map(String));
  return changeSwitch(settings, id, (entry) => ({
    nodes: entry.nodes.filter((member) => !nodes.has(String(member))),
    groups: entry.groups.filter((member) => !groups.has(String(member))),
  }));
}

// How many of the picked nodes and groups a switch already holds.
export function heldCount(entry, picked) {
  const want = pickedIds(picked);
  const nodes = new Set((entry?.nodes ?? []).map(String));
  const groups = new Set((entry?.groups ?? []).map(String));
  return want.nodes.filter((id) => nodes.has(String(id))).length + want.groups.filter((id) => groups.has(String(id))).length;
}

// ---------- change detection ----------

// Everything the card draws, as one string: when it matches the last one,
// the redraw that asked has nothing to update.
export function rowsSignature(rows, settings, keyOf = (row) => row.title) {
  return JSON.stringify([
    settings,
    rows.map((row) => [row.kind, keyOf(row), row.title, row.color, row.state, row.on, row.total, row.members?.length ?? 0, row.gone ?? 0]),
  ]);
}
