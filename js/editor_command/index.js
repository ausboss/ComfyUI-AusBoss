import { app } from "/scripts/app.js";
import { openTransformEditorForNode } from "../shared/transform_editor.mjs";

// Alt+E opens the transform editor of the selected Crop + Rotate + Pad node.
// Registered through ComfyUI's command + keybinding system (never a raw key
// listener) so it appears in Settings -> Keybindings and stays rebindable.

function selectedTransformNode() {
  const selected = Object.values(app.canvas?.selected_nodes ?? {});
  return selected.find((node) => node?.__ausbossTransformState) ?? null;
}

function notify(detail) {
  const toast = app.extensionManager?.toast;
  if (toast?.add) toast.add({ severity: "info", summary: "AusBoss", detail, life: 3000 });
  else console.log(`[AusBoss] ${detail}`);
}

app.registerExtension({
  name: "ausboss.editor.command",
  commands: [
    {
      id: "AusBoss.OpenEditor",
      label: "AusBoss: Open transform editor for the selected node",
      function: () => {
        const node = selectedTransformNode();
        if (!node) {
          notify("Select an AusBoss Crop + Rotate + Pad node first.");
          return;
        }
        openTransformEditorForNode(node);
      },
    },
  ],
  keybindings: [
    { combo: { key: "e", alt: true }, commandId: "AusBoss.OpenEditor" },
  ],
});
