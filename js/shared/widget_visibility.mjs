// Show/hide standard canvas widgets in place. Hiding keeps the widget (and
// its serialized value) in the widgets array — only its rendering collapses —
// so widgets_values order never changes and saved workflows stay compatible.
// Pure widget-object surgery, no DOM: testable under node:test.

const STASH = "__ausbossVisibilityStash";

// Collapse a widget to zero height. Returns true when this call changed
// visibility, false when it was already hidden (callers use the return to
// skip a needless node resize).
export function hideWidget(widget) {
  if (!widget || widget[STASH]) return false;
  widget[STASH] = {
    computeSize: widget.computeSize,
    computeLayoutSize: widget.computeLayoutSize,
    draw: widget.draw,
    hidden: widget.hidden,
  };
  widget.hidden = true;
  widget.computeSize = () => [0, -4];
  widget.computeLayoutSize = () => ({ minWidth: 0, minHeight: 0 });
  widget.draw = () => {};
  return true;
}

// Restore a widget hidden by hideWidget. Returns true when this call changed
// visibility, false when the widget was never hidden.
export function showWidget(widget) {
  const stash = widget?.[STASH];
  if (!stash) return false;
  widget.computeSize = stash.computeSize;
  widget.computeLayoutSize = stash.computeLayoutSize;
  widget.draw = stash.draw;
  widget.hidden = stash.hidden;
  widget[STASH] = undefined;
  return true;
}

// Drive a widget toward a target visibility; true when anything changed.
export function setWidgetVisible(widget, visible) {
  return visible ? showWidget(widget) : hideWidget(widget);
}
