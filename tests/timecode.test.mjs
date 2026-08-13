import assert from "node:assert/strict";
import test from "node:test";

import { formatTimecode, parseTimecode } from "../js/shared/timecode.mjs";

test("timecodes format as m:ss below an hour and h:mm:ss above", () => {
  assert.equal(formatTimecode(95.5), "1:35.5");
  assert.equal(formatTimecode(3.86), "0:03.86");
  assert.equal(formatTimecode(0), "0:00");
  assert.equal(formatTimecode(60), "1:00");
  assert.equal(formatTimecode(3723.5), "1:02:03.5");
  assert.equal(formatTimecode(3600), "1:00:00");
});

test("fractions keep hundredths and drop trailing zeros", () => {
  assert.equal(formatTimecode(10.11), "0:10.11");
  assert.equal(formatTimecode(10.1), "0:10.1");
  assert.equal(formatTimecode(10.5), "0:10.5");
  assert.equal(formatTimecode(10.05), "0:10.05");
  assert.equal(formatTimecode(10.0), "0:10");
});

test("garbage never breaks the formatter", () => {
  assert.equal(formatTimecode(Number.NaN), "0:00");
  assert.equal(formatTimecode(-5), "0:00");
  assert.equal(formatTimecode("nope"), "0:00");
  assert.equal(formatTimecode(undefined), "0:00");
});

test("bare seconds parse as-is", () => {
  assert.equal(parseTimecode("95.5"), 95.5);
  assert.equal(parseTimecode("95"), 95);
  assert.equal(parseTimecode(" 12.75 "), 12.75);
  assert.equal(parseTimecode("0"), 0);
});

test("m:ss form parses with fractional seconds", () => {
  assert.equal(parseTimecode("1:35.5"), 95.5);
  assert.equal(parseTimecode("0:03.86"), 3.86);
  assert.equal(parseTimecode("10:00"), 600);
  // A large minute count is accepted even though the formatter would carry it.
  assert.equal(parseTimecode("90:00"), 5400);
});

test("h:mm:ss form parses with fractional seconds", () => {
  assert.equal(parseTimecode("1:02:03.5"), 3723.5);
  assert.equal(parseTimecode("2:00:00"), 7200);
});

test("every accepted form round-trips through the formatter", () => {
  for (const seconds of [0, 0.04, 3.86, 10.11, 59.99, 60, 95.5, 599.25, 3599.9, 3723.5, 86399.99]) {
    assert.equal(parseTimecode(formatTimecode(seconds)), seconds);
  }
});

test("malformed input parses to null so callers keep the previous value", () => {
  assert.equal(parseTimecode(""), null);
  assert.equal(parseTimecode("   "), null);
  assert.equal(parseTimecode("abc"), null);
  assert.equal(parseTimecode("1:2:3:4"), null);
  assert.equal(parseTimecode("1:75"), null); // seconds field must stay under 60
  assert.equal(parseTimecode("1:75:00"), null); // minutes field must stay under 60
  assert.equal(parseTimecode("1:0x3"), null);
  assert.equal(parseTimecode("-5"), null);
  assert.equal(parseTimecode("-1:30"), null);
  assert.equal(parseTimecode("1:"), null);
  assert.equal(parseTimecode(":30"), null);
  assert.equal(parseTimecode("1.5:30"), null);
  assert.equal(parseTimecode(null), null);
  assert.equal(parseTimecode(undefined), null);
  assert.equal(parseTimecode({}), null);
});

test("numeric input is tolerated for programmatic callers", () => {
  assert.equal(parseTimecode(95.5), 95.5);
});
