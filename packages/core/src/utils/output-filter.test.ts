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

test("preserves failure lines even when they fall in the truncated middle", () => {
  // Build 500 lines where failure lines are buried in the middle (lines 200-210)
  const lines: string[] = [];
  for (let i = 0; i < 500; i++) {
    if (i >= 200 && i < 210) {
      lines.push(`Error: assertion failed at line ${i}`);
    } else {
      lines.push(`line ${i}`);
    }
  }
  const raw = lines.join("\n");
  const out = filterOutput(raw, { maxLines: 100 });

  // All error lines must survive truncation
  for (let i = 200; i < 210; i++) {
    assert.ok(out.includes(`Error: assertion failed at line ${i}`), `failure line ${i} must be preserved`);
  }
  assert.ok(out.includes("truncated"), "should still mention truncation");
});

test("preserves FAILED and AssertionError lines from truncation", () => {
  const lines: string[] = [];
  for (let i = 0; i < 400; i++) {
    lines.push(`pass line ${i}`);
  }
  lines[150] = "FAILED: test suite blew up";
  lines[151] = "AssertionError: expected 1 to equal 2";
  const raw = lines.join("\n");
  const out = filterOutput(raw, { maxLines: 50 });

  assert.ok(out.includes("FAILED: test suite blew up"), "FAILED line must survive");
  assert.ok(out.includes("AssertionError: expected 1 to equal 2"), "AssertionError line must survive");
});
