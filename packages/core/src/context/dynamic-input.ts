import { estimateTokens } from "../tokens/tokenizer.js";
import type { TokenEstimateOptions } from "../tokens/tokenizer.js";
import { summarizeDiff } from "../git/diff.js";
import { filterOutput } from "../utils/output-filter.js";
import type { FilterOptions } from "../utils/output-filter.js";

export interface DynamicInputInput {
  prompt: string;
  gitDiff?: string;
  runtimeOutput?: string;
  timestampIso?: string;
  includeTimestamp?: boolean;
  diffMode?: "full" | "summarized" | "auto";
  diffTokenThreshold?: number;
  outputFilterOptions?: FilterOptions;
  /**
   * Prompt-selected hierarchical branches (volatile). Lives here, not in the
   * static block, so it never busts the cacheable prefix.
   */
  relevantContext?: string;
  tokenizerOptions?: TokenEstimateOptions;
}

export function buildDynamicInput(input: DynamicInputInput): string {
  const rawDiff = input.gitDiff ?? "No git diff provided.";
  const threshold = input.diffTokenThreshold ?? 8000;
  const mode = input.diffMode ?? "auto";

  let renderedDiff = rawDiff;
  const diffTokens = estimateTokens(rawDiff, input.tokenizerOptions).tokens;
  if (mode === "summarized" || (mode === "auto" && diffTokens > threshold)) {
    renderedDiff = `[diff summarized — ${diffTokens.toLocaleString()} tokens]\n` + summarizeDiff(rawDiff);
  }

  const filteredOutput = input.runtimeOutput
    ? filterOutput(input.runtimeOutput, input.outputFilterOptions)
    : null;

  return [
    "# Dynamic Input",
    input.includeTimestamp
      ? `## Timestamp\n${input.timestampIso ?? new Date().toISOString()}`
      : null,
    `## User Prompt\n${input.prompt}`,
    input.relevantContext ? `## Relevant Context\n${input.relevantContext}` : null,
    `## Git Diff\n${renderedDiff}`,
    filteredOutput ? `## Runtime Output\n${filteredOutput}` : null,
  ].filter(Boolean).join("\n\n");
}
