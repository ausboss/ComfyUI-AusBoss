import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import {
  CUSTOM_SCHEME,
  DEFAULT_SCHEME,
  NODE_COLOR_SCHEMES,
  SCHEME_NAMES,
  collectGraphNodes,
  normalizeHexColor,
  schemeColors,
  shouldRecolor,
  titleInk,
} from "../shared/appearance.mjs";
import { AUSBOSS_JS_VERSION } from "../shared/index.mjs";

const SETTING_ID = "AusBoss.Appearance.NodeColor";
const CUSTOM_SETTING_ID = "AusBoss.Appearance.CustomColor";

// Stored bare (no "#") to match the color setting's storage contract.
const DEFAULT_CUSTOM_COLOR = "00b4aa";

// Every scheme title color (already lowercase in the table) — a node wearing
// one of these was colored by us, whether by the setting or the node menu.
const SCHEME_TITLES = new Set(
  NODE_COLOR_SCHEMES.flatMap((scheme) => (scheme.colors ? [scheme.colors.title] : [])),
);

let activeScheme = DEFAULT_SCHEME;
let activeCustomColor = DEFAULT_CUSTOM_COLOR;
// Normalized "#rrggbb" of the custom title (null when unusable), kept in
// step with activeCustomColor so the per-frame title-ink check stays cheap.
let activeCustomTitle = normalizeHexColor(DEFAULT_CUSTOM_COLOR);

function setActiveCustomColor(value) {
  activeCustomColor = value;
  activeCustomTitle = normalizeHexColor(value);
}

// Surface the stale-cache warning where the user actually looks. On current
// frontends app.extensionManager is the workspace store, whose `toast` is the
// toast store: add({ severity, summary, detail, life }) queues a PrimeVue
// toast. Older frontends without it fall back to the console, and nothing in
// here may ever throw — this is advice, not a feature.
function warnStaleJs(serverVersion) {
  const detail =
    `Installed pack is v${serverVersion} but this tab is running ` +
    `v${AUSBOSS_JS_VERSION} JavaScript from the browser cache. Hard-refresh ` +
    "the tab (Ctrl+Shift+R) to load the updated frontend.";
  try {
    const toast = app.extensionManager?.toast;
    if (typeof toast?.add === "function") {
      toast.add({
        severity: "warn",
        summary: "AusBoss frontend is stale",
        detail,
        life: 15000,
      });
      return;
    }
  } catch (_error) {
    // Toast store missing or incompatible: the console still works.
  }
  console.warn(`[AusBoss] ${detail}`);
}

function isAusbossNode(node) {
  const comfyClass = node?.comfyClass || "";
  return comfyClass.startsWith("AUSBOSS_NODES_") || comfyClass === "SimpleWatermarkRemover";
}

function applyScheme(node, colors) {
  // Assigning undefined (never `delete`) keeps the property reactive under
  // the Vue-based Nodes 2.0 renderer while still restoring theme defaults.
  node.color = colors ? colors.title : undefined;
  node.bgcolor = colors ? colors.body : undefined;
}

// Repaint every AusBoss node still following the setting from one color
// pair to another; pairs (not names) so a CustomColor edit can sweep too.
function repaintAll(next, previous) {
  for (const node of collectGraphNodes(app.graph)) {
    if (!isAusbossNode(node)) continue;
    if (!shouldRecolor(node, previous)) continue;
    applyScheme(node, next);
  }
  app.graph?.setDirtyCanvas?.(true, true);
}

// Scheme titles are dark pigments, so the frontend's default title ink can
// land unreadably close. Wrapping drawTitleText is the sanctioned exception
// to the chainCallback rule: a draw method must return through the original,
// so we save it once, delegate always, and only swap the default color in.
// Nodes 2.0 renders titles in the DOM, not through drawTitleText — out of scope.
function installTitleInk() {
  const proto = window.LiteGraph?.LGraphNode?.prototype;
  if (typeof proto?.drawTitleText !== "function") {
    console.warn("[AusBoss] LGraphNode.drawTitleText not found; adaptive title ink disabled");
    return;
  }
  if (proto.drawTitleText.ausbossTitleInk) return; // already wrapped
  const original = proto.drawTitleText;
  function drawTitleTextWithInk(ctx, options, ...rest) {
    const color = typeof this?.color === "string" ? this.color.trim().toLowerCase() : "";
    if (
      options &&
      isAusbossNode(this) &&
      (SCHEME_TITLES.has(color) || (activeCustomTitle !== null && color === activeCustomTitle))
    ) {
      options = { ...options, default_title_color: titleInk(color) };
    }
    return original.call(this, ctx, options, ...rest);
  }
  drawTitleTextWithInk.ausbossTitleInk = true;
  proto.drawTitleText = drawTitleTextWithInk;
}

app.registerExtension({
  name: "AusBoss.Appearance",
  settings: [
    {
      id: SETTING_ID,
      name: "AusBoss node color",
      type: "combo",
      defaultValue: DEFAULT_SCHEME,
      options: SCHEME_NAMES,
      tooltip:
        "Color scheme applied to every AusBoss node's title bar and body. " +
        "Changing it recolors the open workflow immediately; nodes you have " +
        "colored by hand keep their own colors. Custom uses the color picked " +
        "in the Custom color setting.",
      category: ["🆎 AusBoss", "Appearance", "Node color"],
      onChange(value) {
        const previous = activeScheme;
        activeScheme = value ?? DEFAULT_SCHEME;
        if (previous === activeScheme) return;
        const colors = schemeColors(activeScheme, activeCustomColor);
        // Custom with an unusable stored color resolves to null, which reads
        // downstream as "Theme default" and would strip the color off every
        // AusBoss node in the graph. The per-node menu already refuses this;
        // the setting has to refuse it too.
        if (activeScheme === CUSTOM_SCHEME && !colors) return;
        repaintAll(colors, schemeColors(previous, activeCustomColor));
      },
    },
    {
      id: CUSTOM_SETTING_ID,
      name: "AusBoss custom color",
      type: "color",
      defaultValue: DEFAULT_CUSTOM_COLOR,
      tooltip:
        "Title-bar color used when AusBoss node color is set to Custom; the " +
        "body color is derived automatically by muting the pick toward the " +
        "dark canvas. Editing it while Custom is active recolors the open " +
        "workflow immediately.",
      category: ["🆎 AusBoss", "Appearance", "Custom color"],
      onChange(value) {
        const previous = activeCustomColor;
        setActiveCustomColor(value);
        if (activeScheme !== CUSTOM_SCHEME) return;
        const next = schemeColors(CUSTOM_SCHEME, activeCustomColor);
        const before = schemeColors(CUSTOM_SCHEME, previous);
        if (next && next.title !== before?.title) repaintAll(next, before);
      },
    },
  ],
  async setup() {
    // onChange only fires on later edits, so seed from the stored values here.
    const stored = app.ui?.settings?.getSettingValue?.(SETTING_ID);
    if (SCHEME_NAMES.includes(stored)) activeScheme = stored;
    const storedCustom = app.ui?.settings?.getSettingValue?.(CUSTOM_SETTING_ID);
    if (normalizeHexColor(storedCustom)) setActiveCustomColor(storedCustom);
    installTitleInk();
    // Stale-cache probe: an updated pack served to a browser still running
    // old cached JavaScript fails in confusing ways, so say so once. Any
    // network or route failure stays silent — this is advice, not a feature.
    try {
      const response = await api.fetchApi("/ausboss/pack_version");
      const payload = await response.json();
      const server = payload?.version;
      if (response.ok && server && server !== "unknown" && server !== AUSBOSS_JS_VERSION) {
        warnStaleJs(server);
      }
    } catch (_error) {
      // Old backend without the route, offline, or a non-JSON reply: silent.
    }
  },
  getNodeMenuItems(node) {
    if (!isAusbossNode(node)) return [];
    return [
      {
        content: "AusBoss color",
        has_submenu: true,
        submenu: {
          options: SCHEME_NAMES.map((name) => ({
            content: name,
            callback: () => {
              // A menu pick writes the colors directly; shouldRecolor then
              // treats them as the user's choice during setting sweeps.
              const colors = schemeColors(name, activeCustomColor);
              // Custom with an unusable stored color resolves to null, which
              // would wrongly read as "Theme default" — do nothing instead.
              if (name === CUSTOM_SCHEME && !colors) return;
              applyScheme(node, colors);
              app.graph?.setDirtyCanvas?.(true, true);
            },
          })),
        },
      },
    ];
  },
  nodeCreated(node) {
    if (!isAusbossNode(node)) return;
    // Colors restored from a saved workflow (and manual picks) land before
    // this hook runs — an already-colored node is left alone.
    if (node.color || node.bgcolor) return;
    const colors = schemeColors(activeScheme, activeCustomColor);
    if (colors) applyScheme(node, colors);
  },
});
