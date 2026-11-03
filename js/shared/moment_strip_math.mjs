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
  }));
}

// The line under the rows: a warning first, then what the script adds up to.
export function stripCaption(report) {
  if (report?.warning) return { text: report.warning, warn: true };
  const moments = report?.moments ?? [];
  if (!moments.length) return { text: "Each line becomes a moment.", warn: false };
  const count = moments.length === 1 ? "1 moment" : `${moments.length} moments`;
  const cuts = moments.filter((moment) => moment.cut).length;
  if (cuts) return { text: `${count}, ${cuts === 1 ? "1 cut" : `${cuts} cuts`}.`, warn: false };
  const each = moments.map((moment) => trimmed(moment.end - moment.start));
  if (moments.length === 1) return { text: `${count}, ${each[0]} s, one take.`, warn: false };
  const even = each.every((length) => length === each[0]);
  return { text: even ? `${count}, ${each[0]} s each, one take.` : `${count}, one take.`, warn: false };
}
