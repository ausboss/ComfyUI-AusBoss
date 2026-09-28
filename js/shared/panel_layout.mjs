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

// The frontend pads a DOM widget's minWidth before it becomes the node's
// floor: LGraphNode.computeSize adds the room a number widget's value box
// takes (BaseWidget.minValueWidth plus both arrows and margins - 104px on
// frontend 1.53), and a corner drag never goes below computeSize. So a
// panel declaring 320 cannot be dragged under 424, and a node that opened
// at 340 jumps to 444 the moment its corner is touched. This measures that
// padding from the frontend itself instead of copying its constants: a
// probe minWidth goes in, and whatever computeSize adds on top comes out.
// null when it cannot be measured right now (the widget is hidden, or the
// node cannot size itself), so the caller tries again later.
const PROBE_WIDTH = 100000;
let probing = false;

export function measureLayoutWidthPadding(node, widget) {
  if (probing || typeof node?.computeSize !== "function" || !widget) return null;
  const own = widget.computeLayoutSize;
  probing = true;
  widget.computeLayoutSize = () => ({ minWidth: PROBE_WIDTH, minHeight: 0 });
  let width = NaN;
  try {
    width = Number(node.computeSize()?.[0]);
  } catch {
    // A node that cannot size itself right now is measured next time.
  } finally {
    widget.computeLayoutSize = own;
    probing = false;
  }
  return Number.isFinite(width) && width >= PROBE_WIDTH ? width - PROBE_WIDTH : null;
}

// The padding is the frontend's, the same for every node: measured once.
let layoutWidthPadding = null;

// distributeSpace reads a missing maxSize as Infinity, so declaring a floor
// with no ceiling means "take whatever is left" - which is exactly "fill the
// node". minWidth/minHeight accept a number or a function, for panels whose
// floor depends on state (the frame chooser is shorter until it has frames).
// exactMinWidth: true makes minWidth the node's real floor (see above);
// without it the frontend's padding comes on top, as it always has.
export function fillNodeHeight(widget, { minWidth = 0, minHeight = 0, minNodeSize, exactMinWidth = false } = {}) {
  if (!widget) return widget;
  const floor = (value) => {
    const resolved = Number(typeof value === "function" ? value() : value);
    return Number.isFinite(resolved) ? Math.max(0, resolved) : 0;
  };
  const padding = (node) => {
    if (!exactMinWidth) return 0;
    if (layoutWidthPadding === null) {
      layoutWidthPadding = measureLayoutWidthPadding(node ?? widget.node, widget);
    }
    return layoutWidthPadding ?? 0;
  };
  // Deleted, not overwritten: any own computeSize would win the else-if above.
  delete widget.computeSize;
  widget.computeLayoutSize = (node) => ({
    minWidth: Math.max(0, floor(minWidth) - padding(node)),
    minHeight: floor(minHeight),
  });
  widget.options ??= {};
  if (minNodeSize) widget.options.minNodeSize = minNodeSize;
  return widget;
}

// Nodes 2.0 (the Vue renderer) has no layout API for a node's minimum
// width: its corner drag stops at the node element's inline min-width, and
// at 225px when there is none. Lend it the panel's floor whenever the panel
// is laid out inside a Vue node. The classic renderer mounts panels outside
// any [data-node-id] element, so there this does nothing.
export function holdVueNodeMinWidth(panel, width) {
  const host = panel?.closest?.("[data-node-id]");
  const value = Number(width);
  if (!host?.style || !Number.isFinite(value) || value <= 0) return false;
  const css = `${Math.round(value)}px`;
  if (host.style.minWidth === css) return false;
  host.style.minWidth = css;
  return true;
}

// Grow a node to the height its widgets ask for. A workflow saved before a
// panel or card existed carries the node's old size, and the frontend keeps
// that size on load - the new panel is then squeezed under its floor and
// clipped flat. Returns true when the node was resized.
export function ensureNodeMinHeight(node) {
  const min = Number(node?.computeSize?.()?.[1]);
  const current = Number(node?.size?.[1]);
  if (!Number.isFinite(min) || !Number.isFinite(current) || current >= min) return false;
  node.setSize?.([node.size[0], min]);
  return true;
}
