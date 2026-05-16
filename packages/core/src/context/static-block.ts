export interface StaticBlockInput {
  projectRules?: string;
  architectureNotes?: string;
  sourceSnapshot?: string;
}

export function buildStaticBlock(input: StaticBlockInput): string {
  return [
    "# Static Block",
    "This block should remain stable across requests to maximize provider prompt-cache reuse.",
    "## Project Rules",
    input.projectRules ?? "No project rules recorded yet.",
    "## Architecture Notes",
    input.architectureNotes ?? "No architecture notes recorded yet.",
    "## Source Snapshot",
    input.sourceSnapshot ?? "No source snapshot recorded yet."
  ].join("\n\n");
}
