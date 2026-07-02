import type { AuditEvent } from "./audit-log.js";
import { filterAuditLog } from "./audit-log.js";
import {
  computeMeasuredCost,
  estimateZoneAwareInputCost
} from "../tokens/cost-estimator.js";
import type { MeasuredPricing, ZoneAwareCostEstimate } from "../tokens/cost-estimator.js";

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export interface PrefixStabilitySummary {
  asks: number;
  stableAsks: number;
  firstCall: boolean;
  /** stableAsks / (asks - 1); 0 when there is at most one ask. */
  stabilityRate: number;
}

export function summarizePrefixStability(events: AuditEvent[], sessionId?: string): PrefixStabilitySummary {
  const asks = filterAuditLog(events, { event: "ask", session_id: sessionId });
  const total = asks.length;
  const stableAsks = asks.filter((e) => e.prefix_stable === true).length;
  return {
    asks: total,
    stableAsks,
    firstCall: total <= 1,
    stabilityRate: total > 1 ? stableAsks / (total - 1) : 0
  };
}

export interface MeasuredSavingsResult {
  callsWithUsage: number;
  totalInputTokens: number;
  totalCachedInputTokens: number;
  totalCacheCreationTokens: number;
  totalOutputTokens: number;
  actualCost: number;
  baselineCost: number;
  savings: number;
  inputCost: number;
  cachedReadCost: number;
  cacheCreationCost: number;
  outputCost: number;
}

/**
 * Aggregate recorded provider/manual usage into MEASURED cost and savings.
 * Summing tokens then costing is equivalent to costing per call then summing
 * (cost is linear in tokens), so the aggregate is exact.
 */
export function computeMeasuredSavings(
  events: AuditEvent[],
  pricing: MeasuredPricing,
  sessionId?: string
): MeasuredSavingsResult {
  const candidates = events.filter((e) => {
    if (sessionId && e.session_id !== sessionId) return false;
    if (e.usage_source === undefined) return false;
    return e.event === "ask" || e.event === "usage";
  });

  let totalInputTokens = 0;
  let totalCachedInputTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalOutputTokens = 0;
  for (const e of candidates) {
    totalInputTokens += asNumber(e.usage_input_tokens) ?? 0;
    totalCachedInputTokens += asNumber(e.usage_cached_input_tokens) ?? 0;
    totalCacheCreationTokens += asNumber(e.usage_cache_creation_tokens) ?? 0;
    totalOutputTokens += asNumber(e.usage_output_tokens) ?? 0;
  }

  const cost = computeMeasuredCost(
    {
      inputTokens: totalInputTokens,
      cachedInputTokens: totalCachedInputTokens,
      cacheCreationTokens: totalCacheCreationTokens,
      outputTokens: totalOutputTokens
    },
    pricing
  );

  return {
    callsWithUsage: candidates.length,
    totalInputTokens,
    totalCachedInputTokens,
    totalCacheCreationTokens,
    totalOutputTokens,
    actualCost: cost.actualCost,
    baselineCost: cost.baselineCost,
    savings: cost.savings,
    inputCost: cost.inputCost,
    cachedReadCost: cost.cachedReadCost,
    cacheCreationCost: cost.cacheCreationCost,
    outputCost: cost.outputCost
  };
}

export interface ProjectedSavingsResult {
  stabilityRate: number;
  callsWithZoneTokens: number;
  avgStaticBlockTokens: number;
  avgStateLayerTokens: number;
  avgDynamicInputTokens: number;
  estimate: ZoneAwareCostEstimate;
}

/**
 * Project per-call savings from history: average the recorded zone tokens and
 * feed the MEASURED prefix-stability rate into the zone estimator as the cache
 * hit rate. This is explicitly a projection, not a measurement.
 */
export function projectSavingsFromHistory(
  events: AuditEvent[],
  pricing: { inputCostPerMillion: number; cachedInputCostPerMillion?: number },
  sessionId?: string
): ProjectedSavingsResult {
  const stability = summarizePrefixStability(events, sessionId);
  const asks = filterAuditLog(events, { event: "ask", session_id: sessionId }).filter(
    (e) => asNumber(e.static_block_tokens) !== undefined
  );

  const n = asks.length;
  const avg = (key: string): number =>
    n === 0 ? 0 : Math.round(asks.reduce((sum, e) => sum + (asNumber(e[key]) ?? 0), 0) / n);

  const avgStaticBlockTokens = avg("static_block_tokens");
  const avgStateLayerTokens = avg("state_layer_tokens");
  const avgDynamicInputTokens = avg("dynamic_input_tokens");

  const estimate = estimateZoneAwareInputCost({
    staticBlockTokens: avgStaticBlockTokens,
    stateLayerTokens: avgStateLayerTokens,
    dynamicInputTokens: avgDynamicInputTokens,
    inputCostPerMillion: pricing.inputCostPerMillion,
    cachedInputCostPerMillion: pricing.cachedInputCostPerMillion,
    expectedCacheHitRate: stability.stabilityRate
  });

  return {
    stabilityRate: stability.stabilityRate,
    callsWithZoneTokens: n,
    avgStaticBlockTokens,
    avgStateLayerTokens,
    avgDynamicInputTokens,
    estimate
  };
}
