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
