import type { SemanticState } from "./semantic-state.js";

export interface CompactionResult {
  semanticState: SemanticState;
  compactedMarkdown: string;
  originalApproxTokens: number;
  compactedApproxTokens: number;
}

export function compactHistoryToState(rawHistory: string, existingState: SemanticState): CompactionResult {
  const compactedMarkdown = [
    "# Compacted Session Summary",
    "This is a placeholder deterministic compaction routine.",
    "A production implementation should use local heuristics first and optional model-assisted compaction second.",
    "",
    rawHistory.slice(-4000)
  ].join("\n");

  return {
    semanticState: existingState,
    compactedMarkdown,
    originalApproxTokens: Math.ceil(rawHistory.length / 4),
    compactedApproxTokens: Math.ceil(compactedMarkdown.length / 4)
  };
}
