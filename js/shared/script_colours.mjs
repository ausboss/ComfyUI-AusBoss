// Colours in H3 Prompt Writer's script box: the words the node reads as
// instructions stand out while you type. @1 is a picture, 3s: is a time, a
// blank line is a cut, sound: and music: lines go to their own part, and
// words in quotes are spoken.
//
// The real textarea stays on top with see-through text, so typing, undo,
// copy and the caret are the browser's own. A copy of the text sits under it
// with the colours. Only colours and backgrounds change, never the font or
// the spacing, so both lay out the same lines.
import { scriptMarkup } from "./script_colours_math.mjs";

const CSS_ID = "ausboss-script-colours-css";

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-colours-host{position:relative}
.ausboss-colours-host>:not(.ausboss-colours):not(textarea){display:none !important}
.ausboss-colours{position:absolute;inset:0;box-sizing:border-box;margin:0;overflow:hidden;white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;pointer-events:none;color:#d8ecea;border:1px solid transparent;border-radius:6px;background:#0b0f10}
.ausboss-colours-host>textarea.ausboss-colours-on{position:relative;background:transparent !important;color:transparent !important;caret-color:#d8ecea;-webkit-text-fill-color:transparent}
.ausboss-colours-host>textarea.ausboss-colours-on::placeholder{color:#4f6462;-webkit-text-fill-color:#4f6462}
.ausboss-colours-host>textarea.ausboss-colours-on::selection{background:rgba(0,180,170,.35)}
.ausboss-colours .at{border-radius:3px;background:rgba(0,180,170,.3);box-shadow:0 0 0 1px rgba(0,180,170,.45);color:#a5f3ec}
.ausboss-colours .at.unknown{background:rgba(245,181,61,.18);box-shadow:0 0 0 1px rgba(245,181,61,.5);color:#f5c76b}
.ausboss-colours .time{color:#f5b53d}
.ausboss-colours .key{color:#6f8886}
.ausboss-colours .say{color:#f0dcae}
.ausboss-colours .cut{display:inline-block;width:100%;background:linear-gradient(transparent calc(50% - 1px),#2f4a48 calc(50% - 1px),#2f4a48 50%,transparent 50%);position:relative}
.ausboss-colours .cut::after{content:"cut";position:absolute;right:0;top:0;padding-left:4px;background:#0b0f10;color:#56706d;font-size:9px;letter-spacing:.1em;text-transform:uppercase}
`;
  document.head.append(style);
}

// The box's own text settings, copied so the coloured copy wraps the same.
const COPIED = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "wordSpacing", "tabSize", "textIndent", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"];

export function attachScriptColours(node) {
  const none = { sync: () => {}, dispose: () => {} };
  const area = node.__ausbossCard?.root?.querySelector?.("textarea.ausboss-card-area");
  if (!area?.parentElement) return none;
  ensureCss();
  const host = area.parentElement;
  const layer = document.createElement("div");
  layer.className = "ausboss-colours";
  layer.setAttribute("aria-hidden", "true");
  host.classList.add("ausboss-colours-host");
  host.insertBefore(layer, area);
  area.classList.add("ausboss-colours-on");
  // Another pack that colours every text box puts its own copy beside the
  // box; the rule above hides it, so the text never shows twice.
  area.dataset.ausbossColoured = "true";

  let wiredNumbers = new Set([1, 2, 3, 4]);
  const draw = () => {
    const style = getComputedStyle(area);
    for (const key of COPIED) layer.style[key] = style[key];
    // A scroll bar takes width from the text; the copy gives up the same.
    const bar = area.offsetWidth - area.clientWidth - (parseFloat(style.borderLeftWidth) || 0) - (parseFloat(style.borderRightWidth) || 0);
    layer.style.paddingRight = `${(parseFloat(style.paddingRight) || 0) + Math.max(0, bar)}px`;
    layer.innerHTML = scriptMarkup(area.value, (number) => wiredNumbers.has(number));
    layer.scrollTop = area.scrollTop;
  };
  const onScroll = () => { layer.scrollTop = area.scrollTop; };
  area.addEventListener("input", draw);
  area.addEventListener("scroll", onScroll);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(draw) : null;
  observer?.observe(area);
  queueMicrotask(draw);
  return {
    area,
    layer,
    // values: the node's widget values; numbers: the pictures plugged in.
    sync(values, numbers) {
      if (numbers) wiredNumbers = new Set(numbers);
      if (document.activeElement !== area && typeof values?.script === "string" && area.value !== values.script) area.value = values.script;
      draw();
    },
    dispose() {
      observer?.disconnect();
      area.removeEventListener("input", draw);
      area.removeEventListener("scroll", onScroll);
    },
  };
}
