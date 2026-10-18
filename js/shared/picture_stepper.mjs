// "‹ 2 / 5 ›": steps through the pictures of one run when a node got more
// than one (a list, or a batch it saved frame by frame). Image Compare A/B
// steps through its pairs with it, and the preview panel of Save Image and
// the other preview nodes through their results. It hides itself while
// there is one picture or none, so a single picture looks as it always did.
import { BRAND } from "./index.mjs";
import { stepperLabel } from "./picture_steps.mjs";

const CSS_ID = "ausboss-picture-stepper-v1";

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-stepper{box-sizing:border-box;flex:none;display:flex;align-items:stretch;height:var(--ausboss-stepper-height,24px);padding:1px;border:1px solid #2a3437;border-radius:6px;background:#0f1516;pointer-events:auto;user-select:none;}
.ausboss-stepper[hidden]{display:none;}
.ausboss-stepper button{box-sizing:border-box;width:20px;margin:0;padding:0;border:none;border-radius:4px;background:transparent;color:#8ba3a1;font:700 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;}
.ausboss-stepper button:hover{color:#fff;background:rgba(0,79,75,.78);}
.ausboss-stepper button:focus-visible{outline:1px solid ${BRAND};outline-offset:-1px;}
.ausboss-stepper span{min-width:34px;padding:0 3px;color:#d8eeee;font:700 10px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums;text-align:center;white-space:nowrap;align-self:center;}
`;
  document.head.appendChild(style);
}

// onStep(step) runs with -1 or +1 for a click on an arrow. `noun` names
// what is stepped through, for the arrows' tooltips ("pair", "picture").
export function makePictureStepper({ noun = "picture", height = 24, onStep, signal } = {}) {
  ensureCss();
  const root = document.createElement("div");
  root.className = "ausboss-stepper";
  root.style.setProperty("--ausboss-stepper-height", `${height}px`);
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", `Which ${noun} to show`);
  root.hidden = true;
  const label = document.createElement("span");
  const arrow = (text, step, title) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.title = title;
    button.setAttribute("aria-label", title);
    // A press here is a click on the arrow, not the start of a node drag.
    button.addEventListener("pointerdown", (event) => event.stopPropagation(), { signal });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onStep?.(step);
    }, { signal });
    return button;
  };
  root.append(arrow("‹", -1, `Previous ${noun}`), label, arrow("›", 1, `Next ${noun}`));
  return {
    root,
    set(index, count) {
      root.hidden = !(count > 1);
      label.textContent = stepperLabel(index, count);
    },
  };
}
