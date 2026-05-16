export interface DynamicInputInput {
  prompt: string;
  gitDiff?: string;
  runtimeOutput?: string;
  timestampIso?: string;
}

export function buildDynamicInput(input: DynamicInputInput): string {
  return [
    "# Dynamic Input",
    `## Timestamp\n${input.timestampIso ?? new Date().toISOString()}`,
    `## User Prompt\n${input.prompt}`,
    `## Git Diff\n${input.gitDiff ?? "No git diff provided."}`,
    input.runtimeOutput ? `## Runtime Output\n${input.runtimeOutput}` : ""
  ].filter(Boolean).join("\n\n");
}
