import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizePrefixStability,
  computeMeasuredSavings,
  projectSavingsFromHistory
} from "./savings.js";
import type { AuditEvent } from "./audit-log.js";

function ask(fields: Record<string, unknown>): AuditEvent {
  return { ts: "2026-01-01T00:00:00.000Z", event: "ask", session_id: "s1", v: 1, ...fields };
}

test("summarizePrefixStability excludes the first ask from the denominator", () => {
  const events = [
    ask({ prefix_stable: false }),
    ask({ prefix_stable: true }),
    ask({ prefix_stable: true }),
    ask({ prefix_stable: false })
  ];
  const s = summarizePrefixStability(events);
  assert.equal(s.asks, 4);
  assert.equal(s.stableAsks, 2);
  assert.equal(s.firstCall, false);
  assert.ok(Math.abs(s.stabilityRate - 2 / 3) < 1e-9);
});

test("summarizePrefixStability reports firstCall and 0 rate for a single ask", () => {
  const s = summarizePrefixStability([ask({ prefix_stable: false })]);
  assert.equal(s.asks, 1);
  assert.equal(s.firstCall, true);
  assert.equal(s.stabilityRate, 0);
});

test("computeMeasuredSavings aggregates recorded usage across ask and usage events", () => {
  const events: AuditEvent[] = [
    ask({ usage_source: "provider", usage_input_tokens: 100, usage_cached_input_tokens: 0, usage_cache_creation_tokens: 1_000_000, usage_output_tokens: 0 }),
    { ts: "t", event: "usage", session_id: "s1", v: 1, usage_source: "manual", usage_input_tokens: 0, usage_cached_input_tokens: 1_000_000, usage_cache_creation_tokens: 0, usage_output_tokens: 0 }
  ];
  const r = computeMeasuredSavings(events, { inputCostPerMillion: 10, cachedInputCostPerMillion: 1 });
  assert.equal(r.callsWithUsage, 2);
  assert.equal(r.totalCacheCreationTokens, 1_000_000);
  assert.equal(r.totalCachedInputTokens, 1_000_000);
  // creation 1M @ 12.5 + input 100 @ 10/M + cached 1M @ 1 = 12.5 + 0.001 + 1 = 13.501
  assert.ok(Math.abs(r.actualCost - 13.501) < 1e-6);
  // baseline: (100 + 1M + 1M) @ 10/M = 20.001
  assert.ok(Math.abs(r.baselineCost - 20.001) < 1e-6);
  assert.ok(Math.abs(r.savings - 6.5) < 1e-6);
});

test("computeMeasuredSavings ignores events without usage", () => {
  const r = computeMeasuredSavings([ask({ prefix_stable: true })], { inputCostPerMillion: 10, cachedInputCostPerMillion: 1 });
  assert.equal(r.callsWithUsage, 0);
  assert.equal(r.savings, 0);
});

test("projectSavingsFromHistory uses the measured stability rate as the cache hit rate", () => {
  const events = [
    ask({ prefix_stable: false, static_block_tokens: 1000, state_layer_tokens: 1000, dynamic_input_tokens: 500 }),
    ask({ prefix_stable: true, static_block_tokens: 1000, state_layer_tokens: 1000, dynamic_input_tokens: 500 })
  ];
  const p = projectSavingsFromHistory(events, { inputCostPerMillion: 10, cachedInputCostPerMillion: 1 });
  assert.equal(p.stabilityRate, 1); // 1 stable of (2-1)
  assert.equal(p.avgStaticBlockTokens, 1000);
  assert.equal(p.estimate.expectedCacheHitRate, 1);
  assert.ok(p.estimate.estimatedSavings > 0);
});

test("projectSavingsFromHistory with no zone-token asks returns zero avg tokens", () => {
  const events = [ask({ prefix_stable: false }), ask({ prefix_stable: true })];
  const p = projectSavingsFromHistory(events, { inputCostPerMillion: 10, cachedInputCostPerMillion: 1 });
  assert.equal(p.callsWithZoneTokens, 0);
  assert.equal(p.avgStaticBlockTokens, 0);
  assert.equal(p.avgStateLayerTokens, 0);
  assert.equal(p.avgDynamicInputTokens, 0);
});

test("computeMeasuredSavings exposes cost breakdown fields", () => {
  const events: AuditEvent[] = [
    ask({ usage_source: "provider", usage_input_tokens: 1_000_000, usage_cached_input_tokens: 0, usage_cache_creation_tokens: 0, usage_output_tokens: 1_000_000 })
  ];
  const r = computeMeasuredSavings(events, { inputCostPerMillion: 10, cachedInputCostPerMillion: 1, outputCostPerMillion: 5 });
  assert.ok(Math.abs(r.inputCost - 10) < 1e-6);
  assert.equal(r.cachedReadCost, 0);
  assert.equal(r.cacheCreationCost, 0);
  assert.ok(Math.abs(r.outputCost - 5) < 1e-6);
});

test("computeMeasuredSavings filters by sessionId", () => {
  const s2ask = { ts: "2026-01-01T00:00:00.000Z", event: "ask" as const, session_id: "s2", v: 1 as const,
    usage_source: "provider", usage_input_tokens: 500_000, usage_cached_input_tokens: 0,
    usage_cache_creation_tokens: 0, usage_output_tokens: 0 };
  const events: AuditEvent[] = [
    ask({ usage_source: "provider", usage_input_tokens: 1_000_000, usage_cached_input_tokens: 0, usage_cache_creation_tokens: 0, usage_output_tokens: 0 }),
    s2ask
  ];
  const r = computeMeasuredSavings(events, { inputCostPerMillion: 10, cachedInputCostPerMillion: 1 }, "s2");
  assert.equal(r.callsWithUsage, 1);
  assert.equal(r.totalInputTokens, 500_000);
});
