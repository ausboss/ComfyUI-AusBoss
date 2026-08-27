// Dragging a Save Video 🆎 mp4 back onto the canvas restores the
// workflow embedded in its metadata. Core ComfyUI parses png/webp/json drops
// but not mp4, so every dropped video would otherwise dead-end in an
// "unsupported file" toast.
//
// Dropping a video ONTO a Load Video 🆎 node is a different gesture with a
// different meaning: the node keeps the canvas and takes the file as its
// source, and an AusBoss-saved file also hands back the trim and sampling
// values its embedded workflow stored - like re-opening the clip the way it
// was loaded before. Core routes node-targeted drops through onDragDrop
// before falling back to the canvas path, which is what keeps the two
// gestures apart.

import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { notifyAusbossChange } from "../shared/index.mjs";
import {
  isVideoFileName,
  loadVideoRestoreValues,
} from "../shared/load_video_restore.mjs";
import { looksLikeMp4, mp4WorkflowPayload } from "../shared/mp4_workflow.mjs";

const LOAD_VIDEO_NODE = "AUSBOSS_NODES_LoadVideo";

function isMp4File(file) {
  if (!file) return false;
  if (file.type === "video/mp4") return true;
  return /\.(mp4|m4v)$/i.test(String(file.name || ""));
}

// Core's upload route stores into the input folder and answers with the
// stored name; identical content reuses the existing file, so re-dropping
// the same clip never piles up copies.
async function uploadToInput(file) {
  const body = new FormData();
  body.append("image", file);
  const response = await api.fetchApi("/upload/image", { method: "POST", body });
  if (!response.ok) throw new Error(`upload failed (${response.status})`);
  const data = await response.json();
  const name = String(data?.name || file.name);
  const subfolder = String(data?.subfolder || "");
  return subfolder ? `${subfolder}/${name}` : name;
}

function applyDropToLoadVideo(node, restored, uploadedName) {
  const widget = (name) => node.widgets?.find((item) => item.name === name);
  // Restored values land silently first; the video callback below repaints
  // the preview once with all of them already in place, so no load-path
  // callback ever sees (or wipes) a half-restored trim.
  for (const [name, value] of Object.entries(restored ?? {})) {
    const target = widget(name);
    if (target) target.value = value;
  }
  const videoWidget = widget("video");
  if (videoWidget) {
    const options = videoWidget.options?.values;
    if (Array.isArray(options) && !options.includes(uploadedName)) {
      options.push(uploadedName);
    }
    videoWidget.value = uploadedName;
    videoWidget.callback?.(uploadedName);
  }
  node.setDirtyCanvas?.(true, true);
  notifyAusbossChange();
}

// Once a video lands on the node, the node owns it: even a failed restore
// returns true, because falling through would hand the file to the canvas
// path, which replaces the user's whole graph - never an acceptable
// surprise for a drop aimed at one node.
async function handleLoadVideoDrop(node, file) {
  try {
    let restored = null;
    if (isMp4File(file) || /\.mov$/i.test(String(file.name || ""))) {
      // mov shares the ISO box layout, so its tags parse the same way.
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (looksLikeMp4(bytes)) {
        restored = loadVideoRestoreValues(mp4WorkflowPayload(bytes).workflow);
      }
    }
    const uploadedName = await uploadToInput(file);
    applyDropToLoadVideo(node, restored, uploadedName);
  } catch (error) {
    console.warn("[AusBoss] video drop onto Load Video failed:", error);
  }
  return true;
}

app.registerExtension({
  name: "ausboss.video_workflow_drop",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== LOAD_VIDEO_NODE) return;
    const proto = nodeType.prototype;
    // These hooks answer core with a verdict (highlight? consumed?), and
    // chainCallback discards return values - so wrap by hand, delegating
    // first exactly like the app.handleFile wrap below.
    const priorOver = proto.onDragOver;
    proto.onDragOver = function (event, ...rest) {
      if (priorOver?.apply(this, [event, ...rest])) return true;
      const items = event?.dataTransfer?.items;
      // File names are unreadable during dragover; type is the best signal.
      // An empty type still highlights - the drop itself checks the name.
      return !!items && Array.from(items).some(
        (item) => item.kind === "file" && (item.type === "" || item.type.startsWith("video/")),
      );
    };
    const priorDrop = proto.onDragDrop;
    proto.onDragDrop = async function (event, ...rest) {
      if (await priorDrop?.apply(this, [event, ...rest])) return true;
      const file = Array.from(event?.dataTransfer?.files ?? [])
        .find((candidate) => isVideoFileName(candidate.name));
      if (!file) return false;
      return handleLoadVideoDrop(this, file);
    };
  },
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
