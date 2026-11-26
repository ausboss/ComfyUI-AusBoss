// Check layout 🆎: what makes a workflow hard to read, worked out from plain
// numbers. No DOM and no ComfyUI imports, so node:test runs it
// (tests/layout_check_math.test.mjs); js/layout_check/ reads the canvas
// into this shape, shows the list and jumps to an entry. Nothing here moves
// anything.
//
// The graph, in canvas units:
//   nodes:  [{ id, title, x, y, w, h, grows, kind }]  x, y is the top left of
//           the body; the title bar sits above it, titleHeight tall. grows:
//           the node gets taller when it shows a run's picture or text.
//           kind: "note" for a Workflow Note, "callout" for a Callout.
//   groups: [{ id, title, x, y, w, h }]
//   links:  [{ id, from, to, points: [[x, y], ...] }]  the output socket, any
//           reroutes on the way, then the input socket.
//   scale:  the zoom the workflow is saved at (top level only).
//   noteFilled: for a top-level graph, whether a Workflow Note has a title
//           and instructions (null when there is no note).

export const TITLE_HEIGHT = 30;
// Below this saved zoom ComfyUI stops drawing widget text
// (scripts/workflow_contract.py holds the same number).
export const MIN_ZOOM = 0.6;
// How much taller a node that shows a picture can get after a run. A node
// starting closer than this under it can end up covered.
export const GROW_ROOM = 300;
// A wire runs backwards when it ends further left than the node it starts
// from, by more than this. A wire from a node down to the next one in its
// column ends at the same left edge, which reads fine.
export const BACKWARD_SLACK = 10;
// The order the list shows its kinds in: what hides something first.
export const KINDS = [
  "overlap",
  "group-overlap",
  "under-grower",
  "hidden-wire",
  "backward-wire",
  "outside-group",
  "no-groups",
  "zoom",
  "no-note",
];

const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

// [left, top, right, bottom] of a node with its title bar.
// A node drawn without a title bar (a Callout tile) gives its own
// `titleHeight` of 0.
export function nodeBox(node, titleHeight = TITLE_HEIGHT) {
  const x = finite(node?.x);
  const y = finite(node?.y);
  const top = Number.isFinite(node?.titleHeight) ? node.titleHeight : titleHeight;
  return [x, y - top, x + Math.max(0, finite(node?.w)), y + Math.max(0, finite(node?.h))];
}

export function groupBox(group) {
  const x = finite(group?.x);
  const y = finite(group?.y);
  return [x, y, x + Math.max(0, finite(group?.w)), y + Math.max(0, finite(group?.h))];
}

// Two boxes share more than `slack` units both ways.
export function boxesOverlap(a, b, slack = 1) {
  return Math.min(a[2], b[2]) > Math.max(a[0], b[0]) + slack && Math.min(a[3], b[3]) > Math.max(a[1], b[1]) + slack;
}

// `inner` sits wholly inside `outer`, give or take `slack`.
export function boxInside(inner, outer, slack = 1) {
  return inner[0] >= outer[0] - slack && inner[1] >= outer[1] - slack && inner[2] <= outer[2] + slack && inner[3] <= outer[3] + slack;
}

export function unionBox(boxes) {
  const list = boxes.filter(Boolean);
  if (!list.length) return null;
  return [
    Math.min(...list.map((box) => box[0])),
    Math.min(...list.map((box) => box[1])),
    Math.max(...list.map((box) => box[2])),
    Math.max(...list.map((box) => box[3])),
  ];
}

// Points along a wire, the way the canvas draws one: from each point to the
// next a curve that leaves to the right and arrives from the left, its
// handles a quarter of the distance long. `mode` "straight" or "linear"
// draws straight pieces instead.
export function wirePoints(points, mode = "spline", per = 24) {
  const list = (Array.isArray(points) ? points : []).filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [finite(p[0]), finite(p[1])]);
  if (list.length < 2) return list;
  const out = [list[0]];
  for (let i = 1; i < list.length; i++) {
    const [ax, ay] = list[i - 1];
    const [bx, by] = list[i];
    const reach = mode === "spline" ? Math.hypot(bx - ax, by - ay) * 0.25 : 0;
    const c1 = [ax + reach, ay];
    const c2 = [bx - reach, by];
    for (let s = 1; s <= per; s++) {
      const t = s / per;
      const u = 1 - t;
      out.push([
        u * u * u * ax + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * bx,
        u * u * u * ay + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * by,
      ]);
    }
  }
  return out;
}

const inBox = (point, box, inset = 2) => point[0] > box[0] + inset && point[0] < box[2] - inset && point[1] > box[1] + inset && point[1] < box[3] - inset;

// A Callout standing in a Workflow Note's own column belongs to the note,
// the way scripts/workflow_contract.py reads it.
function besideNote(node, notes) {
  if (node.kind !== "callout") return false;
  const left = finite(node.x);
  const right = left + finite(node.w);
  return notes.some((note) => note.x <= left && right <= note.x + note.w + 1);
}

export function checkLayout(graph, options = {}) {
  const titleHeight = finite(options.titleHeight, TITLE_HEIGHT);
  const growRoom = finite(options.growRoom, GROW_ROOM);
  const nodes = (graph?.nodes ?? []).filter((node) => node && node.id !== undefined && node.id !== null);
  const groups = graph?.groups ?? [];
  const links = graph?.links ?? [];
  const box = new Map(nodes.map((node) => [node.id, nodeBox(node, titleHeight)]));
  const issues = [];
  const add = (kind, fields) => issues.push({ kind, nodes: [], groups: [], ...fields });

  const overlapping = new Set();
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (!boxesOverlap(box.get(a.id), box.get(b.id))) continue;
      overlapping.add(`${a.id}|${b.id}`).add(`${b.id}|${a.id}`);
      add("overlap", { nodes: [a.id, b.id], focus: unionBox([box.get(a.id), box.get(b.id)]) });
    }
  }

  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groupBox(groups[i]);
      const b = groupBox(groups[j]);
      // A group wholly inside another is a nested group, which is fine.
      if (!boxesOverlap(a, b) || boxInside(a, b) || boxInside(b, a)) continue;
      add("group-overlap", { groups: [groups[i].id, groups[j].id], focus: unionBox([a, b]) });
    }
  }

  for (const grower of nodes.filter((node) => node.grows)) {
    const top = box.get(grower.id);
    for (const node of nodes) {
      if (node === grower || overlapping.has(`${grower.id}|${node.id}`)) continue;
      const below = box.get(node.id);
      const sideways = Math.min(top[2], below[2]) - Math.max(top[0], below[0]);
      const gap = below[1] - top[3];
      if (sideways > 1 && gap >= -1 && gap < growRoom) {
        add("under-grower", { nodes: [node.id, grower.id], gap: Math.max(0, Math.round(gap)), focus: unionBox([top, below]) });
      }
    }
  }

  // Two wires between the same two nodes (a model and a clip, say) are one
  // entry that counts them.
  const wireIssues = new Map();
  const addWire = (kind, key, fields) => {
    const seen = wireIssues.get(`${kind}|${key}`);
    if (seen) {
      seen.wires += 1;
      seen.links.push(fields.link);
      return;
    }
    const issue = { kind, nodes: [], groups: [], wires: 1, links: [fields.link], ...fields };
    wireIssues.set(`${kind}|${key}`, issue);
    issues.push(issue);
  };
  const mode = graph?.linkMode ?? "spline";
  for (const link of links) {
    const points = wirePoints(link.points, mode);
    if (points.length < 2) continue;
    const behind = nodes.filter((node) => node.id !== link.from && node.id !== link.to && points.some((p) => inBox(p, box.get(node.id))));
    if (behind.length) {
      addWire("hidden-wire", `${link.from}|${link.to}|${behind.map((node) => node.id).join(",")}`, {
        link: link.id,
        nodes: [link.from, link.to, ...behind.map((node) => node.id)],
        behind: behind.map((node) => node.id),
        focus: unionBox([...behind.map((node) => box.get(node.id)), unionBox(points.map((p) => [p[0], p[1], p[0], p[1]]))]),
      });
    }
    const corners = link.points.map((p) => [finite(p[0]), finite(p[1])]);
    const start = box.get(link.from)?.[0] ?? corners[0][0];
    if (corners.some((p, i) => i > 0 && p[0] < start - BACKWARD_SLACK)) {
      addWire("backward-wire", `${link.from}|${link.to}`, {
        link: link.id,
        nodes: [link.from, link.to],
        focus: unionBox([box.get(link.from), box.get(link.to)].concat(corners.map((p) => [p[0], p[1], p[0], p[1]]))),
      });
    }
  }

  const notes = nodes.filter((node) => node.kind === "note");
  if (nodes.length && !groups.length) {
    add("no-groups", { focus: unionBox([...box.values()]) });
  } else if (groups.length) {
    const boxes = groups.map(groupBox);
    for (const node of nodes) {
      if (node.kind === "note" || besideNote(node, notes)) continue;
      if (boxes.some((group) => boxInside(box.get(node.id), group))) continue;
      add("outside-group", { nodes: [node.id], focus: box.get(node.id) });
    }
  }

  const scale = Number(graph?.scale);
  if (Number.isFinite(scale) && scale < MIN_ZOOM) add("zoom", { scale: Math.round(scale * 100) / 100 });
  if (graph?.topLevel && nodes.length && !graph.noteFilled) {
    add("no-note", notes.length ? { nodes: [notes[0].id], focus: box.get(notes[0].id), empty: true } : {});
  }

  return issues.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
}

// The issues of a graph and every subgraph inside it, each marked with the
// path of box names that leads to it. `graphs` is [{ path: [...names],
// graph }], the top level first.
export function checkAll(graphs, options = {}) {
  const out = [];
  for (const { path = [], graph } of graphs ?? []) {
    for (const issue of checkLayout({ ...graph, topLevel: path.length === 0 && graph?.topLevel !== false }, options)) {
      out.push({ ...issue, path });
    }
  }
  return out;
}

// How many issues of each kind, in list order: [[kind, count], ...].
export function countByKind(issues) {
  const counts = new Map();
  for (const issue of issues ?? []) counts.set(issue.kind, (counts.get(issue.kind) ?? 0) + 1);
  return KINDS.filter((kind) => counts.has(kind)).map((kind) => [kind, counts.get(kind)]);
}

// The part of the canvas a jump frames its target in: everything left of the
// Check layout panel, so what it names never lands under it. `view` and
// `panel` are screen boxes ({ left, top, width, height }); the result is
// [x, y, width, height] in the canvas's own pixels, or null for the whole
// canvas (no panel, or too little room beside it).
export function jumpViewport(view, panel, margin = 16, least = 320) {
  if (!(view?.width > 0) || !(view?.height > 0) || !panel) return null;
  const room = Math.min(view.width, panel.left - view.left - margin);
  if (!(room >= least)) return null;
  return [0, 0, room, view.height];
}
