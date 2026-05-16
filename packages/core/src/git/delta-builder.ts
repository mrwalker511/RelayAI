import { getGitDiffSince } from "./diff.js";

export interface DeltaPromptInput {
  baseRef: string;
  userPrompt: string;
  cwd?: string;
}

export function buildDeltaPrompt(input: DeltaPromptInput): string {
  const diff = getGitDiffSince(input.baseRef, input.cwd);
  return [`# User Prompt`, input.userPrompt, `# Delta Since ${input.baseRef}`, diff || "No changes detected."].join("\n\n");
}
