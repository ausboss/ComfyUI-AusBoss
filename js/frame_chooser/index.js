import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { BRAND, chainCallback, notifyAusbossChange } from "../shared/index.mjs";
import { ensureVideoCss, makeToolButton } from "../shared/video_ui.mjs";
import {
  allFrames,
  cancelPayload,
  continuePayload,
  countdownText,
  noFrames,
  selectionSummary,
  toggleFrame,
  validFrames,
} from "../shared/frame_chooser.mjs";

const NODE_NAME = "AUSBOSS_NODES_FrameChooser";
const EVENT_NAME = "ausboss-frame-choose";
const TICK_EVENT = "ausboss-frame-choose-tick";
const DONE_EVENT = "ausboss-frame-choose-done";
const PANEL_WIDGET = "ausboss_frame_chooser_panel";
const CSS_ID = "ausboss-chooser-ui-v1";
const MIN_WIDTH = 240;
const IDLE_HEIGHT = 132;
const ACTIVE_HEIGHT = 304;

// Live panels by graph node id; the websocket event carries the execution id,
// which matches the node id for top-level nodes (subgraph ids keep a prefix).
const panels = new Map();

function ensureChooserCss() {
  ensureVideoCss(); // tool-button styles shared with the video nodes
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-chooser-root{box-sizing:border-box;display:flex;flex-direction:column;gap:6px;width:100%;height:100%;padding:2px 6px 6px;color:#d8eeee;font:11px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;outline:none;overflow:hidden;}
.ausboss-chooser-head{display:flex;align-items:center;gap:5px;min-height:22px;}
.ausboss-chooser-summary{flex:1 1 auto;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#b8d3d1;}
.ausboss-chooser-grid{flex:1 1 auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px;align-content:start;overflow-y:auto;min-height:64px;padding:6px;border:1px solid rgba(0,180,170,.27);border-radius:6px;background:rgba(0,0,0,.28);}
.ausboss-chooser-empty{grid-column:1/-1;align-self:center;padding:14px 6px;color:#78908e;text-align:center;}
.ausboss-chooser-thumb{position:relative;display:block;width:100%;aspect-ratio:1/1;overflow:hidden;padding:0;border:2px solid transparent;border-radius:5px;background:#000;cursor:pointer;opacity:.45;transition:opacity .12s;}
.ausboss-chooser-thumb img{display:block;width:100%;height:100%;object-fit:cover;pointer-events:none;}
.ausboss-chooser-thumb .ausboss-chooser-index{position:absolute;left:3px;bottom:3px;padding:1px 4px;border-radius:3px;background:rgba(0,0,0,.72);font-size:9px;color:#c8dddd;pointer-events:none;}
.ausboss-chooser-thumb.selected{border-color:${BRAND};opacity:1;box-shadow:0 0 6px rgba(0,180,170,.35);}
.ausboss-chooser-root.is-idle .ausboss-chooser-thumb{cursor:default;}
.ausboss-chooser-actions{display:flex;gap:6px;}
.ausboss-chooser-actions .ausboss-video-tool{flex:1 1 auto;}
.ausboss-chooser-root .ausboss-video-tool:disabled{opacity:.4;cursor:default;}
`;
  document.head.appendChild(style);
}

function thumbnailUrl(file) {
  const query = new URLSearchParams({
    filename: file?.filename ?? "",
    subfolder: file?.subfolder ?? "",
    type: file?.type ?? "temp",
  });
  return api.apiURL(`/view?${query}`);
}

function updateFace(state) {
  for (const thumb of state.grid.querySelectorAll(".ausboss-chooser-thumb")) {
    thumb.classList.toggle("selected", state.selected.has(Number(thumb.dataset.frame)));
  }
  if (state.active && state.count > 0) {
    const countdown = countdownText(state.remaining, state.timeoutPolicy);
    state.summary.textContent =
      `Paused - ${selectionSummary(state.selected, state.count)}` +
      (countdown ? ` - ${countdown}` : "");
  }
  const idle = !state.active;
  state.keepButton.disabled = idle || state.selected.size === 0;
  state.keepAllButton.disabled = idle;
  state.cancelButton.disabled = idle;
  state.allButton.disabled = idle;
  state.noneButton.disabled = idle;
  state.root.classList.toggle("is-idle", idle);
}

function resolvePanel(state, message) {
  state.active = false;
  state.remaining = 0;
  state.summary.textContent = message;
  updateFace(state);
  state.node.setDirtyCanvas?.(true, true);
}

// The websocket events carry the execution id, which matches the graph node
// id for top-level nodes; subgraph ids keep a colon-separated prefix.
function findState(nodeId) {
  const id = String(nodeId);
  const tail = id.split(":").pop();
  let state = panels.get(id) ?? panels.get(tail);
  if (!state) {
    // Ids in the map can lag a paste/duplicate; ask the graph directly.
    const node = app.graph?.getNodeById?.(Number(tail));
    state = node?.__ausbossFrameChooser ?? null;
    if (state) panels.set(String(node.id), state);
  }
  return state;
}

async function postAnswer(state, payload) {
  try {
    const response = await api.fetchApi("/ausboss/frame_chooser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    return data;
  } catch (error) {
    state.summary.textContent = `Answer failed: ${error?.message || error}`;
    return null;
  }
}

async function keepSelection(state, selected) {
  const data = await postAnswer(state, continuePayload(state.activeId, selected));
  if (data) {
    const kept = Number(data.kept ?? selected.size) || state.count;
    resolvePanel(state, `Continuing with ${kept} of ${state.count} frames.`);
  }
}

async function cancelRun(state) {
  const data = await postAnswer(state, cancelPayload(state.activeId));
  if (data) resolvePanel(state, "Cancelled - run interrupted.");
}

function announcePause(count) {
  const message = `Frame Chooser paused the graph - pick from ${count} frames on the node.`;
  try {
    app.extensionManager?.toast?.add?.({
      severity: "info",
      summary: "Frame Chooser",
      detail: message,
      life: 5000,
    });
  } catch (_error) {
    /* older frontends have no toast API */
  }
  console.log(`[AusBoss] ${message}`);
}

function populatePanel(state, detail) {
  state.active = true;
  state.populated = true;
  state.activeId = String(detail.node_id);
  state.count = Number(detail.count) || (detail.urls?.length ?? 0);
  state.selected = validFrames(detail.previous, state.count);
  state.remaining = Number(detail.remaining ?? detail.timeout_seconds) || 0;
  state.timeoutPolicy = typeof detail.on_timeout === "string" ? detail.on_timeout : "";
  state.grid.replaceChildren();
  (detail.urls || []).forEach((file, position) => {
    const frame = position + 1;
    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "ausboss-chooser-thumb";
    thumb.dataset.frame = String(frame);
    thumb.title = `Frame ${frame} - click to toggle`;
    const image = document.createElement("img");
    image.loading = "lazy";
    image.alt = `Frame ${frame}`;
    image.src = thumbnailUrl(file);
    const index = document.createElement("span");
    index.className = "ausboss-chooser-index";
    index.textContent = String(frame);
    thumb.append(image, index);
    thumb.addEventListener(
      "click",
      (event) => {
        event.stopPropagation();
        if (!state.active) return;
        state.selected = toggleFrame(state.selected, frame);
        updateFace(state);
      },
      { signal: state.abort.signal },
    );
    state.grid.appendChild(thumb);
  });
  updateFace(state);
  const node = state.node;
  node.setSize?.([
    Math.max(node.size?.[0] ?? MIN_WIDTH, 320),
    Math.max(node.size?.[1] ?? 0, ACTIVE_HEIGHT + 90),
  ]);
  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
  state.root.focus({ preventScroll: true });
  announcePause(state.count);
}

// Server -> widget writeback: an interactive answer lands in the visible
// pick_list widget so the next queue reproduces the choice headlessly.
function applyPickWriteback(state, indices) {
  if (typeof indices !== "string") return;
  const widget = (state.node.widgets || []).find((entry) => entry.name === "pick_list");
  if (!widget || widget.value === indices) return;
  widget.value = indices;
  state.node.setDirtyCanvas?.(true, true);
  notifyAusbossChange();
}

// A page reload drops every panel while the server keeps waiting. Ask the
// backend which pauses are still open and re-render their filmstrips; runs
// after the graph configures so the nodes exist to attach to.
async function refreshPending() {
  let data = null;
  try {
    const response = await api.fetchApi("/ausboss/frame_chooser/pending");
    if (!response.ok) return;
    data = await response.json();
  } catch (_error) {
    return; // transient fetch trouble: the next graph load asks again
  }
  for (const detail of data?.pending || []) {
    if (!detail?.node_id) continue;
    const state = findState(detail.node_id);
    // No state: the paused chooser belongs to a workflow that is not open
    // here. Already active: the panel survived (workflow switch), so leave
    // the in-progress selection alone.
    if (!state || (state.active && state.activeId === String(detail.node_id))) continue;
    populatePanel(state, detail);
  }
}

function buildPanel(node) {
  if (node.__ausbossFrameChooser) return node.__ausbossFrameChooser;
  ensureChooserCss();

  const root = document.createElement("div");
  root.className = "ausboss-chooser-root is-idle";
  root.tabIndex = -1;

  const head = document.createElement("div");
  head.className = "ausboss-chooser-head";
  const summary = document.createElement("div");
  summary.className = "ausboss-chooser-summary";
  summary.textContent = "Queue a run to pick frames here.";
  const allButton = makeToolButton("ALL", "Select every frame");
  const noneButton = makeToolButton("NONE", "Clear the selection");
  head.append(summary, allButton, noneButton);

  const grid = document.createElement("div");
  grid.className = "ausboss-chooser-grid";
  const empty = document.createElement("div");
  empty.className = "ausboss-chooser-empty";
  empty.textContent = "The filmstrip appears when the graph pauses on this node.";
  grid.appendChild(empty);

  const actions = document.createElement("div");
  actions.className = "ausboss-chooser-actions";
  const keepButton = makeToolButton("KEEP SELECTED", "Resume with the selected frames");
  const keepAllButton = makeToolButton("KEEP ALL", "Resume with every frame");
  const cancelButton = makeToolButton("CANCEL", "Interrupt the run (Escape)");
  actions.append(keepButton, keepAllButton, cancelButton);

  root.append(head, grid, actions);

  const abort = new AbortController();
  const state = (node.__ausbossFrameChooser = {
    node,
    root,
    grid,
    summary,
    keepButton,
    keepAllButton,
    cancelButton,
    allButton,
    noneButton,
    abort,
    active: false,
    populated: false,
    activeId: String(node.id),
    count: 0,
    selected: noFrames(),
    remaining: 0,
    timeoutPolicy: "",
  });

  const widget = node.addDOMWidget(PANEL_WIDGET, "ausboss_chooser", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => (state.populated ? ACTIVE_HEIGHT : IDLE_HEIGHT),
  });
  widget.computeSize = (width) => [
    Math.max(MIN_WIDTH, Number(width || node.size?.[0] || MIN_WIDTH)),
    state.populated ? ACTIVE_HEIGHT : IDLE_HEIGHT,
  ];
  widget.computeLayoutSize = () => ({
    minWidth: MIN_WIDTH,
    minHeight: state.populated ? ACTIVE_HEIGHT : IDLE_HEIGHT,
  });
  state.widget = widget;

  keepButton.addEventListener(
    "click",
    (event) => {
      event.stopPropagation();
      if (state.active && state.selected.size > 0) keepSelection(state, state.selected);
    },
    { signal: abort.signal },
  );
  keepAllButton.addEventListener(
    "click",
    (event) => {
      event.stopPropagation();
      // An empty list is the backend's compact spelling of "keep all".
      if (state.active) keepSelection(state, noFrames());
    },
    { signal: abort.signal },
  );
  cancelButton.addEventListener(
    "click",
    (event) => {
      event.stopPropagation();
      if (state.active) cancelRun(state);
    },
    { signal: abort.signal },
  );
  allButton.addEventListener(
    "click",
    (event) => {
      event.stopPropagation();
      if (!state.active) return;
      state.selected = allFrames(state.count);
      updateFace(state);
    },
    { signal: abort.signal },
  );
  noneButton.addEventListener(
    "click",
    (event) => {
      event.stopPropagation();
      if (!state.active) return;
      state.selected = noFrames();
      updateFace(state);
    },
    { signal: abort.signal },
  );

  // Escape cancels while the panel holds focus; other keys stay with the app.
  root.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !state.active) return;
      event.preventDefault();
      event.stopPropagation();
      cancelRun(state);
    },
    { signal: abort.signal },
  );

  // The wheel belongs to the graph unless the filmstrip is active and
  // actually has overflow to scroll.
  grid.addEventListener(
    "wheel",
    (event) => {
      if (state.active && grid.scrollHeight > grid.clientHeight) event.stopPropagation();
    },
    { signal: abort.signal },
  );

  updateFace(state);
  return state;
}

app.registerExtension({
  name: "ausboss.frame_chooser",
  setup() {
    api.addEventListener(EVENT_NAME, (event) => {
      const detail = event?.detail;
      if (!detail?.node_id) return;
      const state = findState(detail.node_id);
      if (!state) {
        console.warn(`[AusBoss] Frame Chooser paused for unknown node ${detail.node_id}; use the queue's stop button to release it.`);
        return;
      }
      populatePanel(state, detail);
    });
    api.addEventListener(TICK_EVENT, (event) => {
      const detail = event?.detail;
      if (!detail?.node_id) return;
      const state = findState(detail.node_id);
      if (!state?.active) return;
      state.remaining = Number(detail.remaining) || 0;
      updateFace(state);
    });
    api.addEventListener(DONE_EVENT, (event) => {
      const detail = event?.detail;
      if (!detail?.node_id) return;
      const state = findState(detail.node_id);
      if (!state) return;
      if (detail.reason === "answered") {
        applyPickWriteback(state, detail.indices);
        if (state.active) {
          // A second tab (or a restored panel) answered this pause.
          resolvePanel(state, `Continuing with ${detail.kept} of ${detail.count} frames.`);
        }
      } else if (detail.reason === "timeout" && state.active) {
        resolvePanel(state, `Timed out - continuing with ${detail.kept} of ${detail.count} frames.`);
      }
    });
    const releaseAll = (message) => {
      for (const state of panels.values()) {
        if (state.active) resolvePanel(state, message);
      }
    };
    api.addEventListener("execution_interrupted", () => releaseAll("Run interrupted."));
    api.addEventListener("execution_error", () => releaseAll("Run stopped by an error."));
    // Fallback for frontends that load without configuring a graph; the
    // already-active guard in refreshPending makes the double call harmless.
    setTimeout(refreshPending, 1500);
  },
  afterConfigureGraph() {
    refreshPending();
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_NAME) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      const state = buildPanel(this);
      if (state) panels.set(String(this.id), state);
    });
    chainCallback(nodeType.prototype, "onAdded", function () {
      // The final node id is assigned on add; re-key the panel under it.
      const state = this.__ausbossFrameChooser;
      if (state) panels.set(String(this.id), state);
    });
    chainCallback(nodeType.prototype, "onConfigure", function () {
      queueMicrotask(() => {
        const state = buildPanel(this);
        if (state) panels.set(String(this.id), state);
      });
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      const state = this.__ausbossFrameChooser;
      if (state?.active) {
        // Deleting a paused node must not leave the queue hanging.
        postAnswer(state, cancelPayload(state.activeId));
      }
      state?.abort?.abort();
      for (const [key, value] of panels) {
        if (value === state) panels.delete(key);
      }
      panels.delete(String(this.id));
      this.__ausbossFrameChooser = null;
    });
  },
});
