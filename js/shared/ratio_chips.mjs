// A card row of shape chips for a width and height pair, borrowed from Latent
// Size: a button that turns the shape on its side, then one chip per ratio.
// A chip gives a size of about one megapixel in that shape (Latent Size's
// default), divisible by the snap step, so clicking around never drifts. The width and height widgets stay the source of
// truth: a chip only writes their values, and the card's W x H row shows them.
import { app } from "../../../scripts/app.js";
import { BRAND, notifyAusbossChange } from "./index.mjs";
import { applyRatioAtBudget, chipMatch, fitRectInBox, orientRatio, parseRail } from "./resolution_math.mjs";

// The rail as typed ("21:9", not the reduced "7:3"), for the chip labels.
const typedRail = (rail) => String(rail).split(",").map((token) => token.trim().match(/^(\d{1,3})\s*[:x]\s*(\d{1,3})$/i)).filter(Boolean).map((m) => [Number(m[1]), Number(m[2])]);
import { commitWidgetValue } from "./widget_card_math.mjs";

export const VIEWER_RAIL = "1:1, 4:3, 3:2, 16:9, 21:9";
const CSS_ID = "ausboss-ratio-chips-css";
// Which way a square size turns when a chip is clicked; kept on the node.
const PORTRAIT_PROPERTY = "ausboss_ratio_portrait";

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-ratio-row{display:flex;gap:5px;height:100%;min-width:0;align-items:stretch}
.ausboss-ratio-row button{display:flex;align-items:center;justify-content:center;gap:5px;min-width:0;padding:0 3px;box-sizing:border-box;border-radius:5px;cursor:pointer;font:500 10.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:#1e2020;border:1px solid #313434;color:#9aa0a0;white-space:nowrap;overflow:hidden;transition:border-color .12s,color .12s}
.ausboss-ratio-row button:hover:not(:disabled){border-color:${BRAND};color:${BRAND}}
.ausboss-ratio-row button:disabled{opacity:.4;cursor:default}
.ausboss-ratio-row .flip{flex:none;width:32px;color:#c8cccc}
.ausboss-ratio-row .chip{flex:1 1 0}
.ausboss-ratio-row .chip.near{border:1px dashed #3c6663;color:#9fc4c1}
.ausboss-ratio-row .chip.exact{background:rgba(0,180,170,.16);border:1px solid ${BRAND};color:#7fe9e2}
.ausboss-ratio-row .glyph{display:inline-block;flex:none;border:1.4px solid currentColor;border-radius:1.5px;opacity:.75}
.ausboss-ratio-row .flip .glyph{border-width:1.5px;border-radius:2px;opacity:1}
`;
  document.head.append(style);
}

const widgetOf = (node, name) => node.widgets?.find((widget) => widget.name === name) ?? null;
const linked = (node, name) => {
  const slot = node.inputs?.find((input) => input?.widget?.name === name || input?.name === name);
  return slot?.link !== null && slot?.link !== undefined;
};
const clampTo = (widget, value) => {
  const min = Number(widget?.options?.min ?? 1), max = Number(widget?.options?.max ?? 8192);
  return Math.min(max, Math.max(min, Math.round(value)));
};

// A card row: { panel: ratioChips(), height: 28 }.
export function ratioChips({ rail = VIEWER_RAIL, snap = 16, width = "width", height = "height" } = {}) {
  const ratios = parseRail(rail);
  const typed = typedRail(rail);
  return (node) => {
    ensureCss();
    const element = document.createElement("div");
    element.className = "ausboss-ratio-row";
    const flip = document.createElement("button");
    flip.type = "button";
    flip.className = "flip";
    const flipGlyph = document.createElement("span");
    flipGlyph.className = "glyph";
    flip.append(flipGlyph);
    element.append(flip);
    const chips = ratios.map((ratio, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      const glyph = document.createElement("span");
      glyph.className = "glyph";
      const label = document.createElement("span");
      button.append(glyph, label);
      element.append(button);
      const [a, b] = typed[index] ?? [ratio.x, ratio.y];
      return { ratio, button, glyph, label, long: Math.max(a, b), short: Math.min(a, b) };
    });

    const size = () => ({ w: Number(widgetOf(node, width)?.value) || 1, h: Number(widgetOf(node, height)?.value) || 1 });
    const portrait = () => {
      const { w, h } = size();
      return w === h ? Boolean(node.properties?.[PORTRAIT_PROPERTY]) : h > w;
    };
    const commit = (w, h) => {
      const wWidget = widgetOf(node, width), hWidget = widgetOf(node, height);
      if (!wWidget || !hWidget) return;
      // Height first, so the width's callback sees the new height: the 3D
      // viewer redraws its frame from each callback with the other value.
      commitWidgetValue(node, hWidget, clampTo(hWidget, h), app.canvas);
      commitWidgetValue(node, wWidget, clampTo(wWidget, w), app.canvas);
      node.setDirtyCanvas?.(true, true);
      notifyAusbossChange();
      // The card's W x H row shows the new numbers; its refresh syncs this row too.
      if (node.__ausbossCard?.refresh) node.__ausbossCard.refresh();
      else sync();
    };

    flip.addEventListener("click", () => {
      const { w, h } = size();
      if (w === h) {
        node.properties ??= {};
        node.properties[PORTRAIT_PROPERTY] = !portrait();
        sync();
      } else commit(h, w);
    });
    for (const { ratio, button } of chips) {
      button.addEventListener("click", () => {
        const next = applyRatioAtBudget(1024, 1024, ratio, snap, portrait());
        commit(next.width, next.height);
      });
    }

    const sync = () => {
      const { w, h } = size();
      const tall = portrait();
      const locked = linked(node, width) || linked(node, height);
      const turned = fitRectInBox(tall ? 3 : 4, tall ? 4 : 3, 14, 14);
      flipGlyph.style.width = `${turned.w.toFixed(1)}px`;
      flipGlyph.style.height = `${turned.h.toFixed(1)}px`;
      flip.disabled = locked;
      flip.title = locked ? "The size comes from a link." : `Turn the shape to ${tall ? "landscape" : "portrait"}.`;
      for (const { ratio, button, glyph, label, long, short } of chips) {
        const oriented = orientRatio(ratio, tall);
        const fitted = fitRectInBox(oriented.x, oriented.y, 14, 14);
        glyph.style.width = `${fitted.w.toFixed(1)}px`;
        glyph.style.height = `${fitted.h.toFixed(1)}px`;
        label.textContent = tall ? `${short}:${long}` : `${long}:${short}`;
        const match = chipMatch(w, h, oriented);
        const state = match && !match.flipped ? match.state : null;
        button.classList.toggle("exact", state === "exact");
        button.classList.toggle("near", state === "near");
        button.setAttribute("aria-pressed", String(state === "exact"));
        button.disabled = locked;
        button.title = locked ? "The size comes from a link." : `${label.textContent}: about one megapixel in this shape.`;
      }
    };
    return { element, sync };
  };
}
