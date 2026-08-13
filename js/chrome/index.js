import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { BRAND, BRAND_BODY } from "../shared/index.mjs";
import { composeTitle, stripQueuePrefix } from "../shared/chrome.mjs";

// Pack-wide browser-chrome status: favicon + tab-title queue status. Pure
// decision logic lives in js/shared/chrome.mjs; this file only wires DOM
// and api events.

const FAVICON_SETTING = "AusBoss.Chrome.FaviconStatus";

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

app.registerExtension({
  name: "AusBoss.Chrome",
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
  ],
  setup() {
    // onChange only fires on later edits on some frontends, so seed from
    // the stored value here.
    const stored = app.ui?.settings?.getSettingValue?.(FAVICON_SETTING);
    if (stored !== false && !favicon.enabled) {
      favicon.enabled = true;
      enableFavicon();
    }
  },
});
