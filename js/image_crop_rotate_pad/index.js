import { registerTransformExtension } from "../shared/transform_editor.mjs";
import { keepDomWidgetWidthAuto } from "../shared/index.mjs";
import { fillNodeHeight } from "../shared/panel_layout.mjs";
import { stageHeightForWidth } from "../shared/transform_geometry.mjs";

const PANEL_MIN_WIDTH = 330;
// Two action rows (open editor + the reset/feather/resize quick row),
// column gaps, and panel padding around the stage canvas.
const PANEL_CHROME = 92;
const PANEL_MIN_HEIGHT = stageHeightForWidth(0) + PANEL_CHROME;

// Guard rule the DOM-panel audit (tests/panel_guards.test.mjs) checks next
// to the addDOMWidget call: padding stays inside the widget's box and
// oversized content clips at the panel edge instead of escaping the node.
// The shared transform stylesheet carries the same declarations; this rule
// keeps them greppable beside the mount that depends on them.
const GUARD_CSS_ID = "ausboss-transform-panel-guards";
const GUARD_CSS = ".ausboss-transform-panel{box-sizing:border-box;overflow:hidden}";

function mountTransformPanel(node, panel) {
  if (!document.getElementById(GUARD_CSS_ID)) {
    const style = document.createElement("style");
    style.id = GUARD_CSS_ID;
    style.textContent = GUARD_CSS;
    document.head.appendChild(style);
  }
  const widget = node.addDOMWidget("ausboss_transform_preview", "ausboss_transform_preview", panel, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => PANEL_MIN_HEIGHT,
  });
  keepDomWidgetWidthAuto(widget);
  fillNodeHeight(widget, {
    minWidth: PANEL_MIN_WIDTH,
    minHeight: PANEL_MIN_HEIGHT,
    minNodeSize: [PANEL_MIN_WIDTH, 320],
  });
  return widget;
}

registerTransformExtension("AUSBOSS_NODES_ImageCropRotatePad", "image", mountTransformPanel);
