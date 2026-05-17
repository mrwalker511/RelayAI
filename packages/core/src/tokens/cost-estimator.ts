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
