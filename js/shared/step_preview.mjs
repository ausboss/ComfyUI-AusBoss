// Step pictures on the pack's faces: Save Image, Save Video and Step Preview.
//
// ComfyUI sends a small picture after each sampling step of a run that asked
// for them (nodes/_step_preview_helpers.py asks when one of these nodes
// shows them). This module listens once for the whole page, keeps what the
// run is doing (step_preview_math.mjs), and lets each face draw it:
// mountStepOverlay lays the picture, a progress line and a short caption
// over a node's own picture box, and stopStepRun is the Stop button.
//
// Runs queued from another workflow tab are left to that tab.

import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { BRAND } from "./index.mjs";
import { isForeignRun } from "./prompt_scope.mjs";
import {
  IDLE,
  consumersOf,
  makerLabel,
  nextRunState,
  stepFraction,
  stepText,
  stoppedText,
} from "./step_preview_math.mjs";

const CSS_ID = "ausboss-step-preview-css";
// How long a replaced picture's object URL lives on, so a face that is
// still swapping to the new one never shows a broken picture.
const URL_GRACE_MS = 2000;

let run = IDLE;
let wired = false;
let waiting = 0;
const listeners = new Set();
// The save nodes whose steps switch is on: node -> () => boolean.
const consumers = new Map();

const rootGraph = () => app.rootGraph ?? app.graph ?? null;

function emit() {
  for (const listener of [...listeners]) {
    try {
      listener(run);
    } catch {
      // One face failing never keeps the picture from the others.
    }
  }
}

function apply(event) {
  const before = run;
  run = nextRunState(run, event);
  if (run === before) return;
  if (before.url && before.url !== run.url) {
    const stale = before.url;
    setTimeout(() => URL.revokeObjectURL(stale), URL_GRACE_MS);
  }
  emit();
}

function on(type, handler) {
  api.addEventListener(type, ({ detail }) => {
    try {
      handler(detail);
    } catch {
      // Never in the way of a run.
    }
  });
}

function wire() {
  if (wired) return;
  wired = true;
  on("execution_start", (detail) => {
    if (isForeignRun(detail?.prompt_id)) return;
    apply({ type: "start", promptId: detail?.prompt_id ?? null });
  });
  on("b_preview_with_metadata", (detail) => {
    if (!detail?.blob || isForeignRun(detail.jobId)) return;
    apply({
      type: "picture",
      promptId: detail.jobId ?? null,
      maker: String(detail.displayNodeId ?? detail.nodeId ?? ""),
      url: URL.createObjectURL(detail.blob),
    });
  });
  on("progress", (detail) => {
    if (isForeignRun(detail?.prompt_id)) return;
    apply({ type: "progress", promptId: detail?.prompt_id ?? null, node: detail?.node, value: detail?.value, max: detail?.max });
  });
  on("execution_success", (detail) => apply({ type: "end", promptId: detail?.prompt_id ?? null, kind: "success" }));
  on("execution_interrupted", (detail) => apply({ type: "end", promptId: detail?.prompt_id ?? null, kind: "interrupted" }));
  on("execution_error", (detail) => apply({ type: "end", promptId: detail?.prompt_id ?? null, kind: "error" }));
  on("status", (detail) => {
    const remaining = Number(detail?.exec_info?.queue_remaining);
    const next = Number.isFinite(remaining) ? remaining : 0;
    if (next === waiting) return;
    waiting = next;
    emit();
  });
}

// Hear about every change to the run, starting with how it is now.
export function watchSteps(listener) {
  wire();
  listeners.add(listener);
  try {
    listener(run);
  } catch {
    // Same as emit().
  }
  return () => listeners.delete(listener);
}

export function stepRun() {
  return run;
}

// Runs in the queue, the one running included.
export function queuedRuns() {
  return waiting;
}

// Stop the run that is making the pictures; the queue goes on.
export async function stopStepRun() {
  await api.interrupt(run.status === "running" ? run.promptId ?? undefined : undefined);
}

// Empty the queue, then stop the run.
export async function stopAllRuns() {
  await api.clearItems("queue");
  await api.interrupt();
}

// A save node whose steps switch is `isOn()`. Returns the way to forget it.
export function addStepConsumer(node, isOn) {
  consumers.set(node, isOn);
  return () => consumers.delete(node);
}

// Whether `node` (a save node) shows the run's current picture: its switch
// is on and the picture's maker feeds it, or feeds none of them.
export function showsStepsOn(node, current = run) {
  if (!current.maker || current.status === "idle") return false;
  const isOn = consumers.get(node);
  if (!isOn?.()) return false;
  const active = [...consumers].filter(([, on]) => on()).map(([consumer]) => consumer);
  return consumersOf(rootGraph(), active, current.maker).includes(node);
}

export function ensureStepCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-steps{display:none;position:absolute;inset:0;z-index:4;pointer-events:none;}
.ausboss-steps.on{display:block;}
.ausboss-steps-showing>img,.ausboss-steps-showing>video,.ausboss-steps-showing>.ausboss-input-preview-hint,.ausboss-steps-showing>.ausboss-video-status{visibility:hidden;}
.ausboss-steps img,.ausboss-steps.on img{display:block;position:absolute;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;object-fit:contain;visibility:visible;}
.ausboss-steps-line{position:absolute;left:0;top:0;height:3px;width:0;background:${BRAND};box-shadow:0 0 6px rgba(0,180,170,.5);transition:width .15s linear;}
.ausboss-steps-chip{position:absolute;left:6px;right:6px;bottom:6px;box-sizing:border-box;padding:4px 7px;border:1px solid rgba(255,255,255,.08);border-radius:5px;background:rgba(8,12,13,.84);color:#d8ecea;font:600 10.5px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ausboss-steps-chip .who{color:#7d9593;font-weight:500;}
.ausboss-steps.stopped img{filter:brightness(.55) saturate(.7);}
.ausboss-steps.stopped .ausboss-steps-line{display:none;}
.ausboss-steps.stopped .ausboss-steps-chip{border-color:rgba(224,96,90,.55);color:#ffd0cc;}
.ausboss-steps-hint{position:absolute;left:50%;top:50%;max-width:86%;transform:translate(-50%,-50%);color:#78908e;font:11px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;}
.ausboss-steps-stop{border-color:rgba(224,96,90,.8)!important;background:rgba(58,28,27,.9)!important;color:#ffd9d6!important;}
.ausboss-steps-stop:hover{background:rgba(120,38,33,.95)!important;color:#fff!important;}
.ausboss-steps-stop::before{content:"";display:inline-block;width:6px;height:6px;margin-right:5px;border-radius:1px;background:#e0605a;vertical-align:1px;}
.ausboss-video-tool.ausboss-steps-stop{display:none;}
.ausboss-video-tool.ausboss-steps-stop.live{display:inline-block;}
.ausboss-video-stage.is-still .ausboss-video-tools.ausboss-steps-tools{display:flex;}
.ausboss-video-stage.is-still .ausboss-steps-tools>.ausboss-steps-loop{display:none;}
`;
  document.head.appendChild(style);
}

// The step picture laid over `stage` (a node's own picture box, which must
// be positioned). show() draws a run, hide() gives the box back.
export function mountStepOverlay(stage) {
  ensureStepCss();
  const root = document.createElement("div");
  root.className = "ausboss-steps";
  const img = document.createElement("img");
  img.alt = "";
  const line = document.createElement("div");
  line.className = "ausboss-steps-line";
  const chip = document.createElement("div");
  chip.className = "ausboss-steps-chip";
  root.append(img, line, chip);
  stage.append(root);
  let shown = false;
  return {
    root,
    get shown() {
      return shown;
    },
    // `saves`: the node saves the result, so a stopped run says nothing was.
    show(current, { saves = false } = {}) {
      if (!current?.url) return this.hide();
      if (img.getAttribute("src") !== current.url) img.src = current.url;
      const stopped = current.status === "stopped";
      root.classList.toggle("stopped", stopped);
      line.style.width = `${Math.round(stepFraction(current) * 100)}%`;
      const who = makerLabel(rootGraph(), current.maker);
      chip.textContent = stopped ? stoppedText(current, { saves }) : stepText(current);
      if (who && !stopped) {
        const span = document.createElement("span");
        span.className = "who";
        span.textContent = ` · ${who}`;
        chip.append(span);
      }
      chip.title = who ? `${chip.textContent}` : "";
      root.classList.add("on");
      stage.classList.add("ausboss-steps-showing");
      shown = true;
      return true;
    },
    hide() {
      root.classList.remove("on", "stopped");
      stage.classList.remove("ausboss-steps-showing");
      img.removeAttribute("src");
      shown = false;
      return false;
    },
  };
}
