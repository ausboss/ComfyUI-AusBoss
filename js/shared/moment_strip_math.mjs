// Pure decisions behind js/shared/moment_strip.mjs: what the rows and the
// line under them say. No DOM, no app import, so tests run it under node:test.

const trimmed = (seconds) => String(Math.round(seconds * 10) / 10);
const percent = (part, whole) => Math.min(Math.max((part / whole) * 100, 0), 100);

// The job of each picture that is connected, by its number, for the server to
// check the @ numbers in a script against.
export function wiredJobs(values, wired) {
  const jobs = {};
  for (const number of [1, 2, 3, 4]) {
    if (wired(`picture_${number}`)) jobs[number] = values[`job_${number}`];
  }
  return jobs;
}

// One row for each moment the server read: its second, its words, and where
// its bar sits in the clip, as percentages.
export function stripRows(report) {
  const moments = report?.moments ?? [];
  const seconds = report?.seconds || moments.at(-1)?.end || 1;
  return moments.map((moment) => ({
    second: trimmed(moment.start),
    words: moment.text,
    from: percent(moment.start, seconds),
    to: Math.max(percent(moment.end, seconds), percent(moment.start, seconds) + 1),
    cut: Boolean(moment.cut),
    speech: Boolean(moment.speech),
    line: Number.isInteger(moment.line) ? moment.line : null,
    start: Number(moment.start) || 0,
  }));
}

// A time typed at the start of a line: 3s:, 3s, at 3 seconds, [3s]. As in the
// writer, a spelled-out time needs its mark: "7 seconds remain" is an action.
const TYPED_TIME =
  /^(?:\[\s*\d+(?:\.\d+)?\s*(?:seconds?|secs?|s)\b\s*\]\s*[:,\-]?|at\s+\d+(?:\.\d+)?\s*(?:seconds?|secs?|s)\b\s*[:,\-]?|\d+(?:\.\d+)?\s*(?:seconds?|secs?|s)\b\s*[:,\-](?!\d)|\d+(?:\.\d+)?(?:s|secs?)\b)\s*/i;

// The script with one line set to start at a second: its old time, if any,
// gives way to the new one. line counts typed lines from 0.
export function retime(text, line, second) {
  const lines = String(text ?? "").split("\n");
  if (!Number.isInteger(line) || line < 0 || line >= lines.length) return String(text ?? "");
  const lead = lines[line].match(/^\s*/)[0];
  const words = lines[line].slice(lead.length).replace(TYPED_TIME, "");
  lines[line] = `${lead}${trimmed(second)}s: ${words}`;
  return lines.join("\n");
}

// The whole seconds a moment's start can be dragged to: after the moment
// before it, before the one after it (or the end of the clip).
export function dragRange(rows, index, seconds) {
  const before = rows[index - 1]?.start ?? 0;
  const after = rows[index + 1]?.start ?? seconds;
  const low = Math.floor(before) + 1;
  const high = Math.ceil(after) - 1;
  return low <= high ? [low, high] : null;
}

// The line under the rows: a warning first, then what the script adds up to.
export function stripCaption(report) {
  if (report?.warning) return { text: report.warning, warn: true };
  const moments = report?.moments ?? [];
  if (!moments.length) return { text: "Each line becomes a moment. A blank line between lines is a cut.", warn: false };
  const count = moments.length === 1 ? "1 moment" : `${moments.length} moments`;
  const cuts = moments.filter((moment) => moment.cut).length;
  // Say how to cut, since nothing on the bar shows it until you hover an edge.
  if (cuts) return { text: `${count}, ${cuts === 1 ? "1 cut" : `${cuts} cuts`}. Click a cut on the bar to join the shots.`, warn: false };
  const each = moments.map((moment) => trimmed(moment.end - moment.start));
  if (moments.length === 1) return { text: `${count}, ${each[0]} s, one take. Add a line for the next moment, a blank line to cut.`, warn: false };
  const even = each.every((length) => length === each[0]);
  return { text: `${even ? `${count}, ${each[0]} s each` : count}, one take. Click between two moments to cut there.`, warn: false };
}

// What a swap's lines were read as, in plain words: who each new person
// replaces and how they look, then any words a swap leaves out.
export function readLines(read) {
  if (!read) return [];
  if (read.problem) return [{ text: read.problem, warn: true }];
  const lines = (read.people ?? []).map((person) => {
    let text = `@${person.slot} replaces ${person.goes}${person.named ? "" : " (no one named)"}.`;
    if (person.looks) text += ` Looks like ${person.looks}.`;
    else if (read.keeps_clip_clothes) text += " Keeps the clip's clothes.";
    return { text, warn: false };
  });
  const words = unusedWords(read);
  if (words) lines.push({ text: `Not used: ${words}. A swap keeps the clip's camera and moves; only spoken lines in quotes change.`, warn: true });
  return lines;
}

// The same reading as the Ref2VA prompt names it: the cast lines the writer
// sends to H3, then any words it leaves out.
export function castLines(read) {
  if (!read) return [];
  if (read.problem) return [{ text: read.problem, warn: true }];
  const lines = (read.cast ?? []).map((text) => ({ text, warn: false }));
  const words = unusedWords(read);
  if (words) lines.push({ text: `Not sent: ${words} (a swap keeps the clip's camera and moves)`, warn: true });
  return lines;
}

function unusedWords(read) {
  return (read.unused ?? []).map((clause) => `\u201c${clause}\u201d`).join(", ");
}

// A cast line in pieces, so the tags can be coloured: subject, video,
// picture, removed, speech marks, and plain words.
export function castPieces(text) {
  const pieces = [];
  const pattern = /(<Subject \d+>)|(<Video \d+>)|(<Picture \d+>)|(\u2192 removed)|(<\/?d>)/g;
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > at) pieces.push({ kind: "", text: text.slice(at, match.index) });
    const kind = match[1] ? "subject" : match[2] ? "video" : match[3] ? "picture" : match[4] ? "removed" : "speech";
    pieces.push({ kind, text: match[0] });
    at = match.index + match[0].length;
  }
  if (at < text.length) pieces.push({ kind: "", text: text.slice(at) });
  return pieces;
}

// The seconds the bar under the script marks: every second up to 10 s,
// every other one after, always with the end.
export function rulerSeconds(seconds) {
  const total = Math.max(1, Math.round(Number(seconds) || 0));
  const step = total > 10 ? 2 : 1;
  const marks = [];
  for (let mark = 0; mark < total; mark += step) marks.push(mark);
  if (total - marks.at(-1) < step) marks.pop();
  return [...marks, total];
}


// The script with one moment's words moved to another place on the bar.
// slots: the typed line of each draggable moment, in bar order. The words
// move; each place keeps its own time (3s:) and the cuts stay where they
// are, so the bar's marks don't jump.
export function moveMoment(text, slots, from, to) {
  const lines = String(text ?? "").split("\n");
  if (from === to || !slots.every((line) => Number.isInteger(line) && line >= 0 && line < lines.length)) return String(text ?? "");
  const split = (line) => {
    const lead = lines[line].match(/^\s*/)[0];
    const body = lines[line].slice(lead.length);
    const time = body.match(TYPED_TIME)?.[0] ?? "";
    return { lead, time, words: body.slice(time.length) };
  };
  const parts = slots.map(split);
  const words = parts.map((part) => part.words);
  const [moved] = words.splice(from, 1);
  words.splice(Math.max(0, Math.min(to, words.length)), 0, moved);
  slots.forEach((line, index) => { lines[line] = parts[index].lead + parts[index].time + words[index]; });
  return lines.join("\n");
}

// The script with a cut added or taken away just before a typed line: a cut
// is a blank line.
export function toggleCut(text, line) {
  const lines = String(text ?? "").split("\n");
  if (!Number.isInteger(line) || line <= 0 || line >= lines.length) return String(text ?? "");
  let top = line;
  while (top > 0 && lines[top - 1].trim() === "") top -= 1;
  if (top < line) lines.splice(top, line - top);
  else lines.splice(line, 0, "");
  return lines.join("\n");
}
