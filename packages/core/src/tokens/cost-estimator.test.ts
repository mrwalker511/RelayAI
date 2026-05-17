import test from "node:test";
import assert from "node:assert/strict";
import { estimateZoneAwareInputCost } from "./cost-estimator.js";

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
