// How a DOM panel claims its share of a node's height. No DOM and no
// ComfyUI imports in here, so it stays testable under node:test.
//
// The frontend arranges a node's widgets in one pass
// (LGraphNode._arrangeWidgets):
//
//   if (w.computeSize)            -> fixed height, kept OUT of the split
//   else if (w.computeLayoutSize) -> joins distributeSpace(freeSpace, ...)
//   else                          -> one standard widget row
//
// It is an else-if, so a widget declaring BOTH is pinned by computeSize and
// its computeLayoutSize is never called. Every stage, player and filmstrip in
// this pack derived that fixed height from the node's WIDTH, which is why
// dragging a node taller only added dead space underneath: the panel had
// already been given a height and excluded from the leftover-space split.
//
// The frontend mounts a DOM widget's element inside a frame: DomWidgets.vue
// insets it by `options.margin` per side (default 10), so the element gets
// 20 fewer CSS pixels of height than the layout hands the widget. Any floor
// meant to guarantee room for fixed-height content must add this allowance,
// or the panel's bottom edge renders clipped flat - which is how the LoRA
// stack's rounded bottom border once went missing.
export const WIDGET_FRAME = 20;

// distributeSpace reads a missing maxSize as Infinity, so declaring a floor
// with no ceiling means "take whatever is left" - which is exactly "fill the
// node". minWidth/minHeight accept a number or a function, for panels whose
// floor depends on state (the frame chooser is shorter until it has frames).
export function fillNodeHeight(widget, { minWidth = 0, minHeight = 0, minNodeSize } = {}) {
  if (!widget) return widget;
  const floor = (value) => {
    const resolved = Number(typeof value === "function" ? value() : value);
    return Number.isFinite(resolved) ? Math.max(0, resolved) : 0;
  };
  // Deleted, not overwritten: any own computeSize would win the else-if above.
  delete widget.computeSize;
  widget.computeLayoutSize = () => ({ minWidth: floor(minWidth), minHeight: floor(minHeight) });
  widget.options ??= {};
  if (minNodeSize) widget.options.minNodeSize = minNodeSize;
  return widget;
}
