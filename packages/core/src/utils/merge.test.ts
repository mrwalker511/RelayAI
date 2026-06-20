import test from "node:test";
import assert from "node:assert/strict";
import { deepMerge } from "./merge.js";

test("deepMerge returns base when override is empty", () => {
  const base = { a: 1, b: { c: 2 } };
  const result = deepMerge(base, {});
  assert.deepEqual(result, base);
});

test("deepMerge scalar override replaces base value", () => {
  const result = deepMerge({ a: 1, b: 2 }, { a: 99 });
  assert.equal(result.a, 99);
  assert.equal(result.b, 2);
});

test("deepMerge nested object is merged, not replaced", () => {
  const base = { tokens: { hardLimit: 100, warningLimit: 50 } };
  const override = { tokens: { hardLimit: 200 } } as Partial<typeof base>;
  const result = deepMerge(base, override);
  assert.equal(result.tokens.hardLimit, 200);
  assert.equal(result.tokens.warningLimit, 50);
});

test("deepMerge array in override replaces base array entirely", () => {
  const base = { commands: ["a", "b", "c"] };
  const override = { commands: ["x"] };
  const result = deepMerge(base, override);
  assert.deepEqual(result.commands, ["x"]);
});

test("deepMerge does not mutate base or override", () => {
  const base = { a: { b: 1 } };
  const override = { a: { b: 2 } };
  deepMerge(base, override);
  assert.equal(base.a.b, 1);
  assert.equal(override.a.b, 2);
});

test("deepMerge deeply nested objects are merged correctly", () => {
  const base = { gc: { enabled: true, historyTokenLimit: 12000, targetSummaryTokens: 500 } };
  const override = { gc: { historyTokenLimit: 8000 } } as Partial<typeof base>;
  const result = deepMerge(base, override);
  assert.equal(result.gc.enabled, true);
  assert.equal(result.gc.historyTokenLimit, 8000);
  assert.equal(result.gc.targetSummaryTokens, 500);
});

test("deepMerge unknown keys from override are included", () => {
  const base = { a: 1 } as Record<string, unknown>;
  const override = { b: 2 } as Partial<typeof base>;
  const result = deepMerge(base, override);
  assert.equal(result.a, 1);
  assert.equal(result.b, 2);
});
