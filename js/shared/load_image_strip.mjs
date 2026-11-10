// The row under the file picker on Load Image: arrows that step through the
// input folder, where the file is in the list ("14 / 212"), and the size the
// picture goes in at and comes out at ("912 × 1632 → 1144 × 2048"). The
// widgets underneath stay the source of truth: an arrow only changes the
// image widget's value, the way picking from the list does.
import { api } from "../../../scripts/api.js";
import { app } from "../../../scripts/app.js";
import { placeText, planLoadSize, sizeText, stepFile } from "./load_size.mjs";
import { mediaViewQuery } from "./media_list.mjs";
import { FONT_UI, RADIUS_CONTROL, THEME as T } from "./theme.mjs";
import { commitWidgetValue, comboValues } from "./widget_card_math.mjs";

const CSS_ID = "ausboss-load-strip-css";
// Sizes already read, by file: stepping back to a picture shows its size at once.
const SIZES_KEPT = 200;
const sizes = new Map();

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-load-strip{display:flex;align-items:center;gap:6px;height:100%;min-width:0;font:500 11px/1 ${FONT_UI};color:${T.label}}
.ausboss-load-step{flex:none;width:26px;height:100%;padding:0;border:1px solid transparent;border-radius:${RADIUS_CONTROL}px;background:${T.fill};color:${T.inkSoft};font:600 11px/1 ${FONT_UI};cursor:pointer}
.ausboss-load-step:hover{background:${T.fillHover};color:${T.inkHover}}
.ausboss-load-step:focus-visible{outline:2px solid ${T.brand};outline-offset:1px}
.ausboss-load-step:disabled{opacity:.4;cursor:default}
.ausboss-load-place{flex:none;color:${T.faint};font-variant-numeric:tabular-nums;white-space:nowrap;user-select:none}
.ausboss-load-size{flex:1 1 0;min-width:0;overflow:hidden;text-align:right;white-space:nowrap;text-overflow:ellipsis;color:${T.inkSoft};font-weight:600;font-variant-numeric:tabular-nums}
.ausboss-load-size b{color:${T.brandInk};font-weight:700}
.ausboss-load-size i{color:${T.faint};font-style:normal;margin:0 5px}
`;
  document.head.append(style);
}

const viewUrl = (value) => api.apiURL(`/view?${mediaViewQuery(value)}`);

// The picture's own size, read from the file the way the browser shows it.
function readSize(file, done) {
  const known = sizes.get(file);
  if (known) return known;
  const picture = new Image();
  picture.onload = () => {
    if (sizes.size >= SIZES_KEPT) sizes.delete(sizes.keys().next().value);
    sizes.set(file, { width: picture.naturalWidth, height: picture.naturalHeight });
    done();
  };
  picture.src = viewUrl(file);
  return null;
}

export function loadImageStrip(node) {
  ensureCss();
  const root = document.createElement("div");
  root.className = "ausboss-load-strip";
  const widget = () => node.widgets?.find((item) => item.name === "image") ?? null;
  const linked = () => {
    const slot = node.inputs?.find((input) => input?.widget?.name === "image" || input?.name === "image");
    return slot?.link != null;
  };
  let last = {};

  const step = (delta, label, title) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ausboss-load-step";
    button.textContent = label;
    button.title = title;
    button.addEventListener("click", () => {
      const image = widget();
      if (!image) return;
      const next = stepFile(comboValues(image), image.value, delta);
      if (next === null || next === image.value) return;
      commitWidgetValue(node, image, next, app.canvas);
      node.setDirtyCanvas?.(true, true);
    });
    root.append(button);
    return button;
  };
  const back = step(-1, "◀", "The picture before this one in the input folder");
  const on = step(1, "▶", "The next picture in the input folder");
  const place = document.createElement("span");
  place.className = "ausboss-load-place";
  place.title = "Where this picture is in the input folder's list";
  const size = document.createElement("span");
  size.className = "ausboss-load-size";
  root.append(place, size);

  const sync = (values = last) => {
    last = values;
    const image = widget();
    const files = comboValues(image);
    const file = String(values.image ?? "");
    place.textContent = placeText(files, file);
    const stuck = linked() || stepFile(files, file, 1) === null;
    back.disabled = stuck;
    on.disabled = stuck;
    const source = file ? readSize(file, () => { if (String(last.image ?? "") === file) sync(); }) : null;
    size.replaceChildren();
    if (!source) {
      size.title = "";
      return;
    }
    const plan = planLoadSize(source.width, source.height, values);
    const text = sizeText(source.width, source.height, plan);
    const [from, to] = text.split(" → ");
    size.append(from);
    if (to) {
      const arrow = document.createElement("i");
      arrow.textContent = "→";
      const out = document.createElement("b");
      out.textContent = to;
      size.append(arrow, out);
    }
    size.title = to
      ? `The file is ${from}. The picture comes out at ${to}.`
      : `The picture comes out at its own size, ${from}.`;
  };
  return { element: root, sync };
}
