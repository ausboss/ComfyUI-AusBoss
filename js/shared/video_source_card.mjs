export const INPUT_FOLDER_MODE = "input folder";
export const LOCAL_PATH_MODE = "local path";

export function normalizeVideoSourceMode(value) {
  return value === LOCAL_PATH_MODE ? LOCAL_PATH_MODE : INPUT_FOLDER_MODE;
}

export function normalizeVideoOptions(values, selected = "") {
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value ?? "");
    if (text && !result.includes(text)) result.push(text);
  }
  const current = String(selected ?? "");
  if (current && !result.includes(current)) result.push(current);
  return result;
}

// A whole path, as a workflow may hold from when this source was a box to
// type one in. The server no longer reads one, so it counts as nothing
// picked and the hint asks for the pick.
export function isWholePath(value) {
  return /^"?(?:[\\/~]|[A-Za-z]:)/.test(String(value ?? "").trim());
}

// What the Outputs list has picked: the saved value, or nothing for a whole path.
export function pickedOutput(localPath) {
  const text = String(localPath ?? "").trim();
  return isWholePath(text) ? "" : text;
}

export function videoSourceState(mode, video, localPath) {
  const normalizedMode = normalizeVideoSourceMode(mode);
  const local = normalizedMode === LOCAL_PATH_MODE;
  const selection = local ? pickedOutput(localPath) : String(video ?? "").trim();
  return {
    mode: normalizedMode,
    selection,
    key: selection ? `${local ? "local" : "input"}:${selection}` : "",
    hint: !local
      ? "Choose an uploaded video or add one to ComfyUI's input folder."
      : isWholePath(localPath)
        ? "Pick the video again. A typed path is no longer read."
        : "The videos in ComfyUI's output folder, newest first.",
  };
}

// Images use the same picker card, but their backend accepts input-folder
// references only. Do not advertise a Local path mode it cannot execute.
export function mediaSourceState(kind, mode, selection, localPath) {
  if (kind !== "image") return videoSourceState(mode, selection, localPath);
  const image = String(selection ?? "");
  return {
    mode: INPUT_FOLDER_MODE,
    selection: image,
    key: image,
    hint: "Choose an uploaded image or drop one onto this node.",
  };
}
