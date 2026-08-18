// Pure resolution rules for the upstream-input preview panel. DOM-free so
// node:test covers them without a browser; the wiring lives in
// js/input_preview/index.js.
//
// Best-effort order for a connected source node:
//   1. cached execution previews (sourceNode.imgs[0].src)
//   2. an uploadable image/video file combo widget -> deterministic /view query
//   3. nothing -> the caller shows a quiet placeholder

import { splitMediaName } from "./video_preview.mjs";

// Core loader nodes keep the uploaded file name in a combo widget with one of
// these names (LoadImage uses "image", video loaders use "video").
const FILE_WIDGET_NAMES = new Set(["image", "video"]);

// Graph link stores differ by frontend generation: a Map on the modern
// frontend, a plain id-keyed object on legacy LiteGraph.
export function linkById(graph, linkId) {
  const links = graph?.links;
  if (links == null || linkId == null) return null;
  const link = typeof links.get === "function" ? links.get(linkId) : links[linkId];
  return link ?? null;
}

// Walk the named input's link back to the node feeding it, or null.
export function upstreamNode(node, inputName) {
  const graph = node?.graph;
  if (!graph) return null;
  const input = node.inputs?.find((candidate) => candidate?.name === inputName);
  const link = linkById(graph, input?.link);
  if (!link) return null;
  return graph.getNodeById?.(link.origin_id) ?? null;
}

// The widget whose callback fires when the user picks a different file.
export function sourceFileWidget(sourceNode) {
  return sourceNode?.widgets?.find((widget) => FILE_WIDGET_NAMES.has(widget?.name)) ?? null;
}

// Deterministic /view query (no cache buster) for an input-folder file name,
// tolerating Windows separators and " [input]" annotations.
export function viewQueryForFile(name) {
  const { filename, subfolder } = splitMediaName(name);
  return new URLSearchParams({ filename, subfolder, type: "input" }).toString();
}

// Describe how to preview a source node:
//   { kind: "url", url }                    cached preview image
//   { kind: "view", isVideo, query }        file widget, serve via api /view
//   null                                    nothing resolvable
export function describeSourcePreview(sourceNode) {
  if (!sourceNode) return null;
  const cached = sourceNode.imgs?.[0]?.src;
  if (typeof cached === "string" && cached) return { kind: "url", url: cached };
  const widget = sourceFileWidget(sourceNode);
  if (widget && typeof widget.value === "string" && widget.value) {
    return {
      kind: "view",
      isVideo: widget.name === "video",
      query: viewQueryForFile(widget.value),
    };
  }
  return null;
}

// The node's own latest result, if it has produced one.
//
// imgs is where the frontend leaves both the streamed progress frames of a
// running node and the images from its ui payload, so the last entry is the
// most recent thing this node made. The panel prefers it over the upstream
// input for the obvious reason: once a node has a result, its result is what
// you want to look at.
export function describeOwnResult(node) {
  const images = node?.imgs;
  if (!Array.isArray(images) || images.length === 0) return null;
  const src = images[images.length - 1]?.src;
  return typeof src === "string" && src ? { kind: "url", url: src } : null;
}

// What the panel shows, best first: this node's result, then whatever feeds
// it, then nothing.
export function describeNodePreview(node, inputName) {
  return describeOwnResult(node) ?? describeSourcePreview(upstreamNode(node, inputName));
}

// Quiet ASCII placeholder copy; never an error.
export function placeholderText(connected, noun = "an image") {
  return connected ? "run to preview" : `connect ${noun} to preview`;
}
