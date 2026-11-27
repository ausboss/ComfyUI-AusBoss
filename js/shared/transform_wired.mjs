// What the Crop + Rotate + Pad nodes will really use for a setting that can
// be wired: a linked input runs with the wired value, not the widget's own.
// A wired value also skips the input's range (ComfyUI only range-checks typed
// values), so a Float of 24 wired into Megapixels resizes to 24 MP while the
// widget still holds 16.
//
// Only typed numbers are read across the wire (clip_rate.mjs inputNumber):
// a calculated value (Math Expression) stays unknown until the run, and the
// face says the value comes from a link instead of showing a wrong one.
//
// Pure: reads `inputs`, `widgets` and `graph`, so tests run it on plain
// objects.

import { inputNumber, linkOrigin } from "./clip_rate.mjs";

function widgetValue(node, name, fallback) {
  return node?.widgets?.find((item) => item.name === name)?.value ?? fallback;
}

export function inputLinked(node, name) {
  const slot = node?.inputs?.find((input) => input?.name === name || input?.widget?.name === name);
  return slot?.link !== null && slot?.link !== undefined;
}

// { value, linked, known } for a number setting. Unlinked: the widget's
// value. Linked to a typed number: that number. Linked to anything else:
// value null, known false.
export function wiredNumber(node, name, fallback) {
  const own = widgetValue(node, name, fallback);
  if (!inputLinked(node, name)) return { value: own, linked: false, known: true };
  const read = inputNumber(node, name, own);
  return read === null ? { value: null, linked: true, known: false } : { value: read, linked: true, known: true };
}

const SWITCHES = ["PrimitiveBoolean"];

// The same for an on/off setting.
export function wiredSwitch(node, name, fallback) {
  const own = Boolean(widgetValue(node, name, fallback));
  if (!inputLinked(node, name)) return { value: own, linked: false, known: true };
  const origin = linkOrigin(node, name);
  const unknown = { value: null, linked: true, known: false };
  if (!origin) return unknown;
  const { node: source, slot } = origin;
  let read;
  if ((source.comfyClass ?? source.type) === "PrimitiveNode") read = source.widgets?.[0]?.value;
  else if (SWITCHES.includes(source.type) && slot === 0
    && !source.inputs?.some((input) => input.name === "value" && input.link != null)) {
    read = source.widgets?.find((item) => item.name === "value")?.value;
  }
  return typeof read === "boolean" ? { value: read, linked: true, known: true } : unknown;
}

// The resize the run makes: null when it is off, { megapixels, steps } when
// every part is known, { unknown: true } when a link decides a part of it.
export function wiredResize(node) {
  if (!node?.widgets?.some((item) => item.name === "resize_to_megapixels")) return null;
  const on = wiredSwitch(node, "resize_to_megapixels", false);
  if (on.known && !on.value) return null;
  const megapixels = wiredNumber(node, "megapixels", 1);
  const steps = wiredNumber(node, "resolution_steps", 1);
  if (!on.known || !megapixels.known || !steps.known) return { unknown: true };
  return { megapixels: Number(megapixels.value) || 1, steps: Number(steps.value) || 1 };
}

// The end of the "Crop, pad & resize" summary: feather, Align, and the
// resize, each as the run will use it.
export function wiredSummaryParts(node) {
  const parts = [];
  const feather = wiredNumber(node, "feather", 0);
  if (!feather.known) parts.push("feather from a link");
  else if (Math.round(Number(feather.value) || 0) > 0) parts.push(`feather ${Math.round(Number(feather.value))} px`);
  const multiple = wiredNumber(node, "canvas_multiple", 1);
  const align = multiple.known ? Math.round(Number(multiple.value) || 1) : null;
  if (align === null) parts.push("align from a link");
  else if (align > 1) parts.push(`÷${align}`);
  if (!node?.widgets?.some((item) => item.name === "resize_to_megapixels")) return parts;
  const on = wiredSwitch(node, "resize_to_megapixels", false);
  if (on.known && !on.value) return parts;
  if (!on.known) parts.push("resize from a link");
  const megapixels = wiredNumber(node, "megapixels", 1);
  parts.push(megapixels.known ? `${(Number(megapixels.value) || 1).toFixed(2)} MP` : "MP from a link");
  const steps = wiredNumber(node, "resolution_steps", 1);
  if (!steps.known) parts.push("step from a link");
  else if (Math.round(Number(steps.value) || 1) > 1 && align !== null && align <= 1) parts.push(`÷${Math.round(Number(steps.value))}`);
  return parts;
}

// What a face field shows for a linked setting in place of its number box:
// the wired number, or that a link sets it.
export function wiredFieldText(reading, format) {
  if (!reading.linked) return null;
  return reading.known ? format(reading.value) : "from a link";
}
