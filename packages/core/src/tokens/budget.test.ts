import test from "node:test";
import assert from "node:assert/strict";
import { checkTokenBudget, inspectZoneTokens } from "./budget.js";

test("checkTokenBudget returns the expected threshold status", () => {
  const payload = "one two three four five";

  assert.equal(checkTokenBudget(payload, {
    warningLimit: 100,
    requireConfirmationAbove: 150,
    hardLimit: 200,
  }).status, "ok");

  assert.equal(checkTokenBudget(payload, {
    warningLimit: 1,
    requireConfirmationAbove: 150,
    hardLimit: 200,
  }).status, "warning");

  assert.equal(checkTokenBudget(payload, {
    warningLimit: 1,
    requireConfirmationAbove: 2,
    hardLimit: 200,
  }).status, "requires_confirmation");

  assert.equal(checkTokenBudget(payload, {
    warningLimit: 1,
    requireConfirmationAbove: 2,
    hardLimit: 3,
  }).status, "blocked");
});

test("inspectZoneTokens reports each zone and total", () => {
  const report = inspectZoneTokens({
    staticBlock: "static tokens",
    stateLayer: "state tokens",
    dynamicInput: "dynamic tokens",
  });

  assert.ok(report.staticBlock > 0);
  assert.ok(report.stateLayer > 0);
  assert.ok(report.dynamicInput > 0);
  assert.equal(report.total, report.staticBlock + report.stateLayer + report.dynamicInput);
});

test("inspectZoneTokens totals stay consistent with provider/model options", () => {
  const report = inspectZoneTokens({
    staticBlock: "static tokens",
    stateLayer: "state tokens",
    dynamicInput: "dynamic tokens",
  }, { provider: "anthropic", model: "claude-sonnet-4" });

  assert.equal(report.total, report.staticBlock + report.stateLayer + report.dynamicInput);
});

test("checkTokenBudget inflates token count for Claude vs the default tokenizer", () => {
  const payload = "the quick brown fox jumps over the lazy dog repeatedly and verbosely";
  const config = { warningLimit: 100, requireConfirmationAbove: 150, hardLimit: 200 };

  const base = checkTokenBudget(payload, config);
  const claude = checkTokenBudget(payload, config, { provider: "anthropic", model: "claude-sonnet-4" });

  assert.ok(claude.tokens > base.tokens, "Claude correction factor should raise the estimate");
});
