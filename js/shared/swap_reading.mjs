// H3 Prompt Writer, swap job: the box under the script that shows how the
// writer read the swap lines, as you type. Two views: Ref2VA, the cast lines
// the writer sends to H3, and Plain, the same reading in everyday words. The
// clip's frame count sits along the bottom, as the moment strip shows it for
// other clip jobs.

import { clipLengthWords, clipSetsDuration, clipTimingFor, linkSource } from "./h3_duration.mjs";
import { api } from "../../../scripts/api.js";
import { chainCallback } from "./index.mjs";
import { castLines, castPieces, readLines, wiredJobs } from "./moment_strip_math.mjs";
import { FONT_UI, THEME } from "./theme.mjs";

const CSS_ID = "ausboss-swap-reading-css";
const SWAP_JOB = "swap the person";
const VIEW = "ausboss_read_view"; // the picked view, kept on the node
const OPEN = "ausboss_read_open"; // unfolded, kept on the node; folded by default
const WAIT = 200; // Lets someone finish a word before asking.
const WATCH = 1000; // Notices the clip unplugged or switched off.

// Whether the box is unfolded. Folded, it is one line, so the node stays short.
export function swapReadingOpen(node) {
  return node.properties?.[OPEN] === true;
}

// The box shows for a swap whose clip is plugged in and whose words are typed.
export function swapReadingShows(values, node) {
  return values.video_job === SWAP_JOB && clipSetsDuration(node, values) && linkSource(node, "script") === null;
}

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-swapread{display:flex;flex-direction:column;gap:4px;height:100%;min-width:0;padding:5px 8px 4px;box-sizing:border-box;border-left:2px solid ${THEME.brand};border-radius:6px;background:rgba(0,180,170,.1);font:500 11px/1.35 ${FONT_UI};color:${THEME.inkSoft};user-select:none}
.ausboss-swapread-head{flex:none;display:flex;align-items:center;gap:6px;height:16px}
.ausboss-swapread-title{flex:none;cursor:pointer;color:${THEME.faint};font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.ausboss-swapread-title:hover{color:${THEME.inkSoft}}
.ausboss-swapread-sum{flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:pointer}
.ausboss-swapread-sum.warn{color:${THEME.warn}}
.ausboss-swapread.folded{gap:2px;padding-top:4px}
.ausboss-swapread.folded .ausboss-swapread-body,.ausboss-swapread.folded .ausboss-swapread-tabs{display:none}
.ausboss-swapread-tabs{flex:none;display:flex;margin-left:auto;padding:1px;border-radius:5px;background:${THEME.fill}}
.ausboss-swapread-tabs button{all:unset;padding:0 7px;height:14px;border-radius:4px;color:${THEME.label};font-size:9px;font-weight:700;line-height:14px;cursor:pointer}
.ausboss-swapread-tabs button.on{background:${THEME.brand};color:${THEME.onBrand}}
.ausboss-swapread-body{flex:1 1 0;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin}
.ausboss-swapread-body div{margin:0 0 2px;word-break:break-word}
.ausboss-swapread-body.ref2va{font:500 10px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.ausboss-swapread-body .warn{color:${THEME.warn}}
.ausboss-swapread-body .subject{color:#f5b53d}
.ausboss-swapread-body .video{color:#7fb8ff}
.ausboss-swapread-body .picture{color:${THEME.brandInk}}
.ausboss-swapread-body .removed{color:${THEME.danger}}
.ausboss-swapread-body .speech{color:${THEME.faint}}
.ausboss-swapread-body .empty{color:${THEME.faint}}
.ausboss-swapread-foot{flex:none;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:${THEME.faint};font-size:10px;line-height:12px}
.ausboss-swapread-foot.warn{color:${THEME.warn}}
`;
  document.head.append(style);
}

function el(className, text) {
  const node = document.createElement("div");
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Card rows: the folded line, and the open box with its two views.
export const swapReading = (node) => readingBox(node, false);
export const swapReadingFolded = (node) => readingBox(node, true);

function readingBox(node, folded) {
  ensureCss();
  const element = el(folded ? "ausboss-swapread folded" : "ausboss-swapread");
  const head = el("ausboss-swapread-head");
  const title = el("ausboss-swapread-title", folded ? "\u25b8 Read as" : "\u25be Read as");
  const summary = el("ausboss-swapread-sum");
  const tabs = el("ausboss-swapread-tabs");
  const body = el("ausboss-swapread-body");
  const foot = el("ausboss-swapread-foot");
  head.append(title, ...(folded ? [summary] : []), tabs);
  element.append(head, body, foot);
  // Click the caption (or, folded, the line) to open or fold the box.
  const toggle = (event) => {
    event.stopPropagation();
    node.properties = node.properties ?? {};
    node.properties[OPEN] = folded;
    node.__ausbossCard?.refresh?.();
  };
  title.title = folded ? "Show how the writer read your lines." : "Fold this away.";
  summary.title = "Click to show all of it.";
  title.addEventListener("click", toggle);
  summary.addEventListener("click", toggle);

  const view = () => (node.properties?.[VIEW] === "plain" ? "plain" : "ref2va");
  const buttons = {};
  for (const [key, label, hint] of [
    ["ref2va", "Ref2VA", "The cast lines the writer sends to H3."],
    ["plain", "Plain", "The same reading in everyday words."],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = hint;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      node.properties = node.properties ?? {};
      node.properties[VIEW] = key;
      render();
    });
    buttons[key] = button;
    tabs.append(button);
  }

  let read = null;
  const render = () => {
    const picked = view();
    for (const [key, button] of Object.entries(buttons)) button.classList.toggle("on", key === picked);
    body.className = `ausboss-swapread-body ${picked}`;
    body.textContent = "";
    const lines = picked === "plain" ? readLines(read) : castLines(read);
    // Folded: who goes, with a count of the words not used in front of it.
    const plain = readLines(read);
    const first = read?.problem ? plain[0] : plain.find((line) => !line.warn);
    const left = read?.problem ? 0 : (read?.unused ?? []).length;
    const words = first?.text ?? (read ? "Plug in a person's picture to swap." : "Reading the lines\u2026");
    summary.textContent = left ? `${left} part${left === 1 ? "" : "s"} not used. ${words}` : words;
    summary.classList.toggle("warn", Boolean(read?.problem || left));
    if (!lines.length) {
      body.append(el("empty", read ? "Plug in a person's picture to swap." : "Reading the lines…"));
      return;
    }
    for (const line of lines) {
      const row = el(line.warn ? "warn" : "");
      if (picked === "plain" || line.warn) row.textContent = line.text;
      else {
        for (const piece of castPieces(line.text)) {
          const span = document.createElement("span");
          if (piece.kind) span.className = piece.kind;
          span.textContent = piece.text;
          row.append(span);
        }
      }
      body.append(row);
    }
  };

  const showLength = () => {
    const words = clipLengthWords(clipTimingFor(node));
    foot.textContent = words?.title ?? "Length comes from the clip";
    foot.title = [words?.title, words?.note].filter(Boolean).join(". ");
    foot.classList.toggle("warn", Boolean(words?.warn));
  };

  let shown = null;
  let timer = null;
  let turn = 0;
  const ask = async (script, jobs) => {
    const mine = ++turn;
    try {
      const response = await api.fetchApi("/ausboss/h3_writer/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, seconds: 8, jobs, video: SWAP_JOB }),
      });
      const report = response.ok ? await response.json() : null;
      if (mine !== turn) return;
      read = report?.read ?? null;
      render();
    } catch {
      // The reading is a help; without it the box keeps its last reading.
    }
  };

  let latest = null;
  let showing = null;
  const sync = (values) => {
    latest = values;
    const shows = swapReadingShows(values, node);
    if (showing !== null && shows !== showing) queueMicrotask(() => node.__ausbossCard?.refresh?.());
    showing = shows;
    if (!shows) return;
    showLength();
    const script = String(values.script ?? "");
    const jobs = wiredJobs(values, (name) => linkSource(node, name) !== null);
    const key = JSON.stringify([script, jobs]);
    if (key === shown) return;
    shown = key;
    clearTimeout(timer);
    timer = setTimeout(() => ask(script, jobs), WAIT);
  };
  render();
  // Only while on screen: a hidden row is not handed new values.
  const watch = setInterval(() => latest && element.offsetParent !== null && sync(latest), WATCH);
  chainCallback(node, "onRemoved", () => clearInterval(watch));
  return { element, sync };
}
