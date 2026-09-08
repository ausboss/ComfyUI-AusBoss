// Pure naming logic behind the Save Image card: what the path preview says
// before a run, which name tags apply, and how the card reads the node's
// widgets. Mirrors nodes/_image_save_helpers.py (name_stem, plan_local_names)
// so the preview and the file agree. No DOM, no app import: tests run it
// under node:test.

export const FORMAT_EXTENSIONS = { png: "png", "webp lossless": "webp", "jxl lossless": "jxl" };
export const FORMAT_LABELS = { png: "PNG", "webp lossless": "WebP", "jxl lossless": "JXL" };

export const TAGS = [
  { key: "name_counter", label: "Counter", token: "#####",
    title: "Append the next free five-digit number. On is collision-safe; turning it off reuses the same path and replaces an existing file." },
  { key: "name_date", label: "Date", token: "YYYY-MM-DD", title: "Append the local save date as YYYY-MM-DD." },
  { key: "name_time", label: "Time", token: "HH-mm-ss", title: "Append the local save time as HH-mm-ss." },
  { key: "name_size", label: "Size", token: "WxH", title: "Append the image dimensions as WIDTHxHEIGHT, such as 1024x1024." },
  { key: "name_batch", label: "Batch #", token: "b###",
    title: "For an image batch, append b001, b002... so each image's position in this run is visible. A single image is unchanged." },
];

const pad = (n, width) => String(n).padStart(width, "0");

export function localDate(now) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}

export function localTime(now) {
  return `${pad(now.getHours(), 2)}-${pad(now.getMinutes(), 2)}-${pad(now.getSeconds(), 2)}`;
}

// Strip one trailing image extension, as the backend does for exact names.
export function stripImageExtension(name) {
  return String(name ?? "").replace(/\.(avif|bmp|gif|jpe?g|jxl|png|tiff?|webp)$/i, "");
}

// Which naming mode the widgets describe.
//   linked - the filename input is connected: exact name from upstream
//   exact  - the legacy exact_name widget holds a name
//   local  - prefix plus tags
export function namingMode({ filenameLinked, exactName }) {
  if (filenameLinked) return "linked";
  if (String(exactName ?? "").trim()) return "exact";
  return "local";
}

// The filename the preview shows for the current widget values. `size`
// is {width, height} when an upstream image size is known, else the
// WxH placeholder stands in.
export function previewName(values, { now = new Date(), size = null } = {}) {
  const ext = FORMAT_EXTENSIONS[values.format] ?? "png";
  const mode = namingMode({ filenameLinked: values.filenameLinked, exactName: values.exact_name });
  if (mode === "linked") return `{{filename}}.${ext}`;
  if (mode === "exact") return `${stripImageExtension(String(values.exact_name).trim())}.${ext}`;
  const prefix = String(values.filename_prefix ?? "").trim().replace(/\\/g, "/");
  const base = prefix.split("/").filter((part) => part && part !== ".").pop() || "image";
  const parts = [base];
  if (values.name_date) parts.push(localDate(now));
  if (values.name_time) parts.push(localTime(now));
  if (values.name_size) parts.push(size ? `${size.width}x${size.height}` : "WxH");
  if (values.name_counter) parts.push("#####");
  if (values.name_batch) parts.push("b###");
  return `${parts.join("_")}.${ext}`;
}

// The folder line of the preview: the output folder plus any subfolders
// from the folder field and the prefix, or an absolute folder as typed.
export function previewFolder(values, outputLabel = "ComfyUI/output") {
  const folder = String(values.output_dir ?? "").trim().replace(/\\/g, "/");
  const prefix = String(values.filename_prefix ?? "").trim().replace(/\\/g, "/");
  const mode = namingMode({ filenameLinked: values.filenameLinked, exactName: values.exact_name });
  const prefixFolder = mode === "local" ? prefix.split("/").filter((part) => part && part !== ".").slice(0, -1).join("/") : "";
  const absolute = /^([A-Za-z]:[\\/]|\/|~)/.test(folder);
  const segments = absolute ? [folder.replace(/\/+$/, "")] : [outputLabel, folder.replace(/^\/+|\/+$/g, "")];
  if (prefixFolder) segments.push(prefixFolder);
  return segments.filter(Boolean).join("/") + "/";
}

// Tags only decorate a locally composed name.
export function tagsEnabled(values) {
  return namingMode({ filenameLinked: values.filenameLinked, exactName: values.exact_name }) === "local";
}
