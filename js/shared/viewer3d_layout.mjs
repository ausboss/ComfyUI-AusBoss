// Where things sit in ComfyUI's 3D viewers, measured from what is on
// screen. The viewer's menu bar (Scene, Show grid, Panorama ...) lies over
// the top of the view; the pack's 360 strip opens right under it, and the
// axis gizmo and the tools sit under that, in the top-right corner.
//
// Every number is in the viewer's own pixels, before the graph's zoom:
// the graph scales the viewer as a whole, so a screen distance is divided
// by that scale.

/** The graph's zoom on this element: screen pixels per own pixel. */
export function viewerScale(host) {
  const rect = host?.getBoundingClientRect?.();
  const own = host?.offsetHeight;
  return rect && own ? rect.height / own : 1;
}

function viewerRootOf(host) {
  let el = host;
  for (let i = 0; el && i < 12; i += 1, el = el.parentElement) {
    if (el.querySelector?.('[data-testid="load3d-category-menu"]')) return el;
  }
  return null;
}

/**
 * The bottom of the menu bar as it is drawn, measured from the top of
 * `host` (the element that holds the view). The bar's wrapper can be taller
 * than the bar itself, so this ends under the lowest button on the bar's
 * first line. null while the viewer is not on screen.
 */
export function menuBarBottom(host) {
  const root = viewerRootOf(host);
  const menu = root?.querySelector('[data-testid="load3d-category-menu"]');
  if (!menu) return 0;
  const hostRect = host.getBoundingClientRect();
  if (!hostRect.height) return null;
  const scale = viewerScale(host) || 1;
  // The bar: the smallest element holding both the Scene menu and Show grid.
  const grid = root.querySelector('i[class*="lucide--grid-3x3"]')?.closest("button");
  let row = menu;
  if (grid) while (row && !row.contains(grid)) row = row.parentElement;
  row ??= menu.parentElement ?? menu;
  const rowRect = row.getBoundingClientRect();
  let low = -Infinity;
  for (const button of row.querySelectorAll("button")) {
    const rect = button.getBoundingClientRect();
    // Only the bar's first line: an open dropdown hangs further down.
    if (rect.height && rect.top < rowRect.top + 48 * scale) low = Math.max(low, rect.bottom);
  }
  const bottom = Number.isFinite(low) ? Math.min(rowRect.bottom, low + 6 * scale) : rowRect.bottom;
  return Math.max(0, Math.round((bottom - hostRect.top) / scale));
}

/**
 * The viewer's own bottom buttons (fit, fullscreen, download): their
 * distance from the bottom of `host` and their height, so a bar can sit on
 * the same line. null when they are not found.
 */
export function bottomButtons(host) {
  const root = viewerRootOf(host);
  const icon = root?.querySelector('i[class*="lucide--download"]') ?? root?.querySelector('i[class*="lucide--scan"]');
  const group = icon?.closest("button")?.parentElement;
  if (!group) return null;
  const hostRect = host.getBoundingClientRect();
  const rect = group.getBoundingClientRect();
  if (!hostRect.height || !rect.height) return null;
  const scale = viewerScale(host) || 1;
  return { bottom: Math.max(0, Math.round((hostRect.bottom - rect.bottom) / scale)), height: Math.round(rect.height / scale) };
}
