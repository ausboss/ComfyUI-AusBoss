import { linkOrigin } from "./clip_rate.mjs";

// The same live-input rule used by the writer timeline: muted/bypassed
// sources do not reach this node. This inspects the wire, never media bytes.
export function linkSource(node, name) {
  const slot = node.inputs?.find((input) => input?.widget?.name === name || input?.name === name);
  if (slot?.link === null || slot?.link === undefined) return null;
  const graph = node.graph;
  const link = graph?.links?.[slot.link] ?? graph?._links?.get?.(slot.link);
  const source = graph?.getNodeById?.(link?.origin_id);
  return (source?.mode ?? 0) === 0 ? source ?? null : null;
}

// Keep in step with Python video_frames (node_h3_prompt_writer.py): H3 makes
// 5 frames plus steps of 17, at most 15 s at 24 fps, rounding a clip down.
export const H3_FPS = 24;
export function h3VideoFrames(frames) {
  const count = Math.trunc(Number(frames));
  if (!(count > 0)) return null;
  return Math.max(1, Math.floor((Math.min(count, 15 * H3_FPS) - 5) / 17)) * 17 + 5;
}

// What the clip node's face last worked out for its run ({frames,
// startSeconds, endSeconds}), or null when the clip is not that node or its
// count is only known at run time.
export function clipTimingFor(node) {
  // Through Reroutes and subgraphs, as every linked value is read.
  const timing = linkOrigin(node, "video")?.node?.__ausbossClipTiming;
  return timing && timing.frames > 0 ? timing : null;
}

// The words under "From the clip": what H3 will make of the clip's frames.
export function clipLengthWords(timing) {
  if (!timing) return null;
  const made = h3VideoFrames(timing.frames);
  const seconds = (frames) => String(Number((frames / H3_FPS).toFixed(2)));
  if (made < timing.frames) {
    const up = made + 17;
    const room = timing.roomFrames ?? Infinity;
    const stops = timing.startSeconds + made / H3_FPS;
    return {
      title: `H3 makes ${made} of the clip's ${timing.frames} frames · ${seconds(made)} s`,
      note: `Stops at ${String(Number(stops.toFixed(2)))} s in the video. To use all of it, set the clip's Duration to ${seconds(made)} s${up <= Math.min(room, 15 * H3_FPS) ? ` or ${seconds(up)} s` : ""}.`,
      warn: true,
    };
  }
  if (made === timing.frames) return { title: `H3 uses all ${made} frames · ${seconds(made)} s`, note: "The clip is already a length H3 makes.", warn: false };
  return { title: `H3 makes ${made} frames · ${seconds(made)} s`, note: `That is its shortest length; the clip has ${timing.frames} frames.`, warn: true };
}

// Keep in step with Python KEEPS_ITS_LENGTH. Other jobs use seconds normally.
export function clipSetsDuration(node, values) {
  return ["swap the person", "new voice", "change something"].includes(values.video_job)
    && linkSource(node, "video") !== null;
}
