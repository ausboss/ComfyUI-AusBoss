// Checks on a run, before it goes to ComfyUI and after it comes back.
//
// 1. A picture or video loader with nothing picked. Core Load Image takes a
//    blank name and only fails once the run starts, with "[Errno 21] Is a
//    directory". Many shared workflows save their loaders blank on purpose,
//    so a stranger who presses Run first gets that error. findEmptySources
//    finds such loaders in the prompt the frontend is about to send, so the
//    run can stop with one plain message instead.
// 2. One failure, filed once per input. ComfyUI repeats a failed
//    VALIDATE_INPUTS message on every input the check reads: a missing video
//    on Video Crop + Rotate + Pad comes back three times.
//    collapseRepeatedErrors keeps one per message on AusBoss nodes.
//
// No /scripts imports here, so node:test covers it (tests/run_check.test.mjs).

const blank = (value) => value === undefined || value === null || (typeof value === "string" && value.trim() === "");
// In a prompt, an input fed by another node holds [node id, output slot].
const linked = (value) => Array.isArray(value) && value.length === 2;
const emptyWidget = (inputs, name) => !linked(inputs?.[name]) && blank(inputs?.[name]);

const picture = (name) => (inputs) => (emptyWidget(inputs, name) ? { input: name, kind: "picture" } : null);
const video = (name) => (inputs) => (emptyWidget(inputs, name) ? { input: name, kind: "video" } : null);

function videoSource(inputs) {
  const mode = inputs?.source_mode;
  if (linked(mode)) return null;
  return mode === "local path" ? video("local_path")(inputs) : video("video")(inputs);
}

// The loaders a run needs a picked file for, by class type. Each rule gets
// the node's prompt inputs and returns the empty input, or null when the
// node has its source (a file, a path, or a link).
export const SOURCE_LOADERS = Object.freeze({
  LoadImage: picture("image"),
  LoadImageMask: picture("image"),
  LoadImageOutput: picture("image"),
  LoadVideo: video("file"),
  AUSBOSS_NODES_ImageCropRotatePad: picture("image"),
  // A wired source_image replaces the file, so the file may stay blank.
  AUSBOSS_NODES_LoadImagePad: (inputs) => (linked(inputs?.source_image) ? null : picture("image")(inputs)),
  AUSBOSS_NODES_LoadVideo: video("video"),
  AUSBOSS_NODES_VideoCropRotatePad: videoSource,
  AUSBOSS_NODES_VideoCropRotatePadClip: videoSource,
});

// The same rule on a live graph node, from its widgets: whether the full
// check is worth building a prompt for. A widget fed by a link counts as set.
export function nodeLacksSource(node) {
  const rule = SOURCE_LOADERS[String(node?.comfyClass ?? node?.type ?? "")];
  if (!rule) return false;
  const inputs = {};
  for (const widget of node.widgets ?? []) {
    if (widget?.name) inputs[widget.name] = widget.value;
  }
  (node.inputs ?? []).forEach((slot, index) => {
    const name = slot?.widget?.name ?? slot?.name;
    const connected = typeof node.isInputConnected === "function" ? node.isInputConnected(index) : slot?.link != null;
    if (name && connected) inputs[name] = ["link", 0];
  });
  return Boolean(rule(inputs));
}

function isLazy(definition, name) {
  const spec = definition?.input?.required?.[name] ?? definition?.input?.optional?.[name];
  return Boolean(Array.isArray(spec) && spec[1]?.lazy);
}

// The node ids a run executes, walked the way ComfyUI's server walks a
// prompt: from every output node (or only the chosen ones, for "Queue
// selected output nodes") back through everything they read. A lazy input
// may never be read, so the walk does not follow one; a loader behind it
// never blocks a run. definitionOf(classType) gives the node definition.
export function nodesThatRun(output, definitionOf, targets = null) {
  const prompt = output ?? {};
  const wanted = Array.isArray(targets) && targets.length ? new Set(targets.map(String)) : null;
  const pending = Object.keys(prompt).filter(
    (id) => definitionOf(prompt[id]?.class_type)?.output_node === true && (!wanted || wanted.has(id)),
  );
  const running = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (running.has(id)) continue;
    running.add(id);
    const entry = prompt[id];
    const definition = definitionOf(entry?.class_type);
    for (const [name, value] of Object.entries(entry?.inputs ?? {})) {
      if (!linked(value) || isLazy(definition, name)) continue;
      const source = String(value[0]);
      if (source in prompt && !running.has(source)) pending.push(source);
    }
  }
  return running;
}

// Loaders the run would execute with no picture or video picked, in prompt
// order: [{ id, title, input, kind }].
export function findEmptySources(output, definitionOf, targets = null) {
  const running = nodesThatRun(output, definitionOf, targets);
  const found = [];
  for (const [id, entry] of Object.entries(output ?? {})) {
    if (!running.has(id)) continue;
    const empty = SOURCE_LOADERS[entry?.class_type]?.(entry.inputs ?? {});
    if (empty) found.push({ id, title: String(entry?._meta?.title || entry.class_type), ...empty });
  }
  return found;
}

export function emptySourceMessage(found) {
  const [first] = found ?? [];
  if (!first) return "";
  const more = found.length - 1;
  const tail = more > 0 ? ` (and ${more} more node${more === 1 ? "" : "s"})` : "";
  return `Load a ${first.kind === "video" ? "video" : "picture"} first: ${first.title}${tail}`;
}

// "Save Image: exact_name may not ..." names the input it is about, after
// the node's own label; so does "... Local path mode ..." for local_path.
function namesInput(text, inputName) {
  if (!inputName) return false;
  const colon = text.indexOf(": ");
  const body = (colon >= 0 ? text.slice(colon + 2) : text).toLowerCase();
  const name = String(inputName).toLowerCase();
  return body.startsWith(name) || body.startsWith(name.replaceAll("_", " "));
}

// ComfyUI's details read "<input> - <message>" for a failed custom check.
function messageOf(error) {
  const details = String(error?.details ?? "");
  const prefix = `${error?.extra_info?.input_name ?? ""} - `;
  return details.startsWith(prefix) ? details.slice(prefix.length) : details;
}

// One entry per distinct failed check on each AusBoss node, kept on the
// input the message is about, else the first input ComfyUI listed. Other
// packs' nodes and other kinds of error are left exactly as they came.
export function collapseRepeatedErrors(nodeErrors) {
  for (const entry of Object.values(nodeErrors ?? {})) {
    if (!String(entry?.class_type ?? "").startsWith("AUSBOSS_NODES_") || !Array.isArray(entry.errors)) continue;
    const kept = [];
    const slotOf = new Map();
    for (const error of entry.errors) {
      if (error?.type !== "custom_validation_failed") {
        kept.push(error);
        continue;
      }
      const text = messageOf(error);
      if (!slotOf.has(text)) {
        slotOf.set(text, kept.length);
        kept.push(error);
        continue;
      }
      const slot = slotOf.get(text);
      const current = kept[slot]?.extra_info?.input_name;
      if (!namesInput(text, current) && namesInput(text, error?.extra_info?.input_name)) kept[slot] = error;
    }
    entry.errors = kept;
  }
  return nodeErrors;
}
