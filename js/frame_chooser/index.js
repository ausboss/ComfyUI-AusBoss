import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { BRAND, chainCallback, keepDomWidgetWidthAuto, notifyAusbossChange } from "../shared/index.mjs";
import { nodeByExecutionId } from "../shared/graph_ids.mjs";
import { ensureVideoCss, makeToolButton } from "../shared/video_ui.mjs";
import {
  allFrames,
  answerIsStale,
  beginSubmission,
  cancelPayload,
  chooserKeyAction,
  clearSubmission,
  clickLocked,
  continuePayload,
  countdownText,
  endSubmission,
  isStaleAnswerStatus,
  isTypingTarget,
  noFrames,
  pauseNoticeText,
  rectOnScreen,
  selectionSummary,
  shouldNotifyPause,
  toggleFrame,
  validFrames,
} from "../shared/frame_chooser.mjs";

const NODE_NAME = "AUSBOSS_NODES_FrameChooser";
// Must match BEHAVIOR_PAUSE in nodes/node_frame_chooser.py.
const ALWAYS_PAUSE = "always pause";
const EVENT_NAME = "ausboss-frame-choose";
const TICK_EVENT = "ausboss-frame-choose-tick";
const DONE_EVENT = "ausboss-frame-choose-done";
const PANEL_WIDGET = "ausboss_frame_chooser_panel";
const CSS_ID = "ausboss-chooser-ui-v1";
const TAB_ALERT_CLASS = "ausboss-chooser-tab-alert";
const MIN_WIDTH = 240;
// The chooser's fixed chrome (padding, head, gaps, action row) plus the
// grid's floor. The grid flexes from a zero basis, so the action buttons
// keep their full height at any panel height — the notice used to inflate
// the grid's auto basis and squeeze the buttons into the bottom clip.
const IDLE_HEIGHT = 152;
const ACTIVE_HEIGHT = 304;
// The canvas positions DOM widgets on its own frame, so the panel's rect only
// means something a beat after the pause lands.
const NOTICE_DELAY_MS = 250;
const TAB_ALERT_MS = 2400;

// Live panels by graph node id; the websocket event carries the execution id,
// which matches the node id for top-level nodes (subgraph ids keep a prefix).
const panels = new Map();

// True while a workflow load is replacing the graph. LiteGraph fires onRemoved
// for every node during that clear, and a paused run must survive it.
let graphTearingDown = false;
let teardownTimer = null;

function markGraphTeardown() {
  graphTearingDown = true;
  clearTimeout(teardownTimer);
  // afterConfigureGraph clears this; the timer is the backstop for a load that
  // throws, so a genuine deletion can never be permanently muted.
  teardownTimer = setTimeout(() => {
    graphTearingDown = false;
  }, 5000);
}

function endGraphTeardown() {
  clearTimeout(teardownTimer);
  teardownTimer = null;
  graphTearingDown = false;
}

function ensureChooserCss() {
  ensureVideoCss(); // tool-button styles shared with the video nodes
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-chooser-root{box-sizing:border-box;display:flex;flex-direction:column;gap:6px;width:100%;height:100%;padding:2px 6px 6px;color:#d8eeee;font:11px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;outline:none;overflow:hidden;}
.ausboss-chooser-head{display:flex;align-items:center;gap:5px;min-height:22px;flex:none;}
.ausboss-chooser-summary{flex:1 1 auto;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#b8d3d1;}
.ausboss-chooser-grid{flex:1 1 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px;align-content:start;overflow-y:auto;min-height:64px;padding:6px;border:1px solid rgba(0,180,170,.27);border-radius:6px;background:rgba(0,0,0,.28);}
.ausboss-chooser-empty{grid-column:1/-1;align-self:center;padding:14px 6px;color:#78908e;text-align:center;}
.ausboss-chooser-thumb{position:relative;display:block;width:100%;aspect-ratio:1/1;overflow:hidden;padding:0;border:2px solid transparent;border-radius:5px;background:#000;cursor:pointer;opacity:.45;transition:opacity .12s;}
.ausboss-chooser-thumb img{display:block;width:100%;height:100%;object-fit:cover;pointer-events:none;}
.ausboss-chooser-thumb .ausboss-chooser-index{position:absolute;left:3px;bottom:3px;padding:1px 4px;border-radius:3px;background:rgba(0,0,0,.72);font-size:9px;color:#c8dddd;pointer-events:none;}
.ausboss-chooser-thumb.selected{border-color:${BRAND};opacity:1;box-shadow:0 0 6px rgba(0,180,170,.35);}
.ausboss-chooser-root.is-idle .ausboss-chooser-thumb{cursor:default;}
.ausboss-chooser-actions{display:flex;gap:6px;flex:none;}
.ausboss-chooser-actions .ausboss-video-tool{flex:1 1 auto;}
.ausboss-chooser-root .ausboss-video-tool:disabled{opacity:.4;cursor:default;}
.${TAB_ALERT_CLASS}{border-radius:4px;box-shadow:inset 0 0 0 2px ${BRAND};animation:ausboss-chooser-tab-pulse 1.2s ease-in-out 2;}
@keyframes ausboss-chooser-tab-pulse{0%,100%{background:transparent;}50%{background:rgba(0,180,170,.3);}}
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
  // An answer already on the wire takes the controls with it: the pause is
  // spoken for until the reply lands.
  const busy = idle || state.submitting === true;
  state.keepButton.disabled = busy || state.selected.size === 0;
  state.keepAllButton.disabled = busy;
  state.cancelButton.disabled = busy;
  state.allButton.disabled = busy;
  state.noneButton.disabled = busy;
  state.root.classList.toggle("is-idle", idle);
}

function resolvePanel(state, message) {
  state.active = false;
  state.remaining = 0;
  clearTimeout(state.noticeTimer); // answered before the "are you there?" check
  state.summary.textContent = message;
  updateFace(state);
  state.node.setDirtyCanvas?.(true, true);
}

// The websocket events carry the execution id, which matches the graph node
// id for top-level nodes and keeps a colon-separated prefix inside subgraphs.
// A prefixed id is resolved by walking the subgraph chain, never by stripping
// the prefix: subgraph node ids repeat the same small numbers the root graph
// uses, so the bare tail would happily match an unrelated top-level chooser
// and render one node's filmstrip on another's face.
function findState(nodeId) {
  const id = String(nodeId);
  let state = panels.get(id) ?? null;
  if (!state && !id.includes(":")) state = panels.get(id.split(":").pop()) ?? null;
  if (!state) {
    // Ids in the map can lag a paste/duplicate; ask the graph directly.
    const node = nodeByExecutionId(app.rootGraph ?? app.graph, id);
    state = node?.__ausbossFrameChooser ?? null;
    if (state) panels.set(id, state);
  }
  return state;
}

// The one door every answer leaves by. The latch serialises the paths that can
// post - buttons, keys, the cancel a deleted node sends - so a rapid second
// answer never repeats a token the server has already spent. The reply is then
// matched against the pause it was posted for: one that lands after a timeout,
// after another tab answered, or after a new pause took this node over is
// dropped, so a late rejection cannot overwrite the result that did land.
async function postAnswer(state, payload) {
  const ticket = beginSubmission(state);
  if (!ticket) return null; // an answer for this pause is already on its way
  updateFace(state);
  let data = null;
  let failure = "";
  let spent = false;
  try {
    const response = await api.fetchApi("/ausboss/frame_chooser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    // A pause the server had already resolved is not a failure worth showing:
    // the outcome that won arrives over the done event, and it can land after
    // this rejection does.
    if (isStaleAnswerStatus(response.status)) spent = true;
    else if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
    else data = body;
  } catch (error) {
    failure = String(error?.message || error);
  }
  // Release first, and repaint either way: a panel that moved to a new pause
  // while this was in flight must get its controls back.
  if (endSubmission(state, ticket)) updateFace(state);
  if (spent || answerIsStale(ticket, state)) return null;
  if (failure) {
    state.summary.textContent = `Answer failed: ${failure}`;
    return null;
  }
  return data;
}

async function keepSelection(state, selected) {
  const data = await postAnswer(
    state,
    continuePayload(state.activeId, selected, state.activeToken),
  );
  if (data) {
    const kept = Number(data.kept ?? selected.size) || state.count;
    resolvePanel(state, `Continuing with ${kept} of ${state.count} frames.`);
  }
}

async function cancelRun(state) {
  const data = await postAnswer(state, cancelPayload(state.activeId, state.activeToken));
  if (data) resolvePanel(state, "Cancelled - run interrupted.");
}

function panelOnScreen(state) {
  return rectOnScreen(state.root?.getBoundingClientRect?.(), {
    width: window.innerWidth,
    height: window.innerHeight,
  });
}

// Switching workflow tabs - or drilling into a subgraph - changes the graph
// the canvas draws. A node whose graph is not that one cannot be seen here.
function graphFronted(state) {
  const shown = app.canvas?.graph ?? app.graph;
  const graph = state.node?.graph;
  return !graph || !shown || graph === shown;
}

// Best effort: the frontend renders one `.workflow-tab` per open workflow
// with the filename in a span, and exposes no handle on the element. Match on
// that label and skip the highlight when the markup is not there. Only the
// fronted workflow can be named, so a pause in a background workflow gets the
// toast alone rather than a guessed tab.
function highlightWorkflowTab(state) {
  if (!graphFronted(state)) return;
  const label = app.extensionManager?.workflow?.activeWorkflow?.filename;
  if (!label) return;
  let tab = null;
  for (const candidate of document.querySelectorAll(".workflow-tab")) {
    if (candidate.querySelector("span")?.textContent?.trim() === label) {
      tab = candidate;
      break;
    }
  }
  if (!tab) return;
  tab.classList.add(TAB_ALERT_CLASS);
  const timer = setTimeout(() => tab.classList.remove(TAB_ALERT_CLASS), TAB_ALERT_MS);
  state.abort.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      tab.classList.remove(TAB_ALERT_CLASS);
    },
    { once: true },
  );
}

// One nudge per pause, and only when the panel is out of sight: a filmstrip
// the user is looking at speaks for itself. Runs a beat after the pause lands
// so the panel's rect is real, and re-checks the token in case the pause was
// answered in the meantime.
function announcePause(state, token) {
  if (!state.active || state.activeToken !== token) return;
  const unseen = shouldNotifyPause({
    documentHidden: document.hidden === true,
    onScreen: panelOnScreen(state),
    workflowFronted: graphFronted(state),
    alreadyNotified: Boolean(token) && state.notifiedToken === token,
  });
  if (!unseen) return;
  state.notifiedToken = token;
  const detail = pauseNoticeText(state.node?.title, state.count);
  const toast = app.extensionManager?.toast;
  if (toast?.add) toast.add({ severity: "info", summary: "Frame Chooser", detail, life: 6000 });
  else console.log(`[AusBoss] ${detail}`);
  highlightWorkflowTab(state);
}

function populatePanel(state, detail) {
  state.active = true;
  state.populated = true;
  // A new pause answers for itself; anything still in flight belongs to the
  // one it replaced and is stale the moment it comes back.
  clearSubmission(state);
  state.activeId = String(detail.node_id);
  state.activeToken = String(detail.token || "");
  state.count = Number(detail.count) || (detail.urls?.length ?? 0);
  state.selected = validFrames(detail.previous, state.count);
  state.remaining = Number(detail.remaining ?? detail.timeout_seconds) || 0;
  state.timeoutPolicy = typeof detail.on_timeout === "string" ? detail.on_timeout : "";
  state.shownAt = Date.now(); // starts the click cooldown
  state.grid.replaceChildren();
  (detail.urls || []).forEach((file, position) => {
    const frame = position + 1;
    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "ausboss-chooser-thumb";
    thumb.dataset.frame = String(frame);
    thumb.title =
      frame <= 9
        ? `Frame ${frame} - click or press ${frame} to toggle`
        : `Frame ${frame} - click to toggle`;
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
  const token = state.activeToken;
  clearTimeout(state.noticeTimer);
  state.noticeTimer = setTimeout(() => announcePause(state, token), NOTICE_DELAY_MS);
}

// Server -> widget writeback: an interactive answer lands in the visible
// pick_list widget so the next queue reproduces the choice headlessly.
//
// Only under "keep last selection". A filled pick_list pre-answers the node,
// so writing one back under "always pause" would answer every later queue on
// its own and silently retire the setting the user explicitly chose - the
// node would pause exactly once and never again.
function applyPickWriteback(state, indices) {
  if (typeof indices !== "string") return;
  const widgets = state.node.widgets || [];
  const behavior = widgets.find((entry) => entry.name === "behavior");
  if (String(behavior?.value ?? ALWAYS_PAUSE) === ALWAYS_PAUSE) return;
  const widget = widgets.find((entry) => entry.name === "pick_list");
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
    if (
      !state ||
      (state.active &&
        state.activeId === String(detail.node_id) &&
        state.activeToken === String(detail.token || ""))
    ) {
      continue;
    }
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
  const allButton = makeToolButton("ALL", "Select every frame (A)");
  const noneButton = makeToolButton("NONE", "Clear the selection (N)");
  head.append(summary, allButton, noneButton);

  const grid = document.createElement("div");
  grid.className = "ausboss-chooser-grid";
  const empty = document.createElement("div");
  empty.className = "ausboss-chooser-empty";
  empty.textContent = "The filmstrip appears when the graph pauses on this node.";
  grid.appendChild(empty);

  const actions = document.createElement("div");
  actions.className = "ausboss-chooser-actions";
  const keepButton = makeToolButton("KEEP SELECTED", "Resume with the selected frames (Enter)");
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
    activeToken: "",
    count: 0,
    selected: noFrames(),
    remaining: 0,
    timeoutPolicy: "",
    shownAt: 0,
    notifiedToken: null,
    noticeTimer: null,
    submitting: false, // an answer is on the wire; nothing else may post
    submitSeq: 0,
  });
  abort.signal.addEventListener("abort", () => clearTimeout(state.noticeTimer), { once: true });

  const widget = node.addDOMWidget(PANEL_WIDGET, "ausboss_chooser", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => (state.populated ? ACTIVE_HEIGHT : IDLE_HEIGHT),
  });
  keepDomWidgetWidthAuto(widget);
  widget.computeSize = (width) => [
    Math.max(MIN_WIDTH, Number(width || node.size?.[0] || MIN_WIDTH)),
    state.populated ? ACTIVE_HEIGHT : IDLE_HEIGHT,
  ];
  widget.computeLayoutSize = () => ({
    minWidth: MIN_WIDTH,
    minHeight: state.populated ? ACTIVE_HEIGHT : IDLE_HEIGHT,
  });
  // Older frontends enforce the node's floor through this option instead of
  // computeLayoutSize. Without it the node could be resized under the panel,
  // which holds MIN_WIDTH and pokes past the border - the overflow clip cuts
  // at the panel's edge, not the node's.
  widget.options.minNodeSize = [MIN_WIDTH, IDLE_HEIGHT];
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

  // A pause can pop up under a pointer already travelling toward the canvas,
  // so swallow clicks inside the panel for a moment after it appears, and
  // again while an answer is on the wire. Capture phase keeps the thumbs and
  // buttons from seeing them; no preventDefault, so a click on empty panel
  // space still falls through to the node.
  root.addEventListener(
    "click",
    (event) => {
      if (!state.active) return;
      if (state.submitting || clickLocked(Date.now() - state.shownAt)) event.stopPropagation();
    },
    { capture: true, signal: abort.signal },
  );

  // Keyboard map, live only while this panel holds focus and its pause is the
  // active one. Mapped keys are consumed so canvas shortcuts do not also fire;
  // anything else - and anything typed into a field - stays with the app.
  root.addEventListener(
    "keydown",
    (event) => {
      if (!state.active) return;
      const hit = chooserKeyAction({
        key: event.key,
        typing: isTypingTarget(event.target?.tagName, event.target?.isContentEditable),
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
      });
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      // Mapped keys are still consumed while an answer is in flight - they
      // belong to this panel - but the pause is already spoken for.
      if (state.submitting) return;
      switch (hit.action) {
        case "toggle":
          if (hit.frame > state.count) break;
          state.selected = toggleFrame(state.selected, hit.frame);
          updateFace(state);
          break;
        case "all":
          state.selected = allFrames(state.count);
          updateFace(state);
          break;
        case "none":
          state.selected = noFrames();
          updateFace(state);
          break;
        case "keep":
          // Mirrors the disabled Keep selected button: nothing to keep, nothing
          // to do. "Keep all" stays an explicit choice.
          if (state.selected.size > 0) keepSelection(state, state.selected);
          break;
        case "cancel":
          cancelRun(state);
          break;
      }
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
      if (String(detail.token || "") !== state.activeToken) return;
      state.remaining = Number(detail.remaining) || 0;
      updateFace(state);
    });
    api.addEventListener(DONE_EVENT, (event) => {
      const detail = event?.detail;
      if (!detail?.node_id) return;
      const state = findState(detail.node_id);
      if (!state) return;
      if (String(detail.token || "") !== state.activeToken) return;
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
  beforeConfigureGraph() {
    // Loading a workflow clears the graph, and LiteGraph fires onRemoved for
    // every node when it does - undo, a workflow tab switch, Clear Workflow,
    // opening another file. None of those is a deletion, so the pause must
    // survive them; only a node the user actually removed cancels its run.
    markGraphTeardown();
  },
  afterConfigureGraph() {
    endGraphTeardown();
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
      if (state?.active && !graphTearingDown) {
        // Deleting a paused node must not leave the queue hanging. This is an
        // answer like any other, so it goes through the latch too: an answer
        // already in flight is releasing the same pause.
        postAnswer(state, cancelPayload(state.activeId, state.activeToken));
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
