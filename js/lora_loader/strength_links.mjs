// A row's strength can come in on a link: drag a number wire onto a row and
// let go. The link lands on a hidden input named strength_<row id> that sits
// on the node's left edge at that row's height. Nothing marks the spot until
// a number wire is dragged over the node: then the row under the pointer
// lights up. Once linked, the row's strength box shows the incoming value,
// and the wire is shown, shown on hover, or hidden (gear menu).
//
// How the input stays out of sight: the frontend treats an input that names
// a widget as a widget's socket. It leaves such a socket out of the node's
// height, draws it only while a link is dragged or hovered or once it is
// connected, and keeps the position it is given when no widget by that name
// exists. The socket is also drawn in a clear colour, so a linked row shows
// no dot. The frontend does not hit-test such a socket either, so the
// loader's getInputOnPos finds the row under a drop itself.
//
// The frontend also removes, when a workflow loads, every widget socket
// whose widget it cannot find. So the input is saved as a plain input and
// becomes a widget socket again once the workflow has loaded.

import { chainCallback } from "../shared/index.mjs";

const NAME = /^strength_[A-Za-z0-9_-]{1,64}$/;
const CLEAR = "rgba(0,0,0,0)";
// Where the hidden socket sits from the node's left edge, as the frontend
// places a widget's socket.
const SOCKET_X = 10;
const NUMBER_TYPES = new Set(["FLOAT", "INT"]);
export const WIRE_LOOKS = ["shown", "on hover", "hidden"];
// The canvas skips drawing a wire it is told is being dragged, shadow and
// all, so a hidden wire carries that mark. The mark is not saved.

export const rowInputName = (rowId) => `strength_${rowId}`;
export const isRowInput = (input) => typeof input?.name === "string" && NAME.test(input.name);
const rowIdOf = (input) => input.name.slice("strength_".length);

const states = new Set();
let watching = false;
let hoverTarget = null;

function canvasOf(app) {
  return app?.canvas ?? null;
}

function clientPoint(app, x, y) {
  const canvas = canvasOf(app);
  const rect = canvas.canvas.getBoundingClientRect();
  const scale = canvas.ds.scale || 1;
  const [ox, oy] = canvas.ds.offset;
  return [rect.left + (x + ox) * scale, rect.top + (y + oy) * scale];
}

function graphPoint(app, clientX, clientY) {
  const canvas = canvasOf(app);
  const rect = canvas.canvas.getBoundingClientRect();
  const scale = canvas.ds.scale || 1;
  const [ox, oy] = canvas.ds.offset;
  return [(clientX - rect.left) / scale - ox, (clientY - rect.top) / scale - oy];
}

function linkOf(graph, id) {
  if (id === null || id === undefined || !graph) return null;
  return graph.links?.get?.(id) ?? graph.links?.[id] ?? graph._links?.get?.(id) ?? null;
}

function rowElements(state) {
  return [...state.panel.querySelectorAll(".ausboss-lora-row")]
    .filter((element) => !element.classList.contains("folded-away"));
}

function rowElement(state, rowId) {
  return rowElements(state).find((element) => element.dataset.rowId === rowId) ?? null;
}

// The row under a point in client pixels: anywhere across the node's width,
// so a drop does not have to hit the strength box itself.
function rowAtClient(state, clientX, clientY) {
  const node = state.node;
  const app = state.app;
  const [left] = clientPoint(app, node.pos[0], node.pos[1]);
  const [right] = clientPoint(app, node.pos[0] + node.size[0], node.pos[1]);
  if (clientX < left - 4 || clientX > right + 4) return null;
  for (const element of rowElements(state)) {
    const rect = element.getBoundingClientRect();
    if (clientY >= rect.top - 3 && clientY <= rect.bottom + 3) return element;
  }
  return null;
}

function isNumberDrag(app) {
  const connector = canvasOf(app)?.linkConnector;
  if (!connector?.isConnecting) return false;
  if (connector.state?.connectingTo && connector.state.connectingTo !== "input") return false;
  const types = (connector.renderLinks ?? []).map((link) => String(link?.fromSlot?.type ?? ""));
  return types.length > 0 && types.every((type) => type.split(",").some((part) => NUMBER_TYPES.has(part.trim())));
}

export function rowInputs(node) {
  return (node.inputs ?? []).filter(isRowInput);
}

// {row id: {input, link, source}} for every row a link sets now.
export function linkedRows(node) {
  const found = new Map();
  for (const input of rowInputs(node)) {
    const link = linkOf(node.graph, input.link);
    if (!link) continue;
    const source = node.graph?.getNodeById?.(link.origin_id) ?? null;
    found.set(rowIdOf(input), { input, link, source });
  }
  return found;
}

// What a linked row shows: the source's own number when it has one in
// sight (a Float or Int node, a slider), else just that it is linked.
export function sourceValue(entry) {
  const widgets = entry?.source?.widgets ?? [];
  const widget = widgets.find((item) => item.name === "value") ?? widgets.find((item) => typeof item.value === "number");
  return typeof widget?.value === "number" ? widget.value : null;
}

export function sourceTitle(entry) {
  return String(entry?.source?.title || entry?.source?.type || "another node");
}

function placeInput(state, input) {
  const element = rowElement(state, rowIdOf(input));
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const [, y] = graphPoint(state.app, 0, rect.top + rect.height / 2);
  const pos = [SOCKET_X, Math.round((y - state.node.pos[1]) * 10) / 10];
  if (input.pos?.[0] !== pos[0] || input.pos?.[1] !== pos[1]) input.pos = pos;
}

const HIDDEN = () => ({ label: " ", localized_name: " ", color_on: CLEAR, color_off: CLEAR });

function hideInput(input) {
  Object.assign(input, HIDDEN());
  if (!input.widget) input.widget = { name: input.name };
}

function ensureRowInput(state, rowId) {
  const node = state.node;
  const name = rowInputName(rowId);
  let input = node.inputs?.find((item) => item.name === name);
  if (!input) input = node.addInput(name, "FLOAT,INT", { ...HIDDEN(), widget: { name } });
  placeInput(state, input);
  return input;
}

export function unlinkRow(state, rowId) {
  const node = state.node;
  const index = (node.inputs ?? []).findIndex((input) => input.name === rowInputName(rowId));
  if (index < 0) return;
  node.removeInput(index);
  node.setDirtyCanvas?.(true, true);
}

function wireHidden(state, entry) {
  const look = state.settings?.strength_wires ?? "on hover";
  if (look === "hidden") return true;
  return look === "on hover" && hoverTarget !== state.node && hoverTarget !== entry.source;
}

function setWireHidden(entry, hidden) {
  const link = entry.link;
  if (hidden === Boolean(link._dragging)) return false;
  // A wire the user is moving keeps the mark the canvas gave it.
  if (!hidden && link.__ausbossHidden !== true) return false;
  link._dragging = hidden;
  link.__ausbossHidden = hidden;
  return true;
}

// Keep the hidden inputs in step with the rows: drop the ones nothing is
// linked to or whose row is gone, move each to its row, colour its wire.
// Returns the linked rows.
export function syncStrengthLinks(state) {
  const node = state.node;
  const connecting = canvasOf(state.app)?.linkConnector?.isConnecting;
  // Rows not yet read from a workflow that is loading say nothing about
  // which inputs are stale.
  const rowsCurrent = state.widget && state.renderedValue === state.widget.value;
  if (!connecting && rowsCurrent) {
    const ids = new Set(state.rows.map((row) => row.id));
    for (let index = (node.inputs?.length ?? 0) - 1; index >= 0; index -= 1) {
      const input = node.inputs[index];
      if (!isRowInput(input)) continue;
      if (!ids.has(rowIdOf(input)) || !linkOf(node.graph, input.link)) node.removeInput(index);
    }
  }
  for (const input of rowInputs(node)) placeInput(state, input);
  const linked = linkedRows(node);
  let changed = false;
  for (const entry of linked.values()) {
    if (setWireHidden(entry, wireHidden(state, entry))) changed = true;
  }
  if (changed) node.setDirtyCanvas?.(true, true);
  return linked;
}

function paintTarget(element) {
  for (const state of states) {
    for (const row of state.panel.querySelectorAll(".ausboss-lora-row.link-target")) {
      if (row !== element) row.classList.remove("link-target");
    }
  }
  element?.classList.add("link-target");
}

function watchPointer(app) {
  if (watching) return;
  watching = true;
  window.addEventListener("pointermove", (event) => {
    let target = null;
    let over = null;
    for (const state of states) {
      if (state.disposed) continue;
      const node = state.node;
      const [x, y] = graphPoint(app, event.clientX, event.clientY);
      if (x >= node.pos[0] && x <= node.pos[0] + node.size[0] && y >= node.pos[1] - 30 && y <= node.pos[1] + node.size[1]) over = node;
      if (!target && !state.box && !state.readOnly && isNumberDrag(app)) target = rowAtClient(state, event.clientX, event.clientY);
    }
    paintTarget(target);
    if (!over) {
      const [x, y] = graphPoint(app, event.clientX, event.clientY);
      over = canvasOf(app)?.graph?.getNodeOnPos?.(x, y) ?? null;
    }
    if (over !== hoverTarget) {
      hoverTarget = over;
      for (const state of states) if (!state.disposed) syncStrengthLinks(state);
    }
  }, true);
  window.addEventListener("pointerup", () => requestAnimationFrame(() => {
    paintTarget(null);
    for (const state of states) if (!state.disposed) state.onStrengthLinks?.();
  }), true);
}

export function installStrengthLinks(state, app) {
  state.app = app;
  states.add(state);
  watchPointer(app);
  const node = state.node;
  // Saved as plain inputs (see the top of this file), hidden again on load.
  chainCallback(node, "onSerialize", (data) => {
    if (!Array.isArray(data?.inputs)) return;
    data.inputs = data.inputs.map((input) => {
      if (!isRowInput(input)) return input;
      const { widget, ...plain } = input;
      return plain;
    });
  });
  const rehide = () => {
    for (const input of rowInputs(node)) hideInput(input);
    requestAnimationFrame(() => { if (!state.disposed) state.onStrengthLinks?.(); });
  };
  chainCallback(node, "onGraphConfigured", rehide);
  chainCallback(node, "onConfigure", () => requestAnimationFrame(rehide));
  const original = node.getInputOnPos;
  node.getInputOnPos = function (pos) {
    const found = typeof original === "function" ? original.call(this, pos) : undefined;
    if (found && !isRowInput(found)) return found;
    if (state.disposed || state.box || state.readOnly || !isNumberDrag(app)) return found;
    const [clientX, clientY] = clientPoint(app, pos[0], pos[1]);
    const element = rowAtClient(state, clientX, clientY);
    if (!element?.dataset.rowId) return found;
    return ensureRowInput(state, element.dataset.rowId);
  };
  return () => {
    states.delete(state);
    if (node.getInputOnPos !== original) delete node.getInputOnPos;
  };
}

export const STRENGTH_LINK_STYLES = `
.ausboss-lora-row.link-target{outline:2px solid #00b4aa;outline-offset:-1px;background:rgba(0,180,170,.14);}
.ausboss-lora-strengthbox.linked .ausboss-lora-strength{color:#5fe3d9;border-color:rgba(0,180,170,.55);border-style:dashed;cursor:pointer;}
.ausboss-lora-strengthbox.linked .ausboss-lora-step{visibility:hidden;}
`;
