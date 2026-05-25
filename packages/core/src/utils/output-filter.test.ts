import test from "node:test";
import assert from "node:assert/strict";
import { filterOutput } from "./output-filter.js";

test("strips ANSI escape codes", () => {
  const raw = "\x1b[32mhello\x1b[0m world";
  assert.equal(filterOutput(raw), "hello world");
});

test("collapses consecutive blank lines to one", () => {
  const raw = "line1\n\n\n\nline2";
  const out = filterOutput(raw);
  assert.ok(!out.includes("\n\n\n"), "should not have 3+ consecutive newlines");
  assert.ok(out.includes("line1"), "should keep line1");
  assert.ok(out.includes("line2"), "should keep line2");
});

test("deduplicates consecutive identical lines with annotation", () => {
  const raw = ["A", "A", "A", "B"].join("\n");
  const out = filterOutput(raw);
  assert.ok(out.includes("[×3 repeated]"), "should annotate triple repeat");
  assert.ok(!out.split("\n").slice(0, 2).includes("A\nA"), "should not repeat A twice consecutively");
});

test("suppresses excess success lines", () => {
  // Use varied lines so dedupConsecutive does not absorb them first
  const raw = Array.from({ length: 10 }, (_, i) => `✓ compiled src/file${i}.ts`).join("\n");
  const out = filterOutput(raw);
  const successLines = out.split("\n").filter((l) => l.startsWith("✓"));
  assert.ok(successLines.length <= 3, `expected ≤3 success lines, got ${successLines.length}`);
  assert.ok(out.includes("suppressed"), "should include suppression note");
});

test("respects maxSuccessOccurrences = 0 to suppress all success lines", () => {
  // Use varied lines so dedupConsecutive does not absorb them first
  const raw = "✓ compiled src/a.ts\nsome error\n✓ compiled src/b.ts";
  const out = filterOutput(raw, { maxSuccessOccurrences: 0 });
  assert.ok(!out.includes("✓ compiled"), "success lines should be fully suppressed");
  assert.ok(out.includes("some error"), "non-success lines should remain");
});

test("truncates to maxLines with head+tail strategy", () => {
  const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
  const raw = lines.join("\n");
  const out = filterOutput(raw, { maxLines: 100 });
  const outLines = out.split("\n");
  assert.ok(outLines.length < 200, "output should be much shorter than input");
  assert.ok(out.includes("truncated"), "should mention truncation");
  assert.ok(out.includes("line 0"), "should include head lines");
  assert.ok(out.includes("line 499"), "should include tail lines");
});

test("passthrough when input is already clean", () => {
  const raw = "line1\nline2\nline3";
  const out = filterOutput(raw);
  assert.ok(out.includes("line1"));
  assert.ok(out.includes("line2"));
  assert.ok(out.includes("line3"));
});

test("enabled: false returns raw input unchanged", () => {
  const raw = "\x1b[32mno filtering\x1b[0m";
  assert.equal(filterOutput(raw, { enabled: false }), raw);
});
