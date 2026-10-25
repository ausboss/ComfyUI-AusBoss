// Step Preview 🆎: the picture while it is being made, one step at a time,
// with a Stop button. It needs no wires: it shows whichever sampler in this
// workflow is making a picture, then the finished picture once the run has
// saved it, and keeps that after the run.
//
// The pictures and the run come from shared/step_preview.mjs; the server
// side asks for them (nodes/_step_preview_helpers.py).

import { app } from "/scripts/app.js";
import { BRAND, chainCallback, keepDomWidgetWidthAuto } from "../shared/index.mjs";
import { WIDGET_FRAME, fillNodeHeight } from "../shared/panel_layout.mjs";
import { ensureStepCss, mountStepOverlay, queuedRuns, stopAllRuns, stopStepRun, watchSteps } from "../shared/step_preview.mjs";

const NODE_CLASS = "AUSBOSS_NODES_StepPreview";
const CSS_ID = "ausboss-step-preview-node-css";
const WIDGET_NAME = "ausboss_step_preview_panel";
const DEFAULT_SIZE = [320, 340];
const PANEL_MIN_WIDTH = 240;
const BAR_HEIGHT = 20;
const STAGE_MIN_HEIGHT = 140;
const PANEL_MIN_HEIGHT = BAR_HEIGHT + 4 + STAGE_MIN_HEIGHT + 6;
const IDLE_HINT = "Run the workflow to watch the picture form here.";

function ensureCss() {
  ensureStepCss();
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-steppv{box-sizing:border-box;display:flex;flex-direction:column;gap:4px;width:100%;height:100%;padding:0 6px 6px;pointer-events:none;overflow:hidden;}
.ausboss-steppv-bar{box-sizing:border-box;flex:none;display:flex;align-items:center;gap:6px;height:${BAR_HEIGHT}px;padding:0 2px;}
.ausboss-steppv-bar button{box-sizing:border-box;height:${BAR_HEIGHT}px;min-width:24px;padding:0 6px;border:1px solid rgba(0,180,170,.52);border-radius:4px;background:rgba(0,0,0,.7);color:#c8dddd;font:700 9px/18px "Segoe UI",sans-serif;white-space:nowrap;cursor:pointer;pointer-events:auto;}
.ausboss-steppv-bar button:hover{border-color:${BRAND};color:#fff;background:rgba(0,79,75,.78);}
.ausboss-steppv-bar button:disabled{opacity:.38;cursor:default;pointer-events:none;}
.ausboss-steppv-bar button.ausboss-steps-stop:disabled{border-color:rgba(0,180,170,.3)!important;background:rgba(0,0,0,.5)!important;color:#7d9593!important;}
.ausboss-steppv-bar button.ausboss-steps-stop:disabled::before{background:#5f7674;}
.ausboss-steppv-bar .all[hidden]{display:none;}
.ausboss-steppv-state{margin-left:auto;color:#5f7674;font:10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;}
.ausboss-steppv-state.live{color:${BRAND};}
.ausboss-steppv-stage{position:relative;flex:1 1 auto;min-height:0;width:100%;overflow:hidden;border:1px solid rgba(0,180,170,.27);border-radius:6px;background:rgba(0,0,0,.28);}
[data-node-id] .ausboss-steppv-stage{box-sizing:border-box;min-height:${STAGE_MIN_HEIGHT}px;}
.ausboss-steppv-stage.ausboss-steps-showing .ausboss-steps-hint{display:none;}
`;
  document.head.appendChild(style);
}

function button(label, title, onClick, signal) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.title = title;
  // A press here is a click on the button, not the start of a node drag.
  element.addEventListener("pointerdown", (event) => event.stopPropagation(), { signal });
  element.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    Promise.resolve(onClick()).catch(() => {});
  }, { signal });
  return element;
}

const STATE_TEXT = { running: "running", done: "done", stopped: "stopped", failed: "failed" };

function sync(state, run) {
  const running = run.status === "running";
  const waiting = Math.max(0, queuedRuns() - (running ? 1 : 0));
  state.stop.disabled = !running;
  state.all.hidden = waiting < 1;
  state.all.textContent = `STOP ALL · ${waiting}`;
  state.all.title = `Stop this run and empty the queue (${waiting} waiting).`;
  state.readout.textContent = STATE_TEXT[run.status] ?? "";
  state.readout.classList.toggle("live", running);
  // The finished picture replaces the blurry last step as soon as the run
  // saves it, and stays after the run, until the next one starts.
  if (run.url || run.result) state.overlay.show(run, { result: true });
  else if (running || run.status === "idle") state.overlay.hide();
}

function buildPanel(node) {
  if (node.__ausbossStepPreview) return node.__ausbossStepPreview;
  ensureCss();
  const abort = new AbortController();
  const root = document.createElement("div");
  root.className = "ausboss-steppv";
  const bar = document.createElement("div");
  bar.className = "ausboss-steppv-bar";
  const stage = document.createElement("div");
  stage.className = "ausboss-steppv-stage";
  const hint = document.createElement("div");
  hint.className = "ausboss-steps-hint";
  hint.textContent = IDLE_HINT;
  stage.append(hint);
  root.append(bar, stage);

  const stop = button("STOP", "Stop this run now. The next run in the queue still starts.", stopStepRun, abort.signal);
  stop.classList.add("ausboss-steps-stop");
  const all = button("STOP ALL", "Stop this run and empty the queue.", stopAllRuns, abort.signal);
  all.classList.add("all");
  all.hidden = true;
  const readout = document.createElement("span");
  readout.className = "ausboss-steppv-state";
  bar.append(stop, all, readout);

  const widget = node.addDOMWidget(WIDGET_NAME, "ausboss_step_preview", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => PANEL_MIN_HEIGHT + WIDGET_FRAME,
  });
  keepDomWidgetWidthAuto(widget);
  // Not saved with the workflow either: options.serialize only keeps it out
  // of the prompt, and saved values come back by position.
  widget.serialize = false;
  fillNodeHeight(widget, {
    minWidth: PANEL_MIN_WIDTH,
    minHeight: () => PANEL_MIN_HEIGHT + WIDGET_FRAME,
    minNodeSize: [PANEL_MIN_WIDTH, PANEL_MIN_HEIGHT + 40],
    exactMinWidth: true,
  });

  const state = { node, root, stage, stop, all, readout, widget, abort };
  state.overlay = mountStepOverlay(stage);
  state.forget = watchSteps((run) => sync(state, run));
  node.__ausbossStepPreview = state;
  return state;
}

app.registerExtension({
  name: "ausboss.step_preview",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      buildPanel(this);
      // A new node opens at a picture's size; onConfigure puts a saved
      // workflow's own size back after this.
      this.setSize?.([
        Math.max(this.size?.[0] ?? 0, DEFAULT_SIZE[0]),
        Math.max(this.size?.[1] ?? 0, DEFAULT_SIZE[1]),
      ]);
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      const state = this.__ausbossStepPreview;
      if (!state) return;
      state.forget?.();
      state.abort.abort();
      this.__ausbossStepPreview = null;
    });
  },
});
