// The timeline on H3 Prompt Writer: each moment of the script as a block on a
// bar as long as the clip, with the cuts as marks. The server reads the script with the same code a run uses,
// so the bar shows what will happen. It also colours the script box, so the
// words the node reads as instructions (@1, 3s:, a cut) stand out.
import { clipLengthWords, clipSetsDuration, clipTimingFor, linkSource } from "./h3_duration.mjs";
import { api } from "../../../scripts/api.js";
import { app } from "../../../scripts/app.js";
import { BRAND, chainCallback } from "./index.mjs";
import { dragRange, moveMoment, retime, rulerSeconds, stripCaption, stripRows, toggleCut, wiredJobs } from "./moment_strip_math.mjs";
import { attachScriptAssist } from "./script_assist.mjs";
import { attachScriptColours } from "./script_colours.mjs";
import { commitWidgetValue } from "./widget_card_math.mjs";

const CSS_ID = "ausboss-moment-strip-css";
const WAIT = 200; // Lets someone finish a word before asking.
const WATCH = 1000; // A Workflow Switches card turns a picture off without touching this node.

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-strip{display:flex;flex-direction:column;gap:3px;height:100%;min-width:0;padding:5px 6px 3px;box-sizing:border-box;border-radius:6px;background:#0b0f10;font:600 10px/1.15 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;user-select:none}
.ausboss-strip-ruler{position:relative;flex:none;height:11px;color:#56706d;font-size:9px;line-height:11px}
.ausboss-strip-ruler span{position:absolute;transform:translateX(-50%);white-space:nowrap}
.ausboss-strip-ruler span:first-child{transform:none}
.ausboss-strip-ruler span:last-child{transform:translateX(-100%)}
.ausboss-strip-track{position:relative;flex:1 1 0;min-height:30px}
.ausboss-strip-block{position:absolute;top:0;bottom:0;display:flex;align-items:center;gap:4px;padding:0 4px;box-sizing:border-box;overflow:hidden;border:1px solid rgba(0,180,170,.5);border-radius:4px;background:rgba(0,180,170,.2);color:#cfe8e5}
.ausboss-strip-block.shot-odd{border-color:rgba(111,192,170,.42);background:rgba(111,192,170,.1)}
.ausboss-strip-block.speech{border-color:rgba(245,181,61,.55);background:rgba(245,181,61,.14);color:#f0dcae}
.ausboss-strip-faces{flex:none;display:flex;height:100%;max-height:28px}
.ausboss-strip-faces img{width:18px;height:100%;border-radius:3px;object-fit:cover;box-shadow:0 0 0 1px #0b0f10}
.ausboss-strip-faces img+img{margin-left:2px}
.ausboss-strip-words{flex:1 1 0;min-width:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
.ausboss-strip-cut{position:absolute;top:-13px;bottom:-2px;width:2px;margin-left:-1px;border-radius:1px;background:${BRAND}}
.ausboss-strip-handle{position:absolute;top:-2px;bottom:-2px;z-index:2;width:12px;margin-left:-6px;cursor:ew-resize;touch-action:none}
.ausboss-strip-handle::before{content:"";position:absolute;left:5px;top:5px;bottom:5px;width:2px;border-radius:1px;background:rgba(207,232,229,.35)}
.ausboss-strip-handle:hover::before,.ausboss-strip-handle.dragging::before{background:#cfe8e5}
.ausboss-strip-handle span{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);padding:1px 4px;border-radius:3px;background:#cfe8e5;color:#0b0f10;font-size:9px;white-space:nowrap;display:none}
.ausboss-strip-handle.dragging span{display:block}
.ausboss-strip-block.movable{cursor:grab;touch-action:none}
.ausboss-strip-block.moving{z-index:3;cursor:grabbing;opacity:.85;box-shadow:0 4px 14px rgba(0,0,0,.5)}
.ausboss-strip-drop{position:absolute;top:-3px;bottom:-3px;z-index:4;width:3px;margin-left:-2px;border-radius:2px;background:#f5b53d;pointer-events:none}
.ausboss-strip-note{flex:none;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#6f8886;font-size:10px;font-weight:500;line-height:12px}
.ausboss-strip-note.warn{color:#d9a441}
`;
  document.head.append(style);
}

function wired(node, name) {
  return linkSource(node, name) !== null;
}

// The picture a loader shows, to put on the blocks that name it.
function pictureUrl(node, number) {
  const source = linkSource(node, `picture_${number}`);
  return source?.imgs?.[0]?.src ?? "";
}

function el(className, text) {
  const node = document.createElement("div");
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// A card row: { panel: momentStrip, height }.
export function momentStrip(node) {
  ensureCss();
  const element = el("ausboss-strip");
  const ruler = el("ausboss-strip-ruler");
  const track = el("ausboss-strip-track");
  const note = el("ausboss-strip-note");
  element.append(ruler, track, note);
  const colours = attachScriptColours(node);
  const choices = (name) => (node.widgets?.find((widget) => widget.name === name)?.options?.values ?? []).filter((value) => value !== "as typed" && value !== "from the picture");
  const assist = attachScriptAssist(node, colours.area, colours.layer, () => ({
    pictures: [1, 2, 3, 4].map((number) => ({
      number,
      plugged: wired(node, `picture_${number}`),
      job: node.widgets?.find((widget) => widget.name === `job_${number}`)?.value ?? "",
      url: pictureUrl(node, number),
    })),
    cameras: choices("camera"),
    looks: choices("look"),
    seconds: clipSetsDuration(node, lastValues) ? 0 : Number(lastSeconds) || 8,
  }));

  let lastValues = {};
  let lastSeconds = 8;
  // The left edge of a moment that opens a typed line can be dragged; letting
  // go types its second into that line (3s:), so the words stay the truth.
  const commitScript = (change) => {
    const widget = node.widgets?.find((entry) => entry.name === "script");
    if (!widget) return;
    const next = change(String(widget.value ?? ""));
    if (next === widget.value) return;
    commitWidgetValue(node, widget, next, app.canvas);
    sync({ ...lastValues, script: widget.value });
  };
  // The left edge of a moment that opens a typed line: drag it to set when
  // the moment starts (it types 3s: into that line), or click it to add or
  // take away a cut there (a blank line). The words stay the truth.
  const addHandle = (rows, index, seconds) => {
    const range = dragRange(rows, index, seconds);
    const handle = el("ausboss-strip-handle");
    const label = document.createElement("span");
    handle.append(label);
    handle.style.left = `${rows[index].from}%`;
    handle.title = range ? "Drag to set when this moment starts. Click to add or remove a cut." : "Click to add or remove a cut.";
    track.append(handle);
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture?.(event.pointerId);
      const startX = event.clientX;
      let moved = false;
      let second = null;
      const move = (moveEvent) => {
        if (!moved && Math.abs(moveEvent.clientX - startX) < 4) return;
        if (!range) return;
        moved = true;
        handle.classList.add("dragging");
        const box = track.getBoundingClientRect();
        const raw = ((moveEvent.clientX - box.left) / Math.max(box.width, 1)) * seconds;
        second = Math.min(range[1], Math.max(range[0], Math.round(raw)));
        handle.style.left = `${(second / seconds) * 100}%`;
        label.textContent = `${second}s`;
      };
      const stop = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
        handle.classList.remove("dragging");
        if (!moved) commitScript((text) => toggleCut(text, rows[index].line));
        else if (second !== null && second !== rows[index].start) commitScript((text) => retime(text, rows[index].line, second));
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    });
  };
  // A click on a block selects its line in the words, ready to change.
  const selectLine = (line) => {
    const area = colours.area;
    if (!area || !Number.isInteger(line)) return;
    const lines = area.value.split("\n");
    if (line >= lines.length) return;
    const start = lines.slice(0, line).reduce((total, text) => total + text.length + 1, 0);
    area.focus({ preventScroll: true });
    area.setSelectionRange(start, start + lines[line].length);
    const height = parseFloat(getComputedStyle(area).lineHeight) || 17;
    area.scrollTop = Math.max(0, line * height - area.clientHeight / 3);
  };
  // A block that opens a typed line can be dragged along the bar: its words
  // swap places with the others; times and cuts stay where they are.
  const makeMovable = (block, rows, entries, order) => {
    block.classList.add("movable");
    block.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      block.setPointerCapture?.(event.pointerId);
      const startX = event.clientX;
      let target = order;
      let moved = false;
      const drop = el("ausboss-strip-drop");
      const move = (moveEvent) => {
        const shift = moveEvent.clientX - startX;
        if (!moved && Math.abs(shift) < 4) return;
        if (!moved) { moved = true; block.classList.add("moving"); track.append(drop); }
        block.style.transform = `translateX(${shift}px)`;
        const centre = block.getBoundingClientRect().left + block.offsetWidth / 2;
        const others = entries.filter((entry) => entry.order !== order);
        target = others.filter((entry) => {
          const box = entry.block.getBoundingClientRect();
          return centre > box.left + box.width / 2;
        }).length;
        const after = others[target - 1];
        const before = others[target];
        const at = before ? rows[before.index].from : after ? rows[after.index].to : 0;
        drop.style.left = `${at}%`;
      };
      const stop = () => {
        block.removeEventListener("pointermove", move);
        block.removeEventListener("pointerup", stop);
        block.removeEventListener("pointercancel", stop);
        block.classList.remove("moving");
        block.style.transform = "";
        drop.remove();
        if (!moved) selectLine(rows[entries[order].index].line);
        else if (target !== order) commitScript((text) => moveMoment(text, entries.map((entry) => rows[entry.index].line), order, target));
      };
      block.addEventListener("pointermove", move);
      block.addEventListener("pointerup", stop);
      block.addEventListener("pointercancel", stop);
    });
  };
  const show = (report) => {
    const seconds = Number(report?.seconds) || Number(lastValues.seconds) || 8;
    ruler.textContent = "";
    for (const mark of rulerSeconds(seconds)) {
      const tick = document.createElement("span");
      tick.style.left = `${(mark / seconds) * 100}%`;
      tick.textContent = `${mark}s`;
      ruler.append(tick);
    }
    track.textContent = "";
    let shot = 0;
    const rows = stripRows(report);
    const movable = [];
    rows.forEach((moment, index) => {
      if (moment.cut && index) shot += 1;
      const block = el(`ausboss-strip-block${shot % 2 ? " shot-odd" : ""}`);
      block.classList.toggle("speech", moment.speech);
      block.style.left = `${moment.from}%`;
      block.style.width = `calc(${moment.to - moment.from}% - 2px)`;
      // Every picture the line names, in order, up to three.
      const faces = el("ausboss-strip-faces");
      for (const number of [...new Set([...moment.words.matchAll(/@([1-4])\b/g)].map((match) => match[1]))].slice(0, 3)) {
        const url = pictureUrl(node, number);
        if (!url) continue;
        const picture = document.createElement("img");
        picture.src = url;
        picture.alt = `@${number}`;
        faces.append(picture);
      }
      if (faces.childElementCount) block.append(faces);
      block.append(el("ausboss-strip-words", moment.words));
      block.title = `${moment.second}s: ${moment.words}`;
      track.append(block);
      if (moment.line !== null) movable.push({ block, index, order: movable.length });
      const opens = rows.slice(0, index + 1).findLast((row) => row.line !== null)?.line ?? null;
      block.addEventListener("click", () => { if (!block.classList.contains("movable")) selectLine(opens); });
      if (index && moment.line !== null && !wired(node, "script")) addHandle(rows, index, seconds);
      if (moment.cut && index) {
        const cut = el("ausboss-strip-cut");
        cut.style.left = `${moment.from}%`;
        cut.title = `Cut at ${moment.second}s`;
        track.append(cut);
      }
    });
    if (movable.length > 1 && !wired(node, "script")) {
      for (const entry of movable) {
        makeMovable(entry.block, rows, movable, entry.order);
        entry.block.title += " · drag to move it";
      }
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
      if (turn === asked && !clipSetsDuration(node, lastValues)) show(report);
    } catch {
      if (turn === asked && !clipSetsDuration(node, lastValues)) show(null);
    }
  };

  let latest = null;
  let fromClip = false;
  const sync = (values) => {
    latest = values;
    lastValues = values;
    const nextFromClip = clipSetsDuration(node, values);
    if (fromClip !== nextFromClip) {
      fromClip = nextFromClip;
      // Also notice a source switched off without changing this node's wires.
      queueMicrotask(() => node.__ausbossCard?.refresh?.());
    }
    colours.sync(values, [1, 2, 3, 4].filter((number) => wired(node, `picture_${number}`)));
    if (fromClip) {
      shown = null;
      clearTimeout(timer);
      asked += 1;
      ruler.textContent = "";
      track.textContent = "";
      // Say what H3 will make of the clip's frames, when the clip node knows
      // its count; it rounds down to 5 + 17n, so a 48-frame clip gives 39.
      const words = clipLengthWords(clipTimingFor(node));
      const message = el("ausboss-strip-words", words?.title ?? "Length comes from the clip");
      message.style.cssText = "display:flex;align-items:center;height:100%";
      track.append(message);
      note.textContent = words?.note ?? "Set the clip's length on the clip node. H3 makes 5 + 17n frames (22, 39, 56 ...), rounding the clip down.";
      note.title = note.textContent;
      note.classList.toggle("warn", Boolean(words?.warn));
      return;
    }
    if (wired(node, "script")) {
      shown = null;
      clearTimeout(timer);
      asked += 1;
      show(null);
      note.textContent = "The words come from the wire.";
      return;
    }
    const script = String(values.script ?? "");
    // A length wired from a number box shows that box's value.
    const source = linkSource(node, "seconds");
    const fromWire = Number(source?.widgets?.find?.((widget) => widget.name === "value")?.value);
    const seconds = Math.min(15, Math.max(5, Math.round(fromWire || Number(values.seconds) || 8)));
    lastSeconds = seconds;
    const jobs = wiredJobs(values, (name) => wired(node, name));
    const video = wired(node, "video") ? values.video_job : "";
    const key = JSON.stringify([seconds, script, jobs, video]);
    if (key === shown) return;
    shown = key;
    clearTimeout(timer);
    timer = setTimeout(() => ask(script, seconds, jobs, video), WAIT);
  };
  const watch = setInterval(() => latest && sync(latest), WATCH);
  chainCallback(node, "onRemoved", () => { clearInterval(watch); colours.dispose(); assist.dispose(); });
  return { element, sync };
}
