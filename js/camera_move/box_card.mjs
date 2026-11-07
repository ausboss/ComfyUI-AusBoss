// The settings brought up to a Camera Move box, as one compact card above
// the shot: what people change per clip on top (size, seed), the model files
// folded under "Models", since they are set once. A LoRA Loader's rows keep
// their own panel, with its strength bars; the camera keys are the shot.
//
// A box row shares its options with the setting inside the box, and Nodes 2.0
// reads "hidden" from there, so a row the card takes over is hidden inside the
// box too in that renderer (the classic canvas still shows it). Its value is
// set from the box either way.

import { mountWidgetCard } from "../shared/widget_card.mjs";
import { boxRowInputs } from "../shared/lora_box.mjs";
import { hideWidget } from "../shared/widget_visibility.mjs";

const STASH = "__ausbossVisibilityStash"; // widget_visibility.mjs: a row already hidden
const MODEL_FILE = /\.(safetensors|sft|ckpt|pt|pth|bin|gguf|onnx)$/i;
const SUFFIX = { megapixels: "MP" };
const ROW_TYPES = new Set(["number", "slider", "combo", "toggle", "text"]);
const isLoraLoader = (node) => node?.type === "AUSBOSS_NODES_LoraLoader" || node?.comfyClass === "AUSBOSS_NODES_LoraLoader";

const isModelRow = (widget) => {
  if (widget?.type !== "combo") return false;
  if (MODEL_FILE.test(String(widget.value ?? ""))) return true;
  const values = typeof widget.options?.values === "function" ? [] : widget.options?.values;
  return Array.isArray(values) && values.some((value) => MODEL_FILE.test(String(value)));
};

function labelOf(box, widget) {
  const input = (box.inputs ?? []).find((slot) => slot?.widget?.name === widget.name);
  const text = String(input?.label || widget.label || widget.name).replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// The rows a box's card shows: every setting brought up to it except `skip`
// (the camera keys), a LoRA Loader's rows and anything with its own panel.
export function boxCardRows(box, skip) {
  const loraRows = new Set(boxRowInputs(box, isLoraLoader).map((entry) => entry.name));
  const top = [], models = [];
  for (const widget of box.widgets ?? []) {
    if (!widget || widget === skip || widget.element || !ROW_TYPES.has(String(widget.type)) || loraRows.has(widget.name)) continue;
    if (widget[STASH] && !widget.__ausbossCameraCard) continue;
    const row = { widget: widget.name, label: labelOf(box, widget) };
    if (isModelRow(widget)) models.push({ ...row, kind: "select", group: "models" });
    else top.push(SUFFIX[innerName(box, widget)] ? { ...row, suffix: SUFFIX[innerName(box, widget)] } : row);
  }
  return models.length ? [...top, { group: "models", label: `Models · ${models.length} files` }, ...models] : top;
}

// The name of the setting inside the box that a box row stands for.
function innerName(box, widget) {
  const input = (box.subgraph?.inputs ?? []).find((slot) => slot?.name === widget.name);
  for (const id of input?.linkIds ?? []) {
    const link = box.subgraph.getLink?.(id) ?? box.subgraph.links?.get?.(id) ?? box.subgraph.links?.[id];
    const node = link && (box.subgraph.getNodeById?.(link.target_id));
    const name = node?.inputs?.[link.target_slot]?.widget?.name ?? node?.inputs?.[link.target_slot]?.name;
    if (name) return name;
  }
  return widget.name;
}

// The frontend now and then makes a box's rows afresh (a new object under
// the same name), so the card hides its rows again whenever it finds one
// showing. Cheap: a handful of names.
export function rehideBoxCard(box) {
  let changed = false;
  for (const name of box.__ausbossCameraCardRows ?? []) {
    const widget = (box.widgets ?? []).find((w) => w?.name === name);
    if (!widget || widget[STASH]) continue;
    hideWidget(widget);
    widget.__ausbossCameraCard = true;
    changed = true;
  }
  return changed;
}

// Mount the card once per box. Settings brought up later show as plain rows.
// `tidy` puts the box's panels back in order and says whether it moved one.
export function mountBoxCard(box, skip, tidy) {
  if (box.__ausbossCameraCard) { rehideBoxCard(box); return false; }
  const rows = boxCardRows(box, skip);
  if (!rows.length) return false;
  box.__ausbossCameraCardRows = rows.filter((row) => row.widget).map((row) => row.widget);
  rehideBoxCard(box);
  mountWidgetCard(box, { rows, minWidth: 300, first: true });
  box.__ausbossCameraCard = true;
  const draw = box.onDrawForeground;
  box.onDrawForeground = function (...args) {
    if (rehideBoxCard(this) | Boolean(tidy?.(this))) this.setDirtyCanvas?.(true, true);
    return draw?.apply(this, args);
  };
  return true;
}
