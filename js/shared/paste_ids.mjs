// What a paste did to ids. Copy and paste give every pasted node and group a
// new id, and so do duplicate, Alt + drag and dropping a saved workflow on the
// canvas: the frontend sends all of them through
// LGraphCanvas._deserializeItems. A node that remembers other nodes by id
// (Workflow Switches, a Callout's links) would keep naming the old ones.
// Pasted on their own, its copies point at nothing; pasted into another
// workflow, they can point at an unrelated node that has the old number.
//
// The paste returns which new node each old id became. onPaste hands that
// on, so a pasted node can follow the copies of what it points at. A frontend
// without the method pastes as before and no handler runs.
//
// No app import, so tests/paste_ids.test.mjs runs it under node:test.

const handlers = new Set();
let installed = false;

// Old id (as text) -> the copy's id, for the nodes and the groups of one
// paste. The frontend adds the groups it is handed one by one, in order, so
// the groups it made are matched to the old ids by position; when the counts
// differ, no group is matched rather than a wrong one.
export function pastedIds(result, groupIds = [], isGroup = () => false) {
  const nodes = new Map();
  for (const [id, node] of result?.nodes ?? []) {
    if (node?.id !== undefined && node.id !== null) nodes.set(String(id), node.id);
  }
  const created = [...(result?.created ?? [])];
  const groups = new Map();
  const made = created.filter(isGroup);
  if (made.length === groupIds.length) {
    groupIds.forEach((id, index) => {
      if (id !== undefined && id !== null && made[index]?.id !== undefined) groups.set(String(id), made[index].id);
    });
  }
  return { nodes, groups, created };
}

// Runs `handler({ nodes, groups, created })` after every paste.
export function onPaste(handler) {
  if (typeof handler === "function") handlers.add(handler);
  install();
}

function install() {
  if (installed) return;
  const lite = globalThis.LiteGraph;
  const proto = lite?.LGraphCanvas?.prototype;
  const original = proto?._deserializeItems;
  if (typeof original !== "function") return;
  installed = true;
  const isGroup = (item) => Boolean(lite.LGraphGroup && item instanceof lite.LGraphGroup);
  // A method whose result is needed, not a callback: chainCallback would drop
  // the result, so wrap it and always hand the frontend's own result back.
  function deserializeItemsWithIds(items, ...rest) {
    // Read before the paste, which gives the groups it is handed new ids.
    const groupIds = Array.isArray(items?.groups) ? items.groups.map((group) => group?.id) : [];
    const result = original.call(this, items, ...rest);
    if (!result || !handlers.size) return result;
    const ids = pastedIds(result, groupIds, isGroup);
    for (const handler of handlers) {
      try {
        handler(ids);
      } catch (error) {
        console.warn("[AusBoss] after a paste:", error);
      }
    }
    return result;
  }
  proto._deserializeItems = deserializeItemsWithIds;
}
