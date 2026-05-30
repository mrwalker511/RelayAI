import test from "node:test";
import assert from "node:assert/strict";
import { estimateZoneAwareInputCost, computeMeasuredCost } from "./cost-estimator.js";

test("zone-aware cost estimate defaults to no cache savings", () => {
  const estimate = estimateZoneAwareInputCost({
    staticBlockTokens: 1000,
    stateLayerTokens: 500,
    dynamicInputTokens: 500,
    inputCostPerMillion: 10
  });

  assert.equal(estimate.cacheEligibleTokens, 1500);
  assert.equal(estimate.dynamicTokens, 500);
  assert.equal(estimate.totalTokens, 2000);
  assert.equal(estimate.cachedInputCostPerMillion, 10);
  assert.equal(estimate.expectedCacheHitRate, 0);
  assert.equal(estimate.uncachedCost, 0.02);
  assert.equal(estimate.cacheAdjustedCost, 0.02);
  assert.equal(estimate.estimatedSavings, 0);
});

test("zone-aware cost estimate applies cache hit rate only to prefix tokens", () => {
  const estimate = estimateZoneAwareInputCost({
    staticBlockTokens: 1000,
    stateLayerTokens: 1000,
    dynamicInputTokens: 1000,
    inputCostPerMillion: 10,
    cachedInputCostPerMillion: 1,
    expectedCacheHitRate: 0.5
  });

  assert.equal(estimate.cacheEligibleTokens, 2000);
  assert.equal(estimate.dynamicTokens, 1000);
  assert.equal(estimate.totalTokens, 3000);
  assert.equal(estimate.uncachedCost, 0.03);
  assert.equal(estimate.cacheAdjustedCost, 0.021);
  assert.ok(Math.abs(estimate.estimatedSavings - 0.009) < 0.000001);
});

test("computeMeasuredCost applies the default 1.25x cache-creation surcharge", () => {
  // 1M cache-creation tokens only, input price $10/M → creation rate $12.5/M.
  const r = computeMeasuredCost(
    { inputTokens: 0, cachedInputTokens: 0, cacheCreationTokens: 1_000_000, outputTokens: 0 },
    { inputCostPerMillion: 10, cachedInputCostPerMillion: 1 }
  );
  assert.equal(r.cacheCreationCost, 12.5);
  assert.equal(r.actualCost, 12.5);
  // baseline bills those tokens at full input price, no surcharge → $10.
  assert.equal(r.baselineCost, 10);
  // First/cache-creating call costs MORE than baseline — savings negative.
  assert.equal(r.savings, -2.5);
});

test("computeMeasuredCost rewards cache reads and honors explicit rates", () => {
  // 1M cache-read tokens at $1/M vs baseline $10/M.
  const r = computeMeasuredCost(
    { inputTokens: 0, cachedInputTokens: 1_000_000, cacheCreationTokens: 0, outputTokens: 500_000 },
    { inputCostPerMillion: 10, cachedInputCostPerMillion: 1, cacheCreationCostPerMillion: 12.5, outputCostPerMillion: 30 }
  );
  assert.equal(r.cachedReadCost, 1);
  assert.equal(r.outputCost, 15); // 0.5M * $30/M
  assert.equal(r.actualCost, 16); // cachedRead 1 + output 15
  assert.equal(r.baselineCost, 25); // input-equiv 10 + output 15
  assert.equal(r.savings, 9);
});

test("computeMeasuredCost excludes output from the savings delta (same on both sides)", () => {
  const withOutput = computeMeasuredCost(
    { inputTokens: 100, cachedInputTokens: 900, cacheCreationTokens: 0, outputTokens: 1000 },
    { inputCostPerMillion: 10, cachedInputCostPerMillion: 1, outputCostPerMillion: 30 }
  );
  const withoutOutput = computeMeasuredCost(
    { inputTokens: 100, cachedInputTokens: 900, cacheCreationTokens: 0, outputTokens: 0 },
    { inputCostPerMillion: 10, cachedInputCostPerMillion: 1, outputCostPerMillion: 30 }
  );
  assert.ok(Math.abs(withOutput.savings - withoutOutput.savings) < 1e-9);
});
