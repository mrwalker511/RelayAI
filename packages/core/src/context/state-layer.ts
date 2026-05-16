export interface StateLayerInput {
  semanticStateJson?: string;
  fileIndex?: string;
  sessionSummary?: string;
}

export function buildStateLayer(input: StateLayerInput): string {
  return [
    "# State Layer",
    "This block should remain structured and predictably ordered.",
    "## Semantic State",
    input.semanticStateJson ?? "{}",
    "## File Index",
    input.fileIndex ?? "No file index recorded yet.",
    "## Session Summary",
    input.sessionSummary ?? "No session summary recorded yet."
  ].join("\n\n");
}
