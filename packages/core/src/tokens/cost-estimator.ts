export interface CostEstimateInput {
  inputTokens: number;
  inputCostPerMillion: number;
  cachedInputCostPerMillion?: number;
  expectedCacheHitRate?: number;
}

export function estimateInputCost(input: CostEstimateInput): number {
  const hitRate = input.expectedCacheHitRate ?? 0;
  const cachedTokens = input.inputTokens * hitRate;
  const uncachedTokens = input.inputTokens - cachedTokens;
  const uncachedCost = (uncachedTokens / 1_000_000) * input.inputCostPerMillion;
  const cachedCost = (cachedTokens / 1_000_000) * (input.cachedInputCostPerMillion ?? input.inputCostPerMillion);
  return uncachedCost + cachedCost;
}
