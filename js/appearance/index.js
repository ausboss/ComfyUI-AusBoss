import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { DEFAULT_SCHEME, NODE_COLOR_SCHEMES, schemeColors, shouldRecolor } from "../shared/appearance.mjs";
import { AUSBOSS_JS_VERSION } from "../shared/index.mjs";

const SETTING_ID = "AusBoss.Appearance.NodeColor";

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
  const nodes = app.graph?._nodes || app.graph?.nodes || [];
  const next = schemeColors(nextScheme);
  const previous = schemeColors(previousScheme);
  for (const node of nodes) {
    if (!isAusbossNode(node)) continue;
    if (!shouldRecolor(node, previous)) continue;
    applyScheme(node, next);
  }
  app.graph?.setDirtyCanvas?.(true, true);
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
  nodeCreated(node) {
    if (!isAusbossNode(node)) return;
    // Colors restored from a saved workflow (and manual picks) land before
    // this hook runs — an already-colored node is left alone.
    if (node.color || node.bgcolor) return;
    const colors = schemeColors(activeScheme);
    if (colors) applyScheme(node, colors);
  },
});
