// The row under the file picker on Load Image: arrows that step through the
// input folder, where the file is in the list ("14 / 212"), and the size the
// picture goes in at and comes out at ("912 × 1632 → 1144 × 2048"). The
// widgets underneath stay the source of truth: an arrow only changes the
// image widget's value, the way picking from the list does.
//
// Under it, the preview: the picture as it goes in with the part that is
// kept lit, and the picture as it comes out, both on one scale, with what
// the size choice does in words. While the choice cuts something, a click
// on the first picture picks the part to keep.
import { api } from "../../../scripts/api.js";
import { app } from "../../../scripts/app.js";
import { CROP_MODES, changeText, cropSideAt, keptPart, placeText, planLoadSize, shapeText, sizeText, stepFile, thumbSizes } from "./load_size.mjs";
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
.ausboss-load-view{display:flex;align-items:center;justify-content:center;gap:10px;height:100%;min-width:0;font:500 10px/1.25 ${FONT_UI};color:${T.faint}}
.ausboss-load-thumb{position:relative;flex:none;overflow:hidden;border-radius:2px;background-color:${T.fill};background-repeat:no-repeat}
.ausboss-load-thumb.in{background-size:100% 100%}
.ausboss-load-thumb.in.pick{cursor:pointer}
.ausboss-load-thumb.out{outline:1px solid ${T.brand};outline-offset:0}
.ausboss-load-kept{position:absolute;box-sizing:border-box;border:1px solid ${T.brand};box-shadow:0 0 0 400px rgba(8,10,11,.68);pointer-events:none}
.ausboss-load-note{flex:0 1 auto;min-width:0;display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center;user-select:none}
.ausboss-load-note b{color:${T.inkSoft};font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.ausboss-load-note span{white-space:nowrap}
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

// The widest and tallest a preview picture is drawn.
const THUMB_WIDTH = 76;
const THUMB_HEIGHT = 68;

export function loadImagePreview(node) {
  ensureCss();
  const root = document.createElement("div");
  root.className = "ausboss-load-view";
  const input = document.createElement("div");
  input.className = "ausboss-load-thumb in";
  const kept = document.createElement("div");
  kept.className = "ausboss-load-kept";
  input.append(kept);
  const note = document.createElement("div");
  note.className = "ausboss-load-note";
  const output = document.createElement("div");
  output.className = "ausboss-load-thumb out";
  root.append(input, note, output);
  let last = {};

  const side = () => node.widgets?.find((item) => item.name === "crop_from") ?? null;
  const sideLinked = () => node.inputs?.find((slot) => slot?.widget?.name === "crop_from")?.link != null;
  input.addEventListener("click", (event) => {
    const widget = side();
    if (!widget || !input.classList.contains("pick")) return;
    const box = input.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0)) return;
    const next = cropSideAt((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
    if (next === widget.value) return;
    commitWidgetValue(node, widget, next, app.canvas);
    node.setDirtyCanvas?.(true, true);
  });

  const line = (tag, text) => {
    const item = document.createElement(tag);
    item.textContent = text;
    return item;
  };
  const sync = (values = last) => {
    last = values;
    const file = String(values.image ?? "");
    const source = file ? readSize(file, () => { if (String(last.image ?? "") === file) sync(); }) : null;
    const plan = source ? planLoadSize(source.width, source.height, values) : null;
    root.style.visibility = plan ? "" : "hidden";
    if (!plan) return;
    const picture = `url(${JSON.stringify(viewUrl(file))})`;
    const sizes = thumbSizes(source.width, source.height, plan, THUMB_WIDTH, THUMB_HEIGHT);
    const part = keptPart(plan);
    Object.assign(input.style, { width: `${sizes.input[0]}px`, height: `${sizes.input[1]}px`, backgroundImage: picture });
    Object.assign(kept.style, {
      left: `${part.x * 100}%`, top: `${part.y * 100}%`,
      width: `${part.width * 100}%`, height: `${part.height * 100}%`,
    });
    const spareWide = plan.resizeWidth - plan.width;
    const spareHigh = plan.resizeHeight - plan.height;
    Object.assign(output.style, {
      width: `${sizes.output[0]}px`, height: `${sizes.output[1]}px`, backgroundImage: picture,
      backgroundSize: `${(plan.resizeWidth / plan.width) * 100}% ${(plan.resizeHeight / plan.height) * 100}%`,
      backgroundPosition: `${spareWide > 0 ? (plan.cropX / spareWide) * 100 : 0}% ${spareHigh > 0 ? (plan.cropY / spareHigh) * 100 : 0}%`,
    });
    const picks = CROP_MODES.includes(values.size) && !sideLinked();
    input.classList.toggle("pick", picks);
    input.title = picks
      ? "The picture going in. The lit part is kept. Click the part you want to keep."
      : "The picture going in. The lit part is kept.";
    output.title = "The picture coming out.";
    const from = shapeText(source.width, source.height);
    const to = shapeText(plan.width, plan.height);
    const change = changeText(source.width, source.height, plan);
    note.replaceChildren(
      line("b", from === to ? from : `${from} → ${to}`),
      ...(change ? change.split(" · ").map((text) => line("span", text)) : [line("span", "no change")]),
    );
  };
  return { element: root, sync };
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
