// The pack's standard number control, Adobe-style: drag left/right on the
// value to scrub it, click to type an exact value, chevron arrows on the
// right step it, ArrowUp/Down step from the keyboard, and Shift always
// means the fine step. First shipped as the LoRA loader's strength box;
// this is that interaction made reusable, so every numeric field in the
// pack can behave the same way (AGENTS.md: scrubbing is the house norm).
//
// Pure gesture math up top (tested in tests/scrub_input.test.mjs); the DOM
// factory below wires it to a widget-backed value via callbacks:
//
//   const control = makeScrubInput({
//     value, min, max, step, fineStep, decimals,
//     onChange: (v) => ...,   // every committed change, any gesture
//     onSettle: () => ...,    // a gesture finished (scrub released, value
//   });                       // typed, arrow clicked) - the undo point
//   parent.append(control.root); control.set(next); control.get();

// Keep in sync with BRAND in shared/index.mjs - importing it would pull
// /scripts/app.js into node:test, and this module's math must stay testable.
const BRAND = "#00b4aa";

// Horizontal pixels of drag per step; small enough to feel light, large
// enough that a shaky click cannot change the value. The dead zone keeps a
// plain click a click (it opens type-in mode instead).
export const SCRUB_DEAD_ZONE = 3;
export const SCRUB_PIXELS_PER_STEP = 4;

export function isScrubGesture(deltaX, deltaY) {
  return Math.abs(deltaX) > SCRUB_DEAD_ZONE && Math.abs(deltaX) >= Math.abs(deltaY);
}

// Clamp into range and round to the control's precision - every value the
// control emits goes through here, so callers never see 0.30000000000000004.
export function quantizeScrubValue(value, { min = -Infinity, max = Infinity, decimals = 2 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return quantizeScrubValue(min === -Infinity ? 0 : min, { min, max, decimals });
  const clamped = Math.max(min, Math.min(max, number));
  const factor = 10 ** Math.max(0, decimals);
  return Math.round(clamped * factor) / factor;
}

// Value under the pointer during a scrub: steps of `step` (or `fineStep`
// with Shift) per SCRUB_PIXELS_PER_STEP of travel past the dead zone.
export function scrubbedValue(start, deltaX, fine, options = {}) {
  const { step = 1, fineStep = null } = options;
  if (Math.abs(deltaX) <= SCRUB_DEAD_ZONE) return quantizeScrubValue(start, options);
  const size = fine ? (fineStep ?? step) : step;
  const travel = deltaX - Math.sign(deltaX) * SCRUB_DEAD_ZONE;
  const steps = Math.round(travel / SCRUB_PIXELS_PER_STEP);
  return quantizeScrubValue(Number(start) + steps * size, options);
}

const CSS_ID = "ausboss-scrub-css";

function ensureScrubCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  // Child selectors on purpose: host panels (the transform editor sidebar,
  // for one) carry blanket `section input` rules, and these must outrank
  // them wherever the control is mounted.
  style.textContent = `
  .ausboss-scrub{display:flex;width:72px;height:24px;border:1px solid #3a4047;border-radius:5px;
    background:#23272c;overflow:hidden;flex:none;color:#d7dde2;font:12px system-ui}
  .ausboss-scrub:focus-within{border-color:${BRAND}}
  .ausboss-scrub>.ausboss-scrub-input{flex:1 1 auto;min-width:0;width:100%;height:100%;border:none;
    padding:0;margin:0;background:transparent;color:inherit;text-align:center;cursor:ew-resize;
    user-select:none;font:inherit;outline:none;border-radius:0}
  .ausboss-scrub>.ausboss-scrub-input:focus{cursor:text;user-select:text}
  .ausboss-scrub>.ausboss-scrub-step{flex:none;width:14px;display:flex;flex-direction:column;
    border-left:1px solid #3a4047}
  .ausboss-scrub>.ausboss-scrub-step>button{flex:1 1 0;min-height:0;border:none;background:transparent;
    color:#9ba2aa;cursor:pointer;padding:0;margin:0;display:grid;place-items:center;border-radius:0}
  .ausboss-scrub>.ausboss-scrub-step>button:hover{color:${BRAND};background:rgba(255,255,255,.05)}
  `;
  document.head.append(style);
}

// Stepper chevrons, hand-drawn so no glyph font is trusted to have them.
function chevronSvg(up) {
  const points = up ? "1.5,4 4.5,1 7.5,4" : "1.5,1 4.5,4 7.5,1";
  return `<svg width="9" height="5" viewBox="0 0 9 5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="${points}"/></svg>`;
}

export function makeScrubInput(options = {}) {
  ensureScrubCss();
  const opts = {
    value: 0, min: -Infinity, max: Infinity,
    step: 1, fineStep: null, decimals: 2,
    width: null, title: "", onChange: null, onSettle: null,
    ...options,
  };
  let current = quantizeScrubValue(opts.value, opts);

  const box = document.createElement("div");
  box.className = "ausboss-scrub";
  if (opts.width) box.style.width = `${opts.width}px`;
  const input = document.createElement("input");
  input.className = "ausboss-scrub-input";
  input.type = "text";
  input.inputMode = "decimal";
  input.readOnly = true;
  if (opts.title) input.title = `${opts.title} Drag to scrub, click to type, arrows to step; Shift = fine.`;

  const format = (value) => value.toFixed(Math.max(0, opts.decimals));
  input.value = format(current);

  const commit = (value) => {
    const next = quantizeScrubValue(value, opts);
    const changed = next !== current;
    current = next;
    input.value = format(current);
    if (changed) opts.onChange?.(current);
    return current;
  };
  const settle = () => opts.onSettle?.();

  // Scrub gesture: capture on the input, dead zone keeps clicks clicks.
  let drag = null;
  input.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !input.readOnly) return;
    drag = { x: event.clientX, y: event.clientY, start: current, scrubbed: false };
    input.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  input.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.scrubbed && isScrubGesture(dx, dy)) drag.scrubbed = true;
    if (drag.scrubbed) commit(scrubbedValue(drag.start, dx, event.shiftKey, opts));
  });
  const endDrag = (event) => {
    if (!drag) return;
    try { input.releasePointerCapture(event.pointerId); } catch { /* mouse fallback */ }
    const wasClick = !drag.scrubbed;
    const scrubbed = drag.scrubbed;
    drag = null;
    if (wasClick) {
      input.readOnly = false;
      input.focus();
      input.select();
      // The graph canvas grabs focus during the click sequence on some
      // frontends, which silently blurs the input before a keystroke can
      // land. One re-assertion after the click settles wins that race
      // without starting a focus war.
      requestAnimationFrame(() => {
        if (document.activeElement !== input) {
          input.readOnly = false;
          input.focus();
          input.select();
        }
      });
    } else if (scrubbed) {
      settle();
    }
  };
  input.addEventListener("pointerup", endDrag);
  input.addEventListener("pointercancel", endDrag);

  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") input.blur();
    else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const size = event.shiftKey ? (opts.fineStep ?? opts.step) : opts.step;
      commit(current + size * (event.key === "ArrowUp" ? 1 : -1));
      input.select();
      settle();
    }
  });
  // Typed values commit on blur/Enter; unparseable text falls back to the
  // last good value rather than guessing.
  input.addEventListener("blur", () => {
    if (!input.readOnly) {
      const number = Number(input.value);
      if (Number.isFinite(number) && commit(number) !== undefined) settle();
      input.readOnly = true;
    }
    input.value = format(current);
  });

  const steppers = document.createElement("div");
  steppers.className = "ausboss-scrub-step";
  for (const direction of [1, -1]) {
    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    button.title = `Step ${direction > 0 ? "up" : "down"}; Shift = fine.`;
    button.innerHTML = chevronSvg(direction > 0);
    button.addEventListener("click", (event) => {
      const size = event.shiftKey ? (opts.fineStep ?? opts.step) : opts.step;
      commit(current + size * direction);
      settle();
    });
    steppers.append(button);
  }

  box.append(input, steppers);
  return {
    root: box,
    input,
    get: () => current,
    set: (value) => {
      current = quantizeScrubValue(value, opts);
      if (input.readOnly) input.value = format(current);
    },
  };
}
