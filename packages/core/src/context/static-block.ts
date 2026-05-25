export interface StaticBlockInput {
  projectRules?: string;
  architectureNotes?: string;
  sourceSnapshot?: string;
  domainContext?: string;
}

export function buildStaticBlock(input: StaticBlockInput): string {
  const snapshotSection = input.domainContext
    ? ["## Domain Context (Lazy-Loaded)", input.domainContext]
    : ["## Source Snapshot", input.sourceSnapshot ?? "No source snapshot recorded yet."];

  return [
    "# Static Block",
    "This block should remain stable across requests to maximize provider prompt-cache reuse.",
    "## Project Rules",
    input.projectRules ?? "No project rules recorded yet.",
    "## Architecture Notes",
    input.architectureNotes ?? "No architecture notes recorded yet.",
    ...snapshotSection,
  ].join("\n\n");
}
