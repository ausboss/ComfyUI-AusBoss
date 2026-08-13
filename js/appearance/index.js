import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import {
  DEFAULT_SCHEME,
  NODE_COLOR_SCHEMES,
  collectGraphNodes,
  schemeColors,
  shouldRecolor,
  titleInk,
} from "../shared/appearance.mjs";
import { AUSBOSS_JS_VERSION } from "../shared/index.mjs";

const SETTING_ID = "AusBoss.Appearance.NodeColor";

// Every scheme title color (already lowercase in the table) — a node wearing
// one of these was colored by us, whether by the setting or the node menu.
const SCHEME_TITLES = new Set(
  NODE_COLOR_SCHEMES.flatMap((scheme) => (scheme.colors ? [scheme.colors.title] : [])),
);

let activeScheme = DEFAULT_SCHEME;

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

function repaintAll(nextScheme, previousScheme) {
  const next = schemeColors(nextScheme);
  const previous = schemeColors(previousScheme);
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
    if (options && isAusbossNode(this) && SCHEME_TITLES.has(color)) {
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
      options: NODE_COLOR_SCHEMES.map((scheme) => scheme.name),
      tooltip:
        "Color scheme applied to every AusBoss node's title bar and body. " +
        "Changing it recolors the open workflow immediately; nodes you have " +
        "colored by hand keep their own colors.",
      category: ["🆎 AusBoss", "Appearance", "Node color"],
      onChange(value) {
        const previous = activeScheme;
        activeScheme = value ?? DEFAULT_SCHEME;
        if (previous !== activeScheme) repaintAll(activeScheme, previous);
      },
    },
  ],
  async setup() {
    // onChange only fires on later edits, so seed from the stored value here.
    const stored = app.ui?.settings?.getSettingValue?.(SETTING_ID);
    if (NODE_COLOR_SCHEMES.some((scheme) => scheme.name === stored)) activeScheme = stored;
    installTitleInk();
    // Stale-cache probe: an updated pack served to a browser still running
    // old cached JavaScript fails in confusing ways, so say so once. Any
    // network or route failure stays silent — this is advice, not a feature.
    try {
      const response = await api.fetchApi("/ausboss/pack_version");
      const payload = await response.json();
      const server = payload?.version;
      if (response.ok && server && server !== "unknown" && server !== AUSBOSS_JS_VERSION) {
        console.warn(
          `[AusBoss] Installed pack is v${server} but this tab is running v${AUSBOSS_JS_VERSION} JavaScript from the browser cache. Hard-refresh the tab (Ctrl+Shift+R) to load the updated frontend.`,
        );
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
          options: NODE_COLOR_SCHEMES.map((scheme) => ({
            content: scheme.name,
            callback: () => {
              // A menu pick writes the colors directly; shouldRecolor then
              // treats them as the user's choice during setting sweeps.
              applyScheme(node, scheme.colors);
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
    const colors = schemeColors(activeScheme);
    if (colors) applyScheme(node, colors);
  },
});
