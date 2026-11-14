// Notices when this tab is still running old AusBoss files after an update,
// refreshes them, and asks for a reload. A reload alone is not always enough:
// browsers may keep reusing the old shared modules (.mjs) for hours.
//
// Imports nothing from ../shared on purpose. Old cached copies of those files
// are the problem this entry has to survive.
import { api } from "../../../scripts/api.js";
import { app } from "../../../scripts/app.js";

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
    // No `life`: the message stays until it is closed. The page keeps running
    // the old files until it is reloaded, however long that takes.
    toast.add({ severity: "warn", summary: "AusBoss was updated", detail });
  } else {
    console.warn(`[AusBoss] ${detail}`);
  }
}

// "2.26.2" -> [2, 26, 2]. Anything else, such as "unknown", is null.
function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(typeof version === "string" ? version : "");
  return match ? match.slice(1).map(Number) : null;
}

// Only a server newer than the page means this tab runs old files. The page
// is newer when the Manager switched the pack on disk and the page was
// reloaded before ComfyUI restarted, and then a restart is what is needed.
// Two version numbers cannot tell that apart from a downgrade with the tab
// left open, which needs a reload, so in that case the guard says nothing.
function serverIsNewer(installed, running) {
  const server = parseVersion(installed);
  const page = parseVersion(running);
  if (!server || !page) return false;
  const step = server.findIndex((part, index) => part !== page[index]);
  return step >= 0 && server[step] > page[step];
}

// The installed version this page already asked a reload for. A server that
// drops and comes back several times must not stack the same message.
let asked = null;

async function check() {
  // Advice, not a feature: any network or route failure stays silent.
  try {
    const installed = (await (await api.fetchApi("/ausboss/pack_version")).json())?.version;
    const running = await runningVersion();
    if (!serverIsNewer(installed, running) || installed === asked) return;
    asked = installed;
    const listing = await (await api.fetchApi("/ausboss/pack_modules")).json();
    await refreshModules(Array.isArray(listing?.modules) ? listing.modules : []);
    askForReload(installed);
  } catch (_error) {
    // Old backend without the routes, offline, or a non-JSON reply.
  }
}

app.registerExtension({
  name: "ausboss.cache_guard",
  async setup() {
    await check();
    // An update from the Manager restarts the server and reloads the workflow,
    // not the page, so an open tab keeps the scripts it started with. Look
    // again every time the server comes back.
    api.addEventListener("reconnected", check);
  },
});
