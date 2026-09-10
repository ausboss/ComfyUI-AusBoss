// Approving a folder on the ComfyUI computer (nodes/_folder_access_helpers.py).
//
// A workflow or an HTTP request never decides where on the disk the pack
// reads or writes: the person at the ComfyUI computer approves a folder by
// choosing it in the operating system's own dialog. These helpers ask the
// server to show that dialog and turn its answer into a path to store or a
// sentence for the node. No DOM and no ComfyUI imports - the api object is
// passed in - so tests/folder_access.test.mjs can drive them.

export const CHOOSE_ROUTE = "/ausboss/folders/choose";

// kind: "folder" (somewhere to save) or "video" (a local video file). The
// request carries nothing else: the dialog opens where the server decides.
export async function chooseOnServer(api, kind) {
  try {
    const response = await api.fetchApi(CHOOSE_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: kind === "video" ? "video" : "folder" }),
    });
    const body = await response.json().catch(() => ({}));
    return body && typeof body === "object" ? body : {};
  } catch (error) {
    return { ok: false, message: `Could not reach ComfyUI: ${error?.message ?? error}` };
  }
}

// { path, message }: the chosen path to store, and a sentence to show (the
// server's own when it sent one). A cancelled dialog says nothing.
export function choiceOutcome(result) {
  const answer = result && typeof result === "object" ? result : {};
  if (answer.ok && typeof answer.path === "string" && answer.path) return { path: answer.path, message: null };
  if (answer.cancelled) return { path: null, message: null };
  if (answer.busy) {
    return { path: null, message: "A folder dialog is already open on the ComfyUI computer. Finish it there first." };
  }
  if (typeof answer.message === "string" && answer.message) return { path: null, message: answer.message };
  return { path: null, message: "The folder dialog did not answer. Try again, or type the path." };
}
