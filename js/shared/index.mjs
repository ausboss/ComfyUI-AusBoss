// Shared helpers for AusBoss frontend extensions.
//
// .mjs files under js/ are NOT auto-loaded by ComfyUI (only .js files are),
// which makes this the right home for import-only utilities. Per-node
// entry points live in js/<node>/index.js and import from here.

import { app } from "/scripts/app.js";

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
