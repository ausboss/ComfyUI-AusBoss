import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { BRAND, chainCallback } from "../shared/index.mjs";

// Compact preview player for Load Video (AusBoss) with two playhead-capture
// buttons that fill start_seconds / end_seconds — the node's whole point.

const NODE_NAME = "AUSBOSS_NODES_LoadVideo";

function findWidget(node, name) {
  return node.widgets?.find((widget) => widget.name === name);
}

function buildPreview(node) {
  const videoWidget = findWidget(node, "video");
  const startWidget = findWidget(node, "start_seconds");
  const endWidget = findWidget(node, "end_seconds");
  if (!videoWidget || !startWidget || !endWidget) return;

  const container = document.createElement("div");
  container.style.cssText =
    "display:flex;flex-direction:column;gap:4px;padding:2px 0;width:100%;";

  const videoElement = document.createElement("video");
  videoElement.controls = true;
  videoElement.muted = true;
  videoElement.preload = "metadata";
  videoElement.style.cssText =
    "width:100%;max-height:220px;background:#111;border-radius:4px;";
  container.appendChild(videoElement);

  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:4px;";
  const makeButton = (label, onClick) => {
    const button = document.createElement("button");
    button.textContent = label;
    button.style.cssText =
      `flex:1;padding:3px 0;border:1px solid ${BRAND};border-radius:4px;` +
      `background:transparent;color:${BRAND};cursor:pointer;font-size:11px;`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    row.appendChild(button);
    return button;
  };
  const capture = (widget) => {
    if (!videoElement.duration) return;
    widget.value = Math.round(videoElement.currentTime * 100) / 100;
    widget.callback?.(widget.value);
    node.setDirtyCanvas(true, true);
  };
  makeButton("⏱ set start", () => capture(startWidget));
  makeButton("⏱ set end", () => capture(endWidget));
  container.appendChild(row);

  const previewWidget = node.addDOMWidget("ausboss_video_preview", "preview", container, {
    serialize: false,
    hideOnZoom: false,
  });
  previewWidget.computeSize = (width) => [width, 252];

  const refresh = () => {
    const name = videoWidget.value;
    if (!name || typeof name !== "string") return;
    const [subfolder, file] = name.includes("/")
      ? [name.slice(0, name.lastIndexOf("/")), name.slice(name.lastIndexOf("/") + 1)]
      : ["", name];
    videoElement.src = api.apiURL(
      `/view?filename=${encodeURIComponent(file)}&type=input&subfolder=${encodeURIComponent(subfolder)}&t=${Date.now()}`
    );
  };
  const priorCallback = videoWidget.callback;
  videoWidget.callback = function (...args) {
    const result = priorCallback?.apply(this, args);
    refresh();
    return result;
  };
  // setTimeout, not requestAnimationFrame: rAF never fires in background
  // tabs, which would leave workflows loaded there with a blank preview.
  setTimeout(refresh, 0);
}

app.registerExtension({
  name: "ausboss.load_video",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_NAME) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      buildPreview(this);
    });
  },
});
