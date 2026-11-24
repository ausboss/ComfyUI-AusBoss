// AusBoss installed twice 🆎 — the browser half of nodes/_single_copy.py.
//
// Only a copy that steps aside serves this folder. Its nodes are not loaded,
// so this file must not import anything from the pack's js/ folder: it
// asks the server for the notice and shows it as a toast that stays until
// it is closed, because the console line alone is easy to miss and the
// nodes added since the old copy just show as missing.
import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";
import { showSecondCopyNotices } from "./notice.mjs";

app.registerExtension({
  name: "AusBoss.SecondCopy",
  async setup() {
    // Two copies that both step aside each serve this file; show the list once.
    if (globalThis.__ausbossSecondCopyShown) return;
    globalThis.__ausbossSecondCopyShown = true;
    try {
      const response = await api.fetchApi("/ausboss/second_copy");
      if (!response.ok) return;
      showSecondCopyNotices(await response.json(), app.extensionManager?.toast);
    } catch (_error) {
      // A warning must never break the page.
    }
  },
});
