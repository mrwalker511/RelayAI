import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAuditEvent, readAuditLog, filterAuditLog } from "./audit-log.js";

function tempLog(): string {
  const dir = mkdtempSync(join(tmpdir(), "relay-audit-test-"));
  return join(dir, "audit.log");
}

test("appendAuditEvent writes a valid NDJSON line", () => {
  const logPath = tempLog();
  appendAuditEvent(logPath, { event: "ask", session_id: "sess_abc" });
  const text = readFileSync(logPath, "utf8");
  const lines = text.split("\n").filter(Boolean);
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.event, "ask");
  assert.equal(parsed.session_id, "sess_abc");
  assert.equal(parsed.v, 1);
  assert.ok(typeof parsed.ts === "string" && parsed.ts.length > 0, "ts must be a non-empty string");
});

test("appendAuditEvent appends multiple events", () => {
  const logPath = tempLog();
  appendAuditEvent(logPath, { event: "session_start", session_id: "sess_1" });
  appendAuditEvent(logPath, { event: "ask", session_id: "sess_1", prompt_chars: 42 });
  appendAuditEvent(logPath, { event: "session_end", session_id: "sess_1" });
  const events = readAuditLog(logPath);
  assert.equal(events.length, 3);
  assert.equal(events[0].event, "session_start");
  assert.equal(events[1].event, "ask");
  assert.equal(events[1].prompt_chars, 42);
  assert.equal(events[2].event, "session_end");
});

test("readAuditLog returns empty array for non-existent file", () => {
  const events = readAuditLog("/tmp/relay-nonexistent-audit-xyz.log");
  assert.deepEqual(events, []);
});

test("readAuditLog skips malformed lines gracefully", () => {
  const logPath = tempLog();
  writeFileSync(logPath, '{"event":"ok","session_id":null,"v":1,"ts":"2025-01-01T00:00:00Z"}\nnot json\n{"event":"ok2","session_id":null,"v":1,"ts":"2025-01-01T00:00:01Z"}\n');
  const events = readAuditLog(logPath);
  assert.equal(events.length, 2);
  assert.equal(events[0].event, "ok");
  assert.equal(events[1].event, "ok2");
});

test("filterAuditLog filters by event type", () => {
  const events = [
    { ts: "t1", event: "ask", session_id: "s1", v: 1 as const },
    { ts: "t2", event: "session_start", session_id: "s1", v: 1 as const },
    { ts: "t3", event: "ask", session_id: "s2", v: 1 as const },
  ];
  const filtered = filterAuditLog(events, { event: "ask" });
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every(e => e.event === "ask"));
});

test("filterAuditLog filters by session_id", () => {
  const events = [
    { ts: "t1", event: "ask", session_id: "sess_a", v: 1 as const },
    { ts: "t2", event: "ask", session_id: "sess_b", v: 1 as const },
    { ts: "t3", event: "session_end", session_id: "sess_a", v: 1 as const },
  ];
  const filtered = filterAuditLog(events, { session_id: "sess_a" });
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every(e => e.session_id === "sess_a"));
});

test("filterAuditLog limits by tail", () => {
  const events = Array.from({ length: 10 }, (_, i) => ({
    ts: `t${i}`, event: "ask", session_id: null, v: 1 as const
  }));
  const filtered = filterAuditLog(events, { tail: 3 });
  assert.equal(filtered.length, 3);
  assert.equal(filtered[0].ts, "t7");
  assert.equal(filtered[2].ts, "t9");
});

test("filterAuditLog can combine event and session_id filters", () => {
  const events = [
    { ts: "t1", event: "ask", session_id: "s1", v: 1 as const },
    { ts: "t2", event: "ask", session_id: "s2", v: 1 as const },
    { ts: "t3", event: "session_end", session_id: "s1", v: 1 as const },
  ];
  const filtered = filterAuditLog(events, { event: "ask", session_id: "s1" });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].ts, "t1");
});

test("appendAuditEvent rotates when maxLines is exceeded", () => {
  const logPath = tempLog();
  // Write exactly maxLines events (3)
  for (let i = 0; i < 3; i++) {
    appendAuditEvent(logPath, { event: "ask", session_id: null, i }, 3);
  }
  // Append one more — should trigger rotation (drop 20% = 1 line)
  appendAuditEvent(logPath, { event: "ask", session_id: null, i: 99 }, 3);
  const events = readAuditLog(logPath);
  // After rotation: drop 1 oldest, keep 2, then add new = 3 lines total
  assert.ok(events.length <= 3, `expected ≤3 events after rotation, got ${events.length}`);
  // The newest event (i:99) must be present
  assert.ok(events.some(e => e.i === 99), "newest event must survive rotation");
  // The oldest event (i:0) must be gone
  assert.ok(!events.some(e => e.i === 0), "oldest event must be dropped by rotation");
});
