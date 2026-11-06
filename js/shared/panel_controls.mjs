// Shared controls for compact node panels. Only elements explicitly given one
// of these classes are styled; the owning panel decides where they sit.
import { BRAND } from "./index.mjs";

export const PANEL_LABELS = Object.freeze({
  load: "Load", sources: { input: "Inputs", output: "Outputs" },
  embed: "Embed workflow", off: "Off", on: "On",
});

const controlFont = 'system-ui, sans-serif';
export const CAPTION_TYPE = `font:600 11px/1.25 ${controlFont};color:#b2c6c3;`;
export const HINT_TYPE = `font:400 10px/1.25 ${controlFont};color:#95aba8;`;

export function ensurePanelControls() {
  if (document.getElementById("ausboss-panel-controls")) return;
  const style = document.createElement("style");
  style.id = "ausboss-panel-controls";
  style.textContent = `
.ausboss-compact-action{box-sizing:border-box;flex:none;height:22px;min-width:24px;padding:0 7px;border:1px solid #365957;border-radius:4px;background:#111b1c;color:#bdd8d5;font:600 11px/1 ${controlFont};white-space:nowrap;cursor:pointer;pointer-events:auto}
.ausboss-compact-action:hover:enabled,.ausboss-compact-action.active{color:#dbfffb;border-color:${BRAND};background:#173332}
.ausboss-compact-action:disabled{opacity:.5;cursor:default}
.ausboss-panel-switch{display:inline-flex;align-items:center;gap:6px;align-self:flex-end;flex:none;box-sizing:border-box;min-height:20px;margin-left:auto;padding:0 2px;background:transparent;border:0;color:#b2c6c3;font:600 11px/1 ${controlFont};cursor:pointer;user-select:none;pointer-events:auto}
.ausboss-panel-switch i{position:relative;width:24px;height:13px;border-radius:7px;background:#3a4445}
.ausboss-panel-switch i::after{content:"";position:absolute;top:2px;left:2px;width:9px;height:9px;border-radius:50%;background:#b6c4c3}
.ausboss-panel-switch[aria-checked=true] i{background:${BRAND}}
.ausboss-panel-switch[aria-checked=true] i::after{left:13px;background:#fff}
.ausboss-compact-action:focus-visible,.ausboss-panel-switch:focus-visible{outline:2px solid ${BRAND};outline-offset:1px}
`;
  document.head.append(style);
}

export function compactAction(label, title = "") {
  ensurePanelControls();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ausboss-compact-action";
  button.textContent = label;
  button.title = title;
  return button;
}

export function panelSwitch(label, title) {
  ensurePanelControls();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ausboss-panel-switch";
  button.title = title;
  button.setAttribute("role", "switch");
  button.setAttribute("aria-checked", "false");
  const thumb = document.createElement("i");
  thumb.setAttribute("aria-hidden", "true");
  button.append(label, thumb);
  return button;
}
