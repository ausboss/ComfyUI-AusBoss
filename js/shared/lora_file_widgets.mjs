// ComfyUI's missing-models list (the Issues panel, "Download all") only
// looks at list widgets: a model is listed when a list on some node holds a
// file name that is not one of its choices. LoRA Loader keeps its files in
// the rows' text, so a LoRA a workflow needs never made that list, and
// "Download all" then Run stopped on "missing LoRA file".
//
// The loader therefore carries one hidden list widget per row that needs a
// file. Nothing else reads them: they are kept out of the saved workflow and
// the prompt, have no socket, and are made again from the rows every time.
// The rows stay the one source of truth.

import { resolveLoraName } from "./lora_stack.mjs";

export const FILE_WIDGET_PREFIX = "ausboss_lora_file_";
export const FILE_WIDGET_FLAG = "ausbossLoraFile";

// Rows the server needs a file for when it runs: named, on, in a group that
// is on, and not at zero strength (nodes/_lora_helpers.py, missing_lora_rows).
export function rowsNeedingFiles(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const name = typeof row?.name === "string" ? row.name.trim() : "";
    if (!name || row.enabled === false || row.group_off === true) return false;
    const strength = Number(row.strength ?? 1);
    const clip = Number(row.strength_clip ?? strength);
    return !(strength === 0 && clip === 0);
  });
}

// The list ComfyUI checks a row's file against. A file the loader would
// find anyway (saved in another folder, or with other capitals) counts as
// installed; so does every file while the install's list is unknown, so a
// slow list never shows a false alarm.
export function fileChoices(name, installed) {
  if (!Array.isArray(installed)) return [name];
  return resolveLoraName(name, installed).status === "missing" ? installed : [...installed, name];
}

// The install's LoRA files as ComfyUI's own LoRA loader lists them. The node
// list arrives before any workflow opens, so this answers at once; null when
// there is no such node to ask.
export function coreLoraList(definition) {
  const spec = definition?.input?.required?.lora_name;
  if (!Array.isArray(spec)) return null;
  if (Array.isArray(spec[0])) return spec[0];
  if (spec[0] === "COMBO" && Array.isArray(spec[1]?.options)) return spec[1].options;
  return null;
}

export function isFileWidget(widget) {
  return Boolean(widget?.[FILE_WIDGET_FLAG]);
}

// Bring the node's file widgets in line with its rows. `installed()` returns
// the install's files (or null), `hide(widget)` folds a widget away, and
// `onPick(rowId, name)` runs when ComfyUI puts another file in a widget
// (choosing a replacement in the Issues panel). Returns true when a widget
// was added or removed.
export function syncFileWidgets(node, rows, { installed, hide, onPick }) {
  if (!node || !Array.isArray(node.widgets)) return false;
  const needed = rowsNeedingFiles(rows);
  const current = node.widgets.filter(isFileWidget);
  let changed = false;
  needed.forEach((row, index) => {
    let widget = current[index];
    if (!widget) {
      widget = node.addWidget("combo", `${FILE_WIDGET_PREFIX}${index + 1}`, row.name, (value) => {
        if (typeof value === "string" && value !== widget.ausbossRowName) onPick?.(widget.ausbossRowId, value);
      }, { values: () => fileChoices(widget.value, installed?.()), serialize: false });
      widget[FILE_WIDGET_FLAG] = true;
      widget.serialize = false;
      hide?.(widget);
      changed = true;
    }
    widget.value = row.name;
    widget.ausbossRowName = row.name;
    widget.ausbossRowId = row.id;
  });
  for (const widget of current.slice(needed.length)) {
    if (typeof node.removeWidget === "function") node.removeWidget(widget);
    else {
      const at = node.widgets.indexOf(widget);
      if (at >= 0) node.widgets.splice(at, 1);
    }
    changed = true;
  }
  return changed;
}
