// Turns the server's second-copy notices into toasts. Kept apart from
// index.js so the tests can load it without ComfyUI.

export function showSecondCopyNotices(notices, toast) {
  const shown = [];
  for (const notice of Array.isArray(notices) ? notices : []) {
    if (!notice?.detail) continue;
    const message = {
      severity: notice.older ? "error" : "warn",
      summary: notice.summary || "AusBoss is installed twice",
      detail: notice.detail,
    };
    shown.push(message);
    try {
      if (typeof toast?.add === "function") {
        toast.add(message);
        continue;
      }
    } catch (_error) {
      // Toast store missing or incompatible: fall through to the console.
    }
    console.warn(`[AusBoss] ${message.summary}: ${message.detail}`);
  }
  return shown;
}
