// What H3 Prompt Writer's Full prompt tab decides, kept apart from the DOM so
// it can be tested. The node writes the prompt; the tab shows what it wrote
// after a run, and text typed there is sent in its place until Reset.

export const SIMPLE = "simple";
export const FULL = "full";
// Display choices kept on the node: the open tab, and the last prompt the
// node wrote (so a saved workflow opens the tab with it).
export const TAB_PROPERTY = "ausboss_prompt_tab";
export const WRITTEN_PROPERTY = "ausboss_written_prompt";

export function promptTab(node) {
  return node?.properties?.[TAB_PROPERTY] === FULL ? FULL : SIMPLE;
}

// The widget holds an edit only when there is one: empty text, or the
// written prompt typed back unchanged, means "send what the node writes".
export function editValue(text, written = "") {
  const typed = String(text ?? "");
  if (!typed.trim()) return "";
  if (written && typed.trim() === String(written).trim()) return "";
  return typed;
}

export function isEdited(values) {
  return String(values?.full_prompt ?? "").trim() !== "";
}

// What the box shows: the edit, else the last prompt the node wrote.
export function boxText(values, written = "") {
  return isEdited(values) ? String(values.full_prompt) : String(written ?? "");
}

// The prompt the node wrote on its last run, from the run's ui output.
export function writtenFromOutput(output) {
  const text = output?.written_prompt;
  if (Array.isArray(text)) return typeof text[0] === "string" ? text[0] : null;
  return typeof text === "string" ? text : null;
}
