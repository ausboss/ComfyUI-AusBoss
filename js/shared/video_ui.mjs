import { BRAND, BRAND_DARK } from "./index.mjs";

export const CORE_VIDEO_PREVIEW_WIDGET = "video-preview";
export const VIDEO_MIN_WIDTH = 220;

const CSS_ID = "ausboss-video-ui-v2";

export function ensureVideoCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-video-root{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;gap:6px;padding:2px 6px 6px;color:#d8eeee;font:11px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden;}
.ausboss-video-stage{position:relative;flex:1 1 auto;min-height:112px;overflow:hidden;border:1px solid rgba(0,180,170,.34);border-radius:6px;background:#000;box-shadow:inset 0 0 0 1px rgba(255,255,255,.025);}
.ausboss-video-stage video{display:block;width:100%;height:100%;min-height:112px;object-fit:contain;background:#000;}
.ausboss-video-stage.is-empty video{visibility:hidden;}
.ausboss-video-status{position:absolute;left:7px;top:7px;z-index:3;max-width:calc(100% - 112px);padding:3px 6px;border-radius:4px;background:rgba(0,0,0,.7);color:#b8d3d1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;backdrop-filter:blur(4px);}
.ausboss-video-stage.is-empty .ausboss-video-status{left:50%;top:50%;max-width:82%;transform:translate(-50%,-50%);color:#78908e;text-align:center;white-space:normal;}
.ausboss-video-tools{position:absolute;right:6px;top:6px;z-index:4;display:flex;gap:4px;opacity:.9;}
.ausboss-video-tools:hover{opacity:1;}
.ausboss-video-tool{box-sizing:border-box;height:22px;min-width:24px;padding:0 6px;border:1px solid rgba(0,180,170,.52);border-radius:4px;background:rgba(0,0,0,.66);color:#c8dddd;font:700 9px/20px "Segoe UI",sans-serif;cursor:pointer;}
.ausboss-video-tool:hover{border-color:${BRAND};color:#fff;background:rgba(0,79,75,.78);}
.ausboss-video-tool.active{border-color:${BRAND};color:${BRAND};box-shadow:0 0 7px rgba(0,180,170,.26);}
.ausboss-video-trim{box-sizing:border-box;flex:none;height:76px;padding:7px 8px 5px;border:1px solid rgba(0,180,170,.27);border-radius:6px;background:rgba(0,0,0,.28);}
.ausboss-video-range{position:relative;height:28px;touch-action:none;cursor:pointer;user-select:none;}
.ausboss-video-range::before{content:"";position:absolute;left:0;right:0;top:11px;height:6px;border-radius:4px;background:#27302f;box-shadow:inset 0 1px 2px rgba(0,0,0,.8);}
.ausboss-video-selection{position:absolute;top:11px;height:6px;border-radius:4px;background:${BRAND};box-shadow:0 0 7px rgba(0,180,170,.36);pointer-events:none;}
.ausboss-video-handle{position:absolute;top:3px;width:12px;height:22px;margin-left:-6px;border:1px solid ${BRAND};border-radius:4px;background:#f4ffff;box-shadow:0 1px 5px rgba(0,0,0,.75);pointer-events:none;}
.ausboss-video-handle::after{content:"";position:absolute;left:4px;top:5px;width:2px;height:10px;border-radius:2px;background:${BRAND_DARK};}
.ausboss-video-values{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:7px;color:#708b89;font-size:10px;}
.ausboss-video-value{display:flex;align-items:center;gap:5px;min-width:0;}
.ausboss-video-value:last-child{justify-content:flex-end;}
.ausboss-video-value label{color:${BRAND};font-size:9px;font-weight:700;letter-spacing:.08em;}
.ausboss-video-value input{box-sizing:border-box;width:66px;min-width:0;padding:2px 4px;border:1px solid transparent;border-radius:3px;outline:none;background:transparent;color:#d8eeee;font:11px/1.2 "Segoe UI",sans-serif;}
.ausboss-video-value input:hover,.ausboss-video-value input:focus{border-color:rgba(0,180,170,.55);background:rgba(0,0,0,.28);}
.ausboss-video-duration{overflow:hidden;color:#8ba3a1;text-align:center;white-space:nowrap;text-overflow:ellipsis;}
`;
  document.head.appendChild(style);
}

export function hideCanvasWidget(widget, element = null) {
  if (!widget || widget.__ausbossHidden) return;
  widget.__ausbossHidden = true;
  widget.hidden = true;
  widget._hidden = true;
  widget.computeSize = () => [0, -4];
  widget.computeLayoutSize = () => ({ minWidth: 0, minHeight: 0 });
  widget.draw = () => {};
  widget.mouse = () => false;
  if (element) element.style.display = "none";
}

export function suppressCoreVideoPreview(node) {
  if (!node || node.__ausbossCorePreviewSuppressed) return;
  node.__ausbossCorePreviewSuppressed = true;
  const prior = node.addDOMWidget;
  if (typeof prior === "function") {
    node.addDOMWidget = function (name, type, element, options) {
      const widget = prior.call(this, name, type, element, options);
      if (name === CORE_VIDEO_PREVIEW_WIDGET) hideCanvasWidget(widget, element);
      return widget;
    };
  }
  for (const widget of node.widgets || []) {
    if (widget.name === CORE_VIDEO_PREVIEW_WIDGET) {
      hideCanvasWidget(widget, widget.element || node.videoContainer);
    }
  }
}

export function makeToolButton(label, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ausboss-video-tool";
  button.textContent = label;
  button.title = title;
  return button;
}
