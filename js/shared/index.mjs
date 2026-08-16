// Shared helpers for AusBoss frontend extensions.
//
// .mjs files under js/ are NOT auto-loaded by ComfyUI (only .js files are),
// which makes this the right home for import-only utilities. Per-node
// entry points live in js/<node>/index.js and import from here.

import { app } from "/scripts/app.js";

// Must match `version` in pyproject.toml — scripts/release_preflight.py
// enforces it. The backend serves its copy at /ausboss/pack_version; a
// mismatch means the browser cached JavaScript from an older install.
export const AUSBOSS_JS_VERSION = "1.0.0";

export const BRAND = "#00b4aa"; // AusBoss teal — keep node accents consistent.
export const BRAND_DARK = "#007f78";
export const BRAND_BODY = "#081413";

// Wrap a LiteGraph prototype callback without clobbering whoever hooked it
// first. Other node packs patch the same prototypes, so never assign
// `proto[name] = fn` directly — always chain.
export function chainCallback(proto, name, fn) {
  const prior = proto[name];
  proto[name] = function (...args) {
    const result = prior?.apply(this, args);
    fn.apply(this, args);
    return result;
  };
}

// ComfyUI's undo/dirty tracker snapshots the graph on canvas mouse-up, but
// our DOM panels commit widget values and node.properties from click/change/
// pointerup handlers that run one phase later. Without a nudge those edits
// never mark the workflow modified and never enter undo history. Call this
// once per user gesture, AFTER the write has landed — and never from a
// workflow-load path, which must stay clean.
//
// The trailing timer batches a gesture's writes into a single snapshot and
// guarantees the capture runs after the handler that invoked us returned.
// A capture that finds nothing changed is a no-op inside the tracker.
let ausbossChangeTimer = null;

export function notifyAusbossChange() {
  if (ausbossChangeTimer) clearTimeout(ausbossChangeTimer);
  ausbossChangeTimer = setTimeout(() => {
    ausbossChangeTimer = null;
    try {
      const workflow =
        app?.extensionManager?.workflow?.activeWorkflow ??
        app?.workflowManager?.activeWorkflow;
      const tracker = workflow?.changeTracker;
      if (!tracker) return;
      if (typeof tracker.captureCanvasState === "function") tracker.captureCanvasState();
      else tracker.checkState?.();
    } catch (_error) {
      // Best effort: the widget write itself already succeeded, and a
      // frontend rename must never break the control that called us.
    }
  }, 120);
}


// The frontend sizes a DOM widget's wrapper as `widget.width ?? node.width`
// (GraphView, useDomWidget's updateWidgets). LiteGraph's layout plants
// widget.width during draws, and once planted it OUTRANKS the node width
// forever: resize the node narrower and the wrapper keeps the old width,
// parking the panel's right edge outside the node. The overflow clip cannot
// help - it clips at the wrapper's edge, which is the thing that is too
// wide. Discarding every write keeps the lookup on its node-width fallback,
// so the wrapper tracks the node in both directions for the life of the
// widget. Call it on every DOM widget right after addDOMWidget.
export function keepDomWidgetWidthAuto(widget) {
  if (!widget) return widget;
  try {
    Object.defineProperty(widget, "width", {
      get() {
        return undefined;
      },
      set(_value) {
        /* a planted layout width must never outrank the node */
      },
      configurable: true,
    });
  } catch (_error) {
    // A frozen widget object keeps its old behavior; nothing to break.
  }
  return widget;
}
