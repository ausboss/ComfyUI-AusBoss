// A click on the dark area around a modal <dialog> closes it, the way people
// expect any popup to work. The browser reports a click on a dialog's
// backdrop as a click on the dialog element itself, so a click counts as
// outside when it lands on the dialog element beyond its own box. Both the
// press and the release must be outside: a text selection or a drag that
// starts on the card and ends on the backdrop keeps the popup open.

export function pointOutside(rect, x, y) {
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
}

export function closeOnBackdropClick(dialog, close = () => dialog.close()) {
  const outside = (event) => event.target === dialog
    && pointOutside(dialog.getBoundingClientRect(), event.clientX, event.clientY);
  let pressedOutside = false;
  dialog.addEventListener("pointerdown", (event) => {
    pressedOutside = outside(event);
  });
  dialog.addEventListener("click", (event) => {
    const started = pressedOutside;
    pressedOutside = false;
    if (started && outside(event)) close();
  });
}
