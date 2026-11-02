// The timeline on H3 Prompt Writer: one row for each moment in the script, with
// its second, its words and a bar where it sits in the clip. The server reads
// the script with the same code a run uses, so the rows show what will happen.
import { api } from "/scripts/api.js";
import { BRAND, chainCallback } from "./index.mjs";
import { stripCaption, stripRows, wiredJobs } from "./moment_strip_math.mjs";

const CSS_ID = "ausboss-moment-strip-css";
const WAIT = 200; // Lets someone finish a word before asking.
const WATCH = 1000; // A Workflow Switches card turns a picture off without touching this node.

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-strip{display:flex;flex-direction:column;gap:3px;height:100%;min-width:0}
.ausboss-strip-rows{display:flex;flex-direction:column;gap:2px;flex:1 1 0;min-height:0;min-width:0;overflow-y:auto;padding:3px;box-sizing:border-box;border-radius:4px;background:#0b0f10}
.ausboss-strip-row{--bar:rgba(0,180,170,.26);flex:none;display:flex;align-items:center;gap:6px;height:18px;padding:0 5px;box-sizing:border-box;min-width:0;overflow:hidden;border-radius:3px;background:linear-gradient(to right,transparent var(--from),var(--bar) var(--from),var(--bar) var(--to),transparent var(--to));color:#cfe8e5;font:500 11px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;user-select:none}
.ausboss-strip-row.cut{box-shadow:inset 2px 0 0 ${BRAND}}
.ausboss-strip-row.speech{--bar:rgba(214,158,46,.3);color:#f0dcae}
.ausboss-strip-second{flex:none;width:26px;text-align:right;color:#7fa5a1;font-variant-numeric:tabular-nums}
.ausboss-strip-words{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis}
.ausboss-strip-note{flex:none;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#6f8886;font-size:10px;line-height:12px;user-select:none}
.ausboss-strip-note.warn{color:#d9a441}
`;
  document.head.append(style);
}

// A bypassed or muted source doesn't reach the node when it runs, so it doesn't count.
function wired(node, name) {
  const slot = node.inputs?.find((input) => input?.widget?.name === name || input?.name === name);
  if (slot?.link === null || slot?.link === undefined) return false;
  const graph = node.graph;
  const link = graph?.links?.[slot.link] ?? graph?._links?.get?.(slot.link);
  return ((graph?.getNodeById?.(link?.origin_id)?.mode) ?? 0) === 0;
}

// A card row: { panel: momentStrip, height }.
export function momentStrip(node) {
  ensureCss();
  const element = document.createElement("div");
  element.className = "ausboss-strip";
  const rows = document.createElement("div");
  rows.className = "ausboss-strip-rows";
  const note = document.createElement("div");
  note.className = "ausboss-strip-note";
  element.append(rows, note);

  const show = (report) => {
    rows.textContent = "";
    for (const moment of stripRows(report)) {
      const row = document.createElement("div");
      row.className = "ausboss-strip-row";
      row.classList.toggle("cut", moment.cut);
      row.classList.toggle("speech", moment.speech);
      row.style.setProperty("--from", `${moment.from}%`);
      row.style.setProperty("--to", `${moment.to}%`);
      const second = document.createElement("span");
      second.className = "ausboss-strip-second";
      second.textContent = moment.second;
      const words = document.createElement("span");
      words.className = "ausboss-strip-words";
      words.textContent = moment.words;
      row.title = `${moment.second}s: ${moment.words}`;
      row.append(second, words);
      rows.append(row);
    }
    const caption = stripCaption(report);
    note.textContent = caption.text;
    note.title = caption.text;
    note.classList.toggle("warn", caption.warn);
  };

  let shown = null;
  let timer = null;
  let asked = 0;
  const ask = async (script, seconds, jobs, video) => {
    const turn = ++asked;
    try {
      const response = await api.fetchApi("/ausboss/h3_writer/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, seconds, jobs, video }),
      });
      const report = response.ok ? await response.json() : null;
      if (turn === asked) show(report);
    } catch {
      if (turn === asked) show(null);
    }
  };

  let latest = null;
  const sync = (values) => {
    latest = values;
    if (wired(node, "script")) {
      shown = null;
      clearTimeout(timer);
      asked += 1;
      show(null);
      note.textContent = "The words come from the wire.";
      return;
    }
    const script = String(values.script ?? "");
    const seconds = Number(values.seconds) || 8;
    const jobs = wiredJobs(values, (name) => wired(node, name));
    const video = wired(node, "video") ? values.video_job : "";
    const key = JSON.stringify([seconds, script, jobs, video]);
    if (key === shown) return;
    shown = key;
    clearTimeout(timer);
    timer = setTimeout(() => ask(script, seconds, jobs, video), WAIT);
  };
  const watch = setInterval(() => latest && sync(latest), WATCH);
  chainCallback(node, "onRemoved", () => clearInterval(watch));
  return { element, sync };
}
