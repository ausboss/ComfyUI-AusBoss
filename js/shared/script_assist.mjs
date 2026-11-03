// Help while typing in H3 Prompt Writer's script box:
// - a "?" beside "What happens" opens a card of everything the node reads in
//   the words (@1, 3s:, a blank line, quotes, sound:, music:, camera:, look:);
// - typing @ lists the pictures plugged in, with their job; the first letters
//   of a line offer sound:, music:, camera: and look:; a number offers a time;
//   after camera: or look: the node's own choices are listed.
// Suggestions only open on those, so they stay out of other packs' way.
// Picking one types it into the box the browser's way, so undo still works.
import { CHEAT_SHEET, suggestAt } from "./script_assist_math.mjs";

const CSS_ID = "ausboss-script-assist-css";

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-help-dot{margin-left:auto;pointer-events:auto;width:15px;height:15px;padding:0;border:1px solid #2f4a48;border-radius:50%;background:transparent;color:#6f8886;font:700 9.5px/13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0;text-align:center;cursor:help}
.ausboss-help-dot:hover,.ausboss-help-dot.open{border-color:#00b4aa;color:#a5f3ec}
.ausboss-assist-pop{position:fixed;z-index:10000;box-sizing:border-box;border:1px solid #2a3437;border-radius:8px;background:#0f1516;color:#d8ecea;box-shadow:0 8px 28px rgba(0,0,0,.55);font:500 12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.ausboss-assist-help{width:300px;padding:10px 12px}
.ausboss-assist-help h4{margin:0 0 6px;color:#a5f3ec;font-size:12px;font-weight:700}
.ausboss-assist-help dl{display:grid;grid-template-columns:auto 1fr;gap:5px 10px;margin:0}
.ausboss-assist-help dt{color:#f5b53d;font:600 11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}
.ausboss-assist-help dd{margin:0;color:#c3d6d4}
.ausboss-assist-help p{margin:8px 0 0;color:#6f8886;font-size:11px}
.ausboss-assist-list{min-width:170px;max-width:280px;padding:4px}
.ausboss-assist-item{display:flex;align-items:center;gap:7px;padding:4px 6px;border-radius:5px;cursor:pointer;white-space:nowrap}
.ausboss-assist-item.active{background:rgba(0,180,170,.22)}
.ausboss-assist-item img{flex:none;width:20px;height:20px;border-radius:4px;object-fit:cover}
.ausboss-assist-item b{color:#a5f3ec;font:700 11.5px ui-monospace,SFMono-Regular,Menlo,monospace}
.ausboss-assist-item em{overflow:hidden;color:#6f8886;font-style:normal;text-overflow:ellipsis}
.ausboss-assist-foot{padding:3px 6px 1px;color:#56706d;font-size:10px}
`;
  document.head.append(style);
}

const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

// Screen position of the caret: a hidden copy of the box with a marker where
// the caret is. The copy sits in the box's own place, so zoom is included.
function caretPoint(area, layer) {
  const copy = layer.cloneNode(false);
  copy.className = "ausboss-colours";
  copy.style.visibility = "hidden";
  copy.textContent = area.value.slice(0, area.selectionEnd);
  const mark = make("span", "", "​");
  copy.append(mark);
  area.parentElement.append(copy);
  copy.scrollTop = area.scrollTop;
  const box = mark.getBoundingClientRect();
  copy.remove();
  return { x: box.left, y: box.bottom };
}

// node: the H3 Prompt Writer; area: its script box; layer: the coloured copy
// under it; context(): { pictures, cameras, looks, seconds }.
export function attachScriptAssist(node, area, layer, context) {
  const none = { dispose: () => {} };
  if (!area?.parentElement) return none;
  ensureCss();

  // The "?" card.
  const row = area.closest(".ausboss-card-row");
  const header = row?.previousElementSibling?.classList?.contains("ausboss-card-section") ? row.previousElementSibling : null;
  let help = null;
  let dot = null;
  let closeHelpTimer = null;
  const closeHelp = () => { help?.remove(); help = null; dot?.classList.remove("open"); };
  const openHelp = () => {
    clearTimeout(closeHelpTimer);
    if (help) return;
    help = make("div", "ausboss-assist-pop ausboss-assist-help");
    help.append(make("h4", "", "What you can type"));
    const list = make("dl");
    for (const entry of CHEAT_SHEET) list.append(make("dt", "", entry.code), make("dd", "", entry.text));
    help.append(list, make("p", "", "Typing @ lists your pictures. Tab picks a suggestion, Esc closes it."));
    help.addEventListener("mouseenter", () => clearTimeout(closeHelpTimer));
    help.addEventListener("mouseleave", () => { closeHelpTimer = setTimeout(closeHelp, 250); });
    document.body.append(help);
    const box = dot.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - help.offsetWidth - 8, box.right - help.offsetWidth));
    const below = box.bottom + 6;
    help.style.left = `${left}px`;
    help.style.top = `${below + help.offsetHeight > window.innerHeight - 8 ? Math.max(8, box.top - help.offsetHeight - 6) : below}px`;
    dot.classList.add("open");
  };
  if (header) {
    dot = make("button", "ausboss-help-dot", "?");
    dot.type = "button";
    dot.title = "";
    dot.setAttribute("aria-label", "What you can type in the words");
    dot.addEventListener("mouseenter", openHelp);
    dot.addEventListener("mouseleave", () => { closeHelpTimer = setTimeout(closeHelp, 250); });
    dot.addEventListener("pointerdown", (event) => event.stopPropagation());
    dot.addEventListener("click", (event) => { event.stopPropagation(); if (help) closeHelp(); else openHelp(); });
    header.append(dot);
  }

  // Suggestions.
  let pop = null;
  let offer = null;
  let active = 0;
  const close = () => { pop?.remove(); pop = null; offer = null; };
  const take = (item) => {
    if (!offer) return;
    area.focus();
    area.setSelectionRange(offer.from, offer.to);
    // insertText keeps the browser's own undo.
    if (!document.execCommand?.("insertText", false, item.insert)) {
      area.setRangeText(item.insert, offer.from, offer.to, "end");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    }
    close();
  };
  const draw = () => {
    if (!pop || !offer) return;
    pop.textContent = "";
    offer.items.forEach((item, index) => {
      const line = make("div", `ausboss-assist-item${index === active ? " active" : ""}`);
      if (item.number && item.picture) { const img = make("img"); img.src = item.picture; line.append(img); }
      line.append(make("b", "", item.label));
      if (item.hint) line.append(make("em", "", item.hint));
      line.addEventListener("pointerdown", (event) => { event.preventDefault(); event.stopPropagation(); take(item); });
      pop.append(line);
    });
    pop.append(make("div", "ausboss-assist-foot", offer.strong ? "Enter or Tab to pick · Esc to close" : "Tab to pick · Esc to close"));
  };
  const update = () => {
    if (document.activeElement !== area || area.selectionStart !== area.selectionEnd) return close();
    const ctx = context();
    const next = suggestAt(area.value, area.selectionEnd, ctx);
    if (!next) return close();
    for (const item of next.items) if (item.number) item.picture = ctx.pictures.find((picture) => picture.number === item.number)?.url ?? "";
    const same = offer && offer.from === next.from && offer.items.map((item) => item.label).join() === next.items.map((item) => item.label).join();
    offer = next;
    if (!same) active = 0;
    if (!pop) { pop = make("div", "ausboss-assist-pop ausboss-assist-list"); document.body.append(pop); }
    draw();
    const point = caretPoint(area, layer);
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, point.x))}px`;
    pop.style.top = `${point.y + pop.offsetHeight + 4 > window.innerHeight ? point.y - pop.offsetHeight - 22 : point.y + 4}px`;
  };
  const onKey = (event) => {
    if (!offer) return;
    const count = offer.items.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      active = (active + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
      offer.strong = true; // Choosing with the arrows makes Enter pick too.
      draw();
    } else if (event.key === "Tab" || (event.key === "Enter" && offer.strong && !event.shiftKey)) {
      take(offer.items[active]);
    } else if (event.key === "Escape") {
      close();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const onBlur = () => setTimeout(() => { if (document.activeElement !== area) close(); }, 0);
  area.addEventListener("input", update);
  area.addEventListener("keydown", onKey, true);
  area.addEventListener("blur", onBlur);
  area.addEventListener("click", update);

  return {
    dispose() {
      close();
      closeHelp();
      dot?.remove();
      area.removeEventListener("input", update);
      area.removeEventListener("keydown", onKey, true);
      area.removeEventListener("blur", onBlur);
      area.removeEventListener("click", update);
    },
  };
}
