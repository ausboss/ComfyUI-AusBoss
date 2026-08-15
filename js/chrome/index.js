import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { AUSBOSS_JS_VERSION, BRAND, BRAND_BODY, chainCallback } from "../shared/index.mjs";
import { nodeByExecutionId } from "../shared/graph_ids.mjs";
import {
  advanceExecution,
  applyStatus,
  badgeFor,
  clearStatuses,
  composeTitle,
  createRunState,
  createStatusState,
  stripQueuePrefix,
} from "../shared/chrome.mjs";

// Pack-wide browser-chrome status: favicon + tab-title queue status, live
// per-node status badges, and optional per-node runtime badges. Pure
// decision logic lives in js/shared/chrome.mjs; this file only wires DOM,
// api events, and drawing.

const FAVICON_SETTING = "AusBoss.Chrome.FaviconStatus";
const RUNTIME_SETTING = "AusBoss.Chrome.NodeRuntime";
const RUNTIME_KEY = "ausbossRuntimeSeconds";
const STATUS_SETTING = "AusBoss.Chrome.NodeStatus";
const STATUS_KEY = "ausbossNodeStatus";
const STATUS_EVENT = "ausboss-node-status";

// ---------------------------------------------------------------------------
// Favicon + tab title
// ---------------------------------------------------------------------------

const favicon = {
  enabled: false,
  abort: null,
  icons: null, // { idle, active } data URIs, drawn once per enable
  link: null, // the <link rel="icon"> we manage
  createdLink: false, // we added it, so disable removes it
  originalHref: null,
  executing: false,
  queueRemaining: 0,
};

function roundedRectPath(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  const right = x + width;
  const bottom = y + height;
  ctx.moveTo(x + radius, y);
  ctx.arcTo(right, y, right, bottom, radius);
  ctx.arcTo(right, bottom, x, bottom, radius);
  ctx.arcTo(x, bottom, x, y, radius);
  ctx.arcTo(x, y, right, y, radius);
  ctx.closePath();
}

// The api's "executing" detail is the running node id (or null when the
// prompt finishes); some frontend builds wrap it in an object instead.
function executingNodeId(detail) {
  if (detail && typeof detail === "object") return detail.display_node ?? detail.node ?? null;
  return detail ?? null;
}

// Both icons are drawn at runtime on a scratch canvas — no image assets.
// Idle: a filled rounded square in the brand teal. Active: the same square
// with a bright dot punched into the top-right corner.
function drawIcon(active) {
  try {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    roundedRectPath(ctx, 4, 4, size - 8, size - 8, 14);
    ctx.fillStyle = BRAND;
    ctx.fill();
    if (active) {
      // Dark halo first so the dot reads at 16px against the teal.
      ctx.beginPath();
      ctx.arc(46, 18, 15, 0, Math.PI * 2);
      ctx.fillStyle = BRAND_BODY;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(46, 18, 10, 0, Math.PI * 2);
      ctx.fillStyle = "#ffd166";
      ctx.fill();
    }
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function applyFavicon(href) {
  if (!href) return;
  if (!favicon.link || !favicon.link.isConnected) {
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head?.appendChild(link);
      favicon.createdLink = true;
      favicon.originalHref = null;
    } else if (favicon.link !== link) {
      favicon.createdLink = false;
      favicon.originalHref = link.getAttribute("href");
    }
    favicon.link = link;
  }
  if (favicon.link.getAttribute("href") !== href) favicon.link.setAttribute("href", href);
}

function restoreFavicon() {
  const link = favicon.link;
  favicon.link = null;
  if (!link || !link.isConnected) return;
  if (favicon.createdLink) link.remove();
  else if (favicon.originalHref != null) link.setAttribute("href", favicon.originalHref);
  else link.removeAttribute("href");
  favicon.createdLink = false;
  favicon.originalHref = null;
}

function renderChrome() {
  try {
    applyFavicon(favicon.executing ? favicon.icons?.active : favicon.icons?.idle);
    // Recompose from the live title (never a stale snapshot) so a rename by
    // the frontend survives; composeTitle strips our own prefix first.
    const next = composeTitle(document.title, favicon.queueRemaining);
    if (document.title !== next) document.title = next;
  } catch {
    /* Favicon status must never break the app. */
  }
}

function enableFavicon() {
  if (favicon.abort) return;
  favicon.abort = new AbortController();
  const signal = favicon.abort.signal;
  favicon.icons = { idle: drawIcon(false), active: drawIcon(true) };
  const busy = (executing) => () => {
    favicon.executing = executing;
    renderChrome();
  };
  api.addEventListener(
    "status",
    (event) => {
      const n = Number(event?.detail?.exec_info?.queue_remaining);
      favicon.queueRemaining = Number.isFinite(n) ? n : 0;
      renderChrome();
    },
    { signal },
  );
  api.addEventListener("execution_start", busy(true), { signal });
  api.addEventListener(
    "executing",
    (event) => busy(executingNodeId(event?.detail) != null)(),
    { signal },
  );
  api.addEventListener("execution_success", busy(false), { signal });
  api.addEventListener("execution_error", busy(false), { signal });
  api.addEventListener("execution_interrupted", busy(false), { signal });
  renderChrome();
}

function disableFavicon() {
  favicon.abort?.abort();
  favicon.abort = null;
  favicon.executing = false;
  favicon.queueRemaining = 0;
  try {
    document.title = stripQueuePrefix(document.title);
    restoreFavicon();
  } catch {
    /* Restoring best-effort; never throw. */
  }
}

// ---------------------------------------------------------------------------
// Per-node runtime badges
// ---------------------------------------------------------------------------

const runtime = {
  enabled: false,
  abort: null,
  state: createRunState(),
};

function graphNodes() {
  return app.graph?._nodes || app.graph?.nodes || [];
}

// Ids arrive over the wire as ComfyUI execution ids: a plain number at the
// top level, colon-joined inside a subgraph ("12:3"). Number("12:3") is NaN
// and the root graph has no node under that string, so both badges used to
// go missing entirely for any node inside a subgraph.
function nodeById(id) {
  return nodeByExecutionId(app.rootGraph ?? app.graph, id);
}

function clearBadges() {
  // Assign undefined, never delete — deleting node properties breaks
  // reactivity under the Nodes 2.0 renderer.
  for (const node of graphNodes()) {
    if (node[RUNTIME_KEY] !== undefined) node[RUNTIME_KEY] = undefined;
  }
}

function stampUpdates(updates) {
  for (const { id, seconds } of updates) {
    const node = nodeById(id);
    if (node) node[RUNTIME_KEY] = seconds;
  }
  if (updates.length) app.graph?.setDirtyCanvas?.(true, false);
}

function enableRuntime() {
  if (runtime.abort) return;
  runtime.abort = new AbortController();
  const signal = runtime.abort.signal;
  const closeRun = () => stampUpdates(advanceExecution(runtime.state, null, performance.now()));
  api.addEventListener(
    "execution_start",
    () => {
      runtime.state = createRunState();
      clearBadges();
    },
    { signal },
  );
  api.addEventListener(
    "executing",
    (event) =>
      stampUpdates(advanceExecution(runtime.state, executingNodeId(event?.detail), performance.now())),
    { signal },
  );
  api.addEventListener("execution_success", closeRun, { signal });
  api.addEventListener("execution_error", closeRun, { signal });
  api.addEventListener("execution_interrupted", closeRun, { signal });
}

function disableRuntime() {
  runtime.abort?.abort();
  runtime.abort = null;
  runtime.state = createRunState();
  try {
    clearBadges();
    app.graph?.setDirtyCanvas?.(true, false);
  } catch {
    /* Never throw from a toggle. */
  }
}

// ---------------------------------------------------------------------------
// Live per-node status badges
// ---------------------------------------------------------------------------

const status = {
  enabled: false,
  abort: null,
  state: createStatusState(),
};

// Retire the statuses this run is done with, keeping the node still
// executing (when one is passed) so its badge survives until it moves on.
function retireStatuses(keepId) {
  const cleared = clearStatuses(status.state, keepId);
  for (const id of cleared) {
    const node = nodeById(id);
    if (node && node[STATUS_KEY] !== undefined) node[STATUS_KEY] = undefined;
  }
  if (cleared.length) app.graph?.setDirtyCanvas?.(true, false);
}

function enableStatus() {
  if (status.abort) return;
  status.abort = new AbortController();
  const signal = status.abort.signal;
  api.addEventListener(
    STATUS_EVENT,
    (event) => {
      const id = applyStatus(status.state, event?.detail);
      if (id === null) return;
      const node = nodeById(id);
      // undefined when the node retracted its status — assign, never delete.
      if (node) node[STATUS_KEY] = status.state.entries.get(id);
      app.graph?.setDirtyCanvas?.(true, false);
    },
    { signal },
  );
  // A status describes what a node is doing right now, so the run moving on,
  // ending, failing, or being stopped all retire it.
  api.addEventListener(
    "executing",
    (event) => retireStatuses(executingNodeId(event?.detail)),
    { signal },
  );
  const retireAll = () => retireStatuses();
  api.addEventListener("execution_start", retireAll, { signal });
  api.addEventListener("execution_success", retireAll, { signal });
  api.addEventListener("execution_error", retireAll, { signal });
  api.addEventListener("execution_interrupted", retireAll, { signal });
}

function disableStatus() {
  status.abort?.abort();
  status.abort = null;
  try {
    retireStatuses();
  } catch {
    /* Never throw from a toggle. */
  }
}

// ---------------------------------------------------------------------------
// Badge drawing
// ---------------------------------------------------------------------------

function drawNodeBadge(node, ctx) {
  try {
    if (node?.flags?.collapsed) return;
    // Zoomed way out the text is unreadable anyway — skip the work.
    if ((app.canvas?.ds?.scale ?? 1) < 0.5) return;
    const badge = badgeFor(
      status.enabled ? node?.[STATUS_KEY] : null,
      runtime.enabled ? node?.[RUNTIME_KEY] : undefined,
    );
    if (!badge) return;
    const titleHeight = globalThis.LiteGraph?.NODE_TITLE_HEIGHT ?? 30;
    ctx.save();
    ctx.font = "10px monospace";
    const padX = 5;
    const height = 15;
    const width = Math.ceil(ctx.measureText(badge.text).width) + padX * 2;
    // Top-right, floating just above the title bar so it never covers
    // the node title or its widgets.
    const x = node.size[0] - width;
    const y = -titleHeight - height - 4;
    roundedRectPath(ctx, x, y, width, height, 4);
    ctx.fillStyle = "rgba(8, 20, 19, 0.85)";
    ctx.fill();
    if (badge.progress !== null) {
      // Proportional fill inside the badge's own outline — clipped to the
      // rounded path that is still current after the fill above.
      ctx.save();
      ctx.clip();
      ctx.fillStyle = "rgba(0, 180, 170, 0.45)";
      ctx.fillRect(x, y, width * badge.progress, height);
      ctx.restore();
    }
    ctx.strokeStyle = BRAND;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#d8f5f3";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(badge.text, x + padX, y + height / 2 + 0.5);
    ctx.restore();
  } catch {
    /* Drawing must never break the canvas loop. */
  }
}

let drawHookInstalled = false;

function installDrawHook() {
  if (drawHookInstalled) return;
  const proto = globalThis.LiteGraph?.LGraphNode?.prototype;
  if (!proto) return;
  drawHookInstalled = true;
  chainCallback(proto, "onDrawForeground", function (ctx) {
    drawNodeBadge(this, ctx);
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

app.registerExtension({
  name: "AusBoss.Chrome",
  // Shown on Settings > About; the frontend's aboutPanelStore flat-maps each
  // extension's aboutPageBadges ({ label, url, icon }) after the core rows.
  aboutPageBadges: [
    {
      label: `ComfyUI-AusBoss v${AUSBOSS_JS_VERSION}`,
      url: "https://github.com/ausboss/ComfyUI-AusBoss",
      icon: "pi pi-github",
    },
    {
      label: "Report an issue",
      url: "https://github.com/ausboss/ComfyUI-AusBoss/issues",
      icon: "pi pi-flag",
    },
  ],
  settings: [
    {
      id: FAVICON_SETTING,
      name: "Favicon status",
      type: "boolean",
      defaultValue: true,
      category: ["🆎 AusBoss", "Chrome", "Favicon status"],
      tooltip:
        "Shows rendering state in the browser tab: the tab icon switches " +
        "between an idle teal square and an active variant with a bright " +
        "dot while a prompt is executing, and the tab title gains a " +
        "\"(N)\" queue-depth prefix that disappears when the queue is " +
        "empty. Turning this off restores the browser-default icon and " +
        "title immediately.",
      onChange(value) {
        const on = value !== false;
        if (on === favicon.enabled) return;
        favicon.enabled = on;
        if (on) enableFavicon();
        else disableFavicon();
      },
    },
    {
      id: RUNTIME_SETTING,
      name: "Node runtime badges",
      type: "boolean",
      defaultValue: false,
      category: ["🆎 AusBoss", "Chrome", "Node runtime"],
      tooltip:
        "After a run, shows a small badge above each executed node's " +
        "top-right corner with the seconds it took; a node revisited by a " +
        "batched loop shows its summed time. Off by default because it " +
        "adds visual noise to the graph.",
      onChange(value) {
        const on = value === true;
        if (on === runtime.enabled) return;
        runtime.enabled = on;
        if (on) enableRuntime();
        else disableRuntime();
      },
    },
    {
      id: STATUS_SETTING,
      name: "Live node status badges",
      type: "boolean",
      defaultValue: true,
      category: ["🆎 AusBoss", "Chrome", "Live status"],
      tooltip:
        "While an AusBoss node reports progress — the LaMa inpainter's " +
        "per-frame loop, for example — shows a badge above its top-right " +
        "corner with the current step and a bar filled to match. The badge " +
        "lasts only as long as the node runs: it clears when the node " +
        "finishes and when a run ends, fails, or is stopped.",
      onChange(value) {
        const on = value !== false;
        if (on === status.enabled) return;
        status.enabled = on;
        if (on) enableStatus();
        else disableStatus();
      },
    },
  ],
  setup() {
    // onChange only fires on later edits on some frontends, so seed every
    // feature from its stored value here.
    const stored = app.ui?.settings?.getSettingValue?.(FAVICON_SETTING);
    if (stored !== false && !favicon.enabled) {
      favicon.enabled = true;
      enableFavicon();
    }
    const runtimeStored = app.ui?.settings?.getSettingValue?.(RUNTIME_SETTING);
    if (runtimeStored === true && !runtime.enabled) {
      runtime.enabled = true;
      enableRuntime();
    }
    const statusStored = app.ui?.settings?.getSettingValue?.(STATUS_SETTING);
    if (statusStored !== false && !status.enabled) {
      status.enabled = true;
      enableStatus();
    }
    installDrawHook();
  },
});
