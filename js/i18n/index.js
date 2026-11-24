// On a Chinese ComfyUI (Settings > Language), the pack's own node faces show
// Chinese. js/shared/i18n.mjs holds the rules, js/shared/i18n_zh.mjs the words.
// The language is read when the page loads, so a change in Settings shows
// after a reload.
import { app } from "../../../scripts/app.js";
import { chineseActive, followFaces, useLocaleSource } from "../shared/i18n.mjs";

app.registerExtension({
  name: "ausboss.i18n",
  async setup() {
    useLocaleSource(() => app.ui?.settings?.getSettingValue?.("Comfy.Locale"));
    if (chineseActive()) followFaces(document.body);
  },
});
