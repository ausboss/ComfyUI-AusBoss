// A switch with its choices side by side and a marker that slides to the
// chosen one: the mode row of Image Compare A/B, and its off | on choices.
// The choices share one width, so the marker only has to move. With `fit`
// each choice is as wide as its own name, and the marker is measured.
import { BRAND } from "./index.mjs";

const CSS_ID = "ausboss-slide-switch-v1";

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-slide{position:relative;box-sizing:border-box;flex:none;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;height:24px;padding:2px;border:1px solid #2a3437;border-radius:6px;background:#0f1516;}
.ausboss-slide.fit{grid-auto-columns:max-content;}
.ausboss-slide.fit button{padding:0 7px;}
.ausboss-slide-mark{position:absolute;top:2px;bottom:2px;left:2px;border-radius:4px;background:${BRAND};box-shadow:0 0 7px rgba(0,180,170,.3);transition:transform .16s ease,width .16s ease;pointer-events:none;}
.ausboss-slide.none .ausboss-slide-mark{display:none;}
.ausboss-slide button{position:relative;box-sizing:border-box;min-width:0;height:100%;margin:0;padding:0 9px;border:none;border-radius:4px;background:transparent;color:#8ba3a1;font:700 10px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.02em;white-space:nowrap;cursor:pointer;transition:color .16s ease;}
.ausboss-slide button:hover{color:#fff;}
.ausboss-slide button.on,.ausboss-slide button.on:hover{color:#04201d;}
.ausboss-slide.off-left button.on:first-of-type,.ausboss-slide.off-left button.on:first-of-type:hover{color:#d8eeee;}
.ausboss-slide.off-left.is-off .ausboss-slide-mark{background:#33423f;box-shadow:none;}
.ausboss-slide button:focus-visible{outline:1px solid ${BRAND};outline-offset:1px;}
@media (prefers-reduced-motion: reduce){.ausboss-slide-mark,.ausboss-slide button{transition:none;}}
`;
  document.head.appendChild(style);
}

// options: [{ value, label, title }]. `label` names the whole switch for
// screen readers. `offLeft` is for an off | on pair: while it is off the
// marker is grey, so "on" is the only teal state. onChange(value) runs for
// a click on a choice, also on the one that is already chosen.
export function makeSlideSwitch({ options, value, label = "", offLeft = false, fit = false, onChange, signal } = {}) {
  ensureCss();
  const root = document.createElement("div");
  root.className = `ausboss-slide${offLeft ? " off-left" : ""}${fit ? " fit" : ""}`;
  root.setAttribute("role", "radiogroup");
  if (label) root.setAttribute("aria-label", label);
  const mark = document.createElement("div");
  mark.className = "ausboss-slide-mark";
  if (!fit) mark.style.width = `calc((100% - 4px) / ${options.length})`;
  root.append(mark);
  const buttons = new Map();
  let current;
  // Choices of their own widths: the marker takes the chosen one's place
  // and size, read from the page.
  const measure = () => {
    const button = buttons.get(current);
    if (!fit || !button || !button.offsetWidth) return;
    mark.style.width = `${button.offsetWidth}px`;
    mark.style.transform = `translateX(${button.offsetLeft - 2}px)`;
  };
  const show = (next) => {
    current = next;
    const index = options.findIndex((option) => option.value === next);
    root.classList.toggle("none", index < 0);
    root.classList.toggle("is-off", index === 0);
    if (fit) measure();
    else mark.style.transform = `translateX(${Math.max(0, index) * 100}%)`;
    for (const [key, button] of buttons) {
      const on = key === next;
      button.classList.toggle("on", on);
      button.setAttribute("aria-checked", String(on));
    }
  };
  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "radio");
    button.textContent = option.label;
    if (option.title) button.title = option.title;
    // Stopped here so a press on the switch never starts a node drag.
    button.addEventListener("pointerdown", (event) => event.stopPropagation(), { signal });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onChange?.(option.value);
    }, { signal });
    buttons.set(option.value, button);
    root.append(button);
  }
  show(value);
  if (fit && typeof ResizeObserver !== "undefined") {
    // Nothing can be measured before the switch is on the page.
    const seen = new ResizeObserver(measure);
    seen.observe(root);
    signal?.addEventListener("abort", () => seen.disconnect());
  }
  return {
    root,
    get: () => current,
    // Move the marker. It does not call onChange: the caller decides what a
    // click means and then says where the switch stands.
    set: show,
    // A choice's words can follow the node's state (which picture is on top).
    describe(key, { label: text, title } = {}) {
      const button = buttons.get(key);
      if (!button) return;
      if (text !== undefined) button.textContent = text;
      if (title !== undefined) button.title = title;
    },
    disable(disabled) {
      for (const button of buttons.values()) button.disabled = Boolean(disabled);
    },
  };
}
