export interface CostEstimateInput {
  inputTokens: number;
  inputCostPerMillion: number;
  cachedInputCostPerMillion?: number;
  expectedCacheHitRate?: number;
}

export interface ZoneAwareCostEstimateInput {
  staticBlockTokens: number;
  stateLayerTokens: number;
  dynamicInputTokens: number;
  inputCostPerMillion: number;
  cachedInputCostPerMillion?: number;
  expectedCacheHitRate?: number;
}

export interface ZoneAwareCostEstimate {
  inputCostPerMillion: number;
  cachedInputCostPerMillion: number;
  expectedCacheHitRate: number;
  cacheEligibleTokens: number;
  dynamicTokens: number;
  totalTokens: number;
  uncachedCost: number;
  cacheAdjustedCost: number;
  estimatedSavings: number;
}

export function estimateInputCost(input: CostEstimateInput): number {
  const hitRate = input.expectedCacheHitRate ?? 0;
  const cachedTokens = input.inputTokens * hitRate;
  const uncachedTokens = input.inputTokens - cachedTokens;
  const uncachedCost = (uncachedTokens / 1_000_000) * input.inputCostPerMillion;
  const cachedCost = (cachedTokens / 1_000_000) * (input.cachedInputCostPerMillion ?? input.inputCostPerMillion);
  return uncachedCost + cachedCost;
}

export interface MeasuredUsage {
  /** Full-price (uncached) input tokens actually billed. */
  inputTokens: number;
  /** Cache-read input tokens (billed at the cached rate). */
  cachedInputTokens: number;
  /** Tokens written to the cache on this call (billed with a surcharge). */
  cacheCreationTokens: number;
  outputTokens: number;
}

export interface MeasuredPricing {
  inputCostPerMillion: number;
  cachedInputCostPerMillion: number;
  /** Defaults to inputCostPerMillion * 1.25 (Anthropic's cache-write surcharge). */
  cacheCreationCostPerMillion?: number;
  /** Defaults to 0 (output excluded from savings unless a rate is supplied). */
  outputCostPerMillion?: number;
}

export interface MeasuredCostResult {
  actualCost: number;
  /** No-cache baseline: every input token at full price, same output, no surcharge. */
  baselineCost: number;
  savings: number;
  inputCost: number;
  cachedReadCost: number;
  cacheCreationCost: number;
  outputCost: number;
}

const perMillion = (tokens: number, rate: number): number => (tokens / 1_000_000) * rate;

/**
 * Compute ACTUAL cost from measured provider usage, including the cache-creation
 * surcharge and (optionally) output tokens, versus a no-cache baseline where the
 * same input tokens are billed at full price on every call.
 *
 * Note: on the FIRST call (which creates the cache) `savings` can be negative,
 * because cache-write costs more than a plain input token. Savings accrue across
 * repeat calls, so the honest figure is the session aggregate.
 */
export function computeMeasuredCost(usage: MeasuredUsage, pricing: MeasuredPricing): MeasuredCostResult {
  const creationRate = pricing.cacheCreationCostPerMillion ?? pricing.inputCostPerMillion * 1.25;
  const outputRate = pricing.outputCostPerMillion ?? 0;

  const inputCost = perMillion(usage.inputTokens, pricing.inputCostPerMillion);
  const cachedReadCost = perMillion(usage.cachedInputTokens, pricing.cachedInputCostPerMillion);
  const cacheCreationCost = perMillion(usage.cacheCreationTokens, creationRate);
  const outputCost = perMillion(usage.outputTokens, outputRate);
  const actualCost = inputCost + cachedReadCost + cacheCreationCost + outputCost;

  const baselineInputTokens = usage.inputTokens + usage.cachedInputTokens + usage.cacheCreationTokens;
  const baselineCost = perMillion(baselineInputTokens, pricing.inputCostPerMillion) + outputCost;

  return {
    actualCost,
    baselineCost,
    savings: baselineCost - actualCost,
    inputCost,
    cachedReadCost,
    cacheCreationCost,
    outputCost
  };
}

export function estimateZoneAwareInputCost(input: ZoneAwareCostEstimateInput): ZoneAwareCostEstimate {
  const cacheEligibleTokens = input.staticBlockTokens + input.stateLayerTokens;
  const dynamicTokens = input.dynamicInputTokens;
  const totalTokens = cacheEligibleTokens + dynamicTokens;
  const cachedInputCostPerMillion = input.cachedInputCostPerMillion ?? input.inputCostPerMillion;
  const expectedCacheHitRate = input.expectedCacheHitRate ?? 0;
  const cachedPrefixTokens = cacheEligibleTokens * expectedCacheHitRate;
  const uncachedPrefixTokens = cacheEligibleTokens - cachedPrefixTokens;
  const uncachedCost = (totalTokens / 1_000_000) * input.inputCostPerMillion;
  const cacheAdjustedCost =
    ((uncachedPrefixTokens + dynamicTokens) / 1_000_000) * input.inputCostPerMillion +
    (cachedPrefixTokens / 1_000_000) * cachedInputCostPerMillion;

  return {
    inputCostPerMillion: input.inputCostPerMillion,
    cachedInputCostPerMillion,
    expectedCacheHitRate,
    cacheEligibleTokens,
    dynamicTokens,
    totalTokens,
    uncachedCost,
    cacheAdjustedCost,
    estimatedSavings: uncachedCost - cacheAdjustedCost
  };
}
