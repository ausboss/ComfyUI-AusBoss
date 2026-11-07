// A tile needs its renderer. Give saved tiles a real node identity so an old
// install reports a missing node instead of stretching a plain note over it.
export const CALLOUT_TYPES = new Set(["AUSBOSS_NODES_Callout", "AUSBOSS_NODES_CalloutTile"]);
export const NOTE_TYPES = new Set(["AUSBOSS_NODES_WorkflowNote", "AUSBOSS_NODES_WorkflowNoteTile"]);

export function serializeNoteIdentity(saved, tile) {
  const types = CALLOUT_TYPES.has(saved.type) ? [...CALLOUT_TYPES]
    : NOTE_TYPES.has(saved.type) ? [...NOTE_TYPES] : null;
  if (!types) return;
  saved.type = types[tile ? 1 : 0];
  // LiteGraph's serialized properties can still be the live object's properties.
  saved.properties = { ...saved.properties, "Node name for S&R": saved.type };
}
