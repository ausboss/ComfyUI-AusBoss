// Clear VRAM 🆎 — a right-click entry on the empty canvas that unloads every
// model and frees memory on the ComfyUI server this page is connected to.
//
// It sends the same request as ComfyUI's own "Unload Models and Execution
// Cache" command (top menu, Edit): POST /free with unload_models and
// free_memory. That command is not on the right-click menu, so this entry
// puts it one click away. A setting hides the entry; a ComfyUI that turns
// manual unloading off (Comfy.Memory.AllowManualUnload) hides it too.
import { api } from "../../../scripts/api.js";
import { app } from "../../../scripts/app.js";
import { showToast } from "../shared/index.mjs";

const SETTING_ID = "AusBoss.Memory.ClearVramMenu";
const MENU_LABEL = "Clear VRAM 🆎";

function setting(id) {
  return app.ui?.settings?.getSettingValue?.(id);
}

async function clearVram() {
  try {
    const response = await api.fetchApi("/free", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    });
    if (!response.ok) throw new Error(`the server answered ${response.status}`);
    showToast({ severity: "success", summary: MENU_LABEL, detail: "Models unloaded and memory freed.", life: 3000 });
  } catch (error) {
    showToast({ severity: "error", summary: MENU_LABEL, detail: `Could not clear VRAM: ${error?.message ?? error}` });
  }
}

app.registerExtension({
  name: "ausboss.clear.vram",
  settings: [
    {
      id: SETTING_ID,
      name: "Clear VRAM on the right-click menu",
      type: "boolean",
      defaultValue: true,
      category: ["🆎 AusBoss", "Memory", "Clear VRAM menu"],
      tooltip:
        "Right-click the empty canvas for Clear VRAM: it unloads every model and frees "
        + "memory on the ComfyUI server. Off hides the entry.",
    },
  ],
  getCanvasMenuItems() {
    if (setting(SETTING_ID) === false) return [];
    if (setting("Comfy.Memory.AllowManualUnload") === false) return [];
    return [{ content: MENU_LABEL, callback: clearVram }];
  },
});
