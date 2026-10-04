// Notices when this tab is still running old AusBoss files after an update,
// refreshes them, and asks for a reload. A reload alone is not always enough:
// browsers may keep reusing the old shared modules (.mjs) for hours.
//
// Imports nothing from ../shared on purpose. Old cached copies of those files
// are the problem this entry has to survive.
import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";

const PACK_URL = new URL("../", import.meta.url).href;
const PARALLEL = 6;

async function runningVersion() {
  try {
    return (await import("../shared/index.mjs")).AUSBOSS_JS_VERSION;
  } catch (_error) {
    return null;
  }
}

// Fetching with cache "reload" replaces the browser's stored copy with a
// fresh one, so the next page load uses the new files.
async function refreshModules(paths) {
  const queue = [...paths];
  const worker = async () => {
    while (queue.length) {
      const path = queue.pop();
      try {
        await fetch(PACK_URL + path, { cache: "reload" });
      } catch (_error) {
        // One file failing to refresh must not stop the rest.
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
}

function askForReload(installed) {
  const detail =
    `AusBoss v${installed} is installed, but this page is still running an older copy. ` +
    "Press F5 to reload the page.";
  const toast = app.extensionManager?.toast;
  if (typeof toast?.add === "function") {
    toast.add({ severity: "warn", summary: "AusBoss was updated", detail, life: 30000 });
  } else {
    console.warn(`[AusBoss] ${detail}`);
  }
}

app.registerExtension({
  name: "ausboss.cache_guard",
  async setup() {
    // Advice, not a feature: any network or route failure stays silent.
    try {
      const installed = (await (await api.fetchApi("/ausboss/pack_version")).json())?.version;
      const running = await runningVersion();
      if (!installed || installed === "unknown" || !running || installed === running) return;
      const listing = await (await api.fetchApi("/ausboss/pack_modules")).json();
      await refreshModules(Array.isArray(listing?.modules) ? listing.modules : []);
      askForReload(installed);
    } catch (_error) {
      // Old backend without the routes, offline, or a non-JSON reply.
    }
  },
});
