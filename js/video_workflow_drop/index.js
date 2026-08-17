// Dragging a Save Video 🆎 mp4 back onto the canvas restores the
// workflow embedded in its metadata. Core ComfyUI parses png/webp/json drops
// but not mp4, so every dropped video would otherwise dead-end in an
// "unsupported file" toast.

import { app } from "/scripts/app.js";
import { looksLikeMp4, mp4WorkflowPayload } from "../shared/mp4_workflow.mjs";

function isMp4File(file) {
  if (!file) return false;
  if (file.type === "video/mp4") return true;
  return /\.(mp4|m4v)$/i.test(String(file.name || ""));
}

app.registerExtension({
  name: "ausboss.video_workflow_drop",
  setup() {
    // app.handleFile is the funnel for both canvas drops and the open-file
    // dialog. chainCallback cannot express "consume the file and stop", so
    // wrap the method while always delegating anything we do not handle.
    const original = app.handleFile;
    if (typeof original !== "function" || app.__ausbossMp4WorkflowDrop) return;
    app.__ausbossMp4WorkflowDrop = true;
    app.handleFile = async function (file, ...rest) {
      if (isMp4File(file)) {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (looksLikeMp4(bytes)) {
            const { workflow, prompt } = mp4WorkflowPayload(bytes);
            if (workflow) {
              await app.loadGraphData(workflow, true, true, file.name);
              return;
            }
            if (prompt && typeof app.loadApiJson === "function") {
              await app.loadApiJson(prompt, file.name);
              return;
            }
          }
        } catch (error) {
          console.warn("[AusBoss] mp4 workflow restore failed:", error);
        }
      }
      return original.apply(this, [file, ...rest]);
    };
  },
});
