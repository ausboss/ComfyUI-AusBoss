// Image Folder: what the gallery knows without a page. Which pictures are
// picked, what the count line says, which picture the next run loads, and
// the addresses the panel asks the server at.
//
// "picked" is null when every picture is picked (the widget then holds an
// empty text, and a picture added to the folder later is in too), or the
// list of picked names.

// The widget's text as a pick. Anything unreadable counts as "every picture":
// the node itself refuses a damaged list with a message when it runs.
export function parsePicked(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
    return [...new Set(value.map((item) => item.replaceAll("\\", "/")))];
  } catch {
    return null;
  }
}

// The picked names in the folder's order. Names that are no longer in the
// folder are left out.
export function pickedNames(picked, names) {
  if (picked === null) return [...names];
  const wanted = new Set(picked);
  return names.filter((name) => wanted.has(name));
}

export function isPicked(picked, name) {
  return picked === null || picked.includes(name);
}

// A pick with every name in it is "every picture" again.
function settle(list, names) {
  const kept = pickedNames(list, names);
  return kept.length === names.length && names.length > 0 ? null : kept;
}

export function togglePick(picked, names, name) {
  if (!names.includes(name)) return picked;
  const current = pickedNames(picked, names);
  const next = current.includes(name) ? current.filter((item) => item !== name) : [...current, name];
  return settle(next, names);
}

// Every picture from one name to another, picked or not (a Shift click).
export function pickRange(picked, names, from, to, on) {
  const a = names.indexOf(from);
  const b = names.indexOf(to);
  if (a < 0 || b < 0) return picked;
  const span = new Set(names.slice(Math.min(a, b), Math.max(a, b) + 1));
  const current = pickedNames(picked, names);
  const next = on ? [...new Set([...current, ...span])] : current.filter((name) => !span.has(name));
  return settle(next, names);
}

// What the widget holds: nothing for every picture, else the names in the
// folder's order.
export function serializePicked(picked, names) {
  if (picked === null) return "";
  return JSON.stringify(pickedNames(picked, names));
}

export function summary(picked, names) {
  const total = names.length;
  const count = pickedNames(picked, names).length;
  if (!total) return { count: 0, total: 0, text: "no pictures" };
  if (picked === null || count === total) return { count: total, total, text: `all ${total} picked` };
  if (!count) return { count: 0, total, text: `none of ${total} picked` };
  return { count, total, text: `${count} of ${total} picked` };
}

// A picture's number among the picked ones, from 1. 0 when it is not picked.
export function placeOf(picked, names, name) {
  return pickedNames(picked, names).indexOf(name) + 1;
}

// The picture the next "one per run" run loads, or null when Picture is past
// the last one and the node is set to stop there.
export function nameAt(picked, names, position, atTheEnd) {
  const list = pickedNames(picked, names);
  if (!list.length) return null;
  const place = Math.max(1, Math.round(Number(position) || 1));
  if (place <= list.length) return list[place - 1];
  return atTheEnd === "start over" ? list[(place - 1) % list.length] : null;
}

// Picture after a run is queued. "next" may reach one past the last picture,
// where the node stops the run; it never runs further than that. "random"
// jumps to any picked picture (`roll` is 0..1, for tests).
export function nextPosition(position, count, afterRun, roll = Math.random()) {
  const place = Math.max(1, Math.round(Number(position) || 1));
  if (count < 1) return place;
  if (afterRun === "random") return Math.min(count, Math.floor(roll * count) + 1);
  if (afterRun !== "next") return place;
  return Math.min(place + 1, count + 1);
}

// The count line above the tiles. With one per run it also says which
// picture is next, in a short form that fits a narrow node.
export function countLine(picked, names, { run, position, atTheEnd } = {}) {
  const line = summary(picked, names);
  if (run !== "one per run" || line.count < 1) return { text: line.text, warn: line.total > 0 && line.count === 0 };
  const place = Math.max(1, Math.round(Number(position) || 1));
  const head = line.count === line.total ? `all ${line.total}` : `${line.count} of ${line.total}`;
  if (place <= line.count) return { text: `${head} \u00b7 next ${place}`, warn: false };
  if (atTheEnd === "start over") return { text: `${head} \u00b7 next ${((place - 1) % line.count) + 1}`, warn: false };
  return { text: `${head} \u00b7 all done`, warn: true };
}

export function parentOf(folder) {
  const parts = String(folder ?? "").split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function childOf(folder, name) {
  return [...String(folder ?? "").split("/").filter(Boolean), name].join("/");
}

// A query string. Every value is typed by a person or saved in a workflow.
export function query(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

export function listAddress({ source, folder, subfolders, sort }) {
  return `/ausboss/image_folder/list?${query({ source, folder, subfolders: subfolders ? 1 : 0, sort })}`;
}

export function foldersAddress({ source, folder }) {
  return `/ausboss/image_folder/folders?${query({ source, folder })}`;
}

export function thumbAddress({ source, folder, name, v, size = 160 }) {
  return `/ausboss/image_folder/thumb?${query({ source, folder, name, size, v })}`;
}
