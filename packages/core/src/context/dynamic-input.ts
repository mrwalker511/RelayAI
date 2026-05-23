import { estimateTokens } from "../tokens/tokenizer.js";
import { summarizeDiff } from "../git/diff.js";

export interface DynamicInputInput {
  prompt: string;
  gitDiff?: string;
  runtimeOutput?: string;
  timestampIso?: string;
  includeTimestamp?: boolean;
  diffMode?: "full" | "summarized" | "auto";
  diffTokenThreshold?: number;
}

export function buildDynamicInput(input: DynamicInputInput): string {
  const rawDiff = input.gitDiff ?? "No git diff provided.";
  const threshold = input.diffTokenThreshold ?? 8000;
  const mode = input.diffMode ?? "auto";

  let renderedDiff = rawDiff;
  const diffTokens = estimateTokens(rawDiff).tokens;
  if (mode === "summarized" || (mode === "auto" && diffTokens > threshold)) {
    renderedDiff = `[diff summarized — ${diffTokens.toLocaleString()} tokens]\n` + summarizeDiff(rawDiff);
  }

  return [
    "# Dynamic Input",
    input.includeTimestamp
      ? `## Timestamp\n${input.timestampIso ?? new Date().toISOString()}`
      : null,
    `## User Prompt\n${input.prompt}`,
    `## Git Diff\n${renderedDiff}`,
    input.runtimeOutput ? `## Runtime Output\n${input.runtimeOutput}` : null,
  ].filter(Boolean).join("\n\n");
}
