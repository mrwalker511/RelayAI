import test from "node:test";
import assert from "node:assert/strict";
import { detectPromptLoop } from "./anomaly-detector.js";

test("detectPromptLoop returns no anomaly for an empty call log", () => {
  const result = detectPromptLoop([]);
  assert.equal(result.anomalous, false);
  assert.deepEqual(result.reasons, []);
});

test("detectPromptLoop returns no anomaly when calls are at the exact limit", () => {
  const now = Date.now();
  const timestamps = Array.from({ length: 10 }, (_, i) => now - i * 1000);
  const result = detectPromptLoop(timestamps);
  assert.equal(result.anomalous, false);
  assert.deepEqual(result.reasons, []);
});

test("detectPromptLoop returns anomaly when calls exceed limit in window", () => {
  const now = Date.now();
  const timestamps = Array.from({ length: 11 }, (_, i) => now - i * 1000);
  const result = detectPromptLoop(timestamps);
  assert.equal(result.anomalous, true);
  assert.equal(result.reasons.length, 1);
  assert.match(result.reasons[0], /11 prompt events/);
});

test("detectPromptLoop ignores timestamps outside the window", () => {
  const now = Date.now();
  const windowMs = 60_000;
  const recent = Array.from({ length: 5 }, (_, i) => now - i * 1000);
  const old = Array.from({ length: 10 }, (_, i) => now - windowMs - i * 1000 - 1);
  const result = detectPromptLoop([...recent, ...old]);
  assert.equal(result.anomalous, false);
});

test("detectPromptLoop uses custom windowMs and maxEvents", () => {
  const now = Date.now();
  const timestamps = [now, now - 1000, now - 2000];
  const result = detectPromptLoop(timestamps, 5_000, 2);
  assert.equal(result.anomalous, true);
  assert.match(result.reasons[0], /3 prompt events/);
});

test("detectPromptLoop boundary: exactly maxEvents+1 in window is anomalous", () => {
  const now = Date.now();
  const maxEvents = 5;
  const timestamps = Array.from({ length: maxEvents + 1 }, (_, i) => now - i * 100);
  const result = detectPromptLoop(timestamps, 60_000, maxEvents);
  assert.equal(result.anomalous, true);
});
