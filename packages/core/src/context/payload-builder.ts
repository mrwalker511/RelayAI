import type { PromptZones, ZoneBuildInput } from "./zones.js";

export function buildPromptPayload(zones: PromptZones): string {
  return [
    `<STATIC_BLOCK>\n${zones.staticBlock}\n</STATIC_BLOCK>`,
    `<STATE_LAYER>\n${zones.stateLayer}\n</STATE_LAYER>`,
    `<DYNAMIC_INPUT>\n${zones.dynamicInput}\n</DYNAMIC_INPUT>`
  ].join("\n\n");
}

export function buildZones(input: ZoneBuildInput): PromptZones {
  return {
    staticBlock: [
      "# Project Rules",
      input.projectRules,
      "# Architecture Notes",
      input.architectureNotes,
      input.domainContext ? "# Domain Context (Lazy-Loaded)" : "# Source Snapshot",
      input.domainContext ?? input.sourceSnapshot,
    ].join("\n\n"),
    stateLayer: [
      "# Semantic State",
      input.semanticState,
      "# File Index",
      input.fileIndex
    ].join("\n\n"),
    dynamicInput: [
      `# Timestamp\n${input.timestampIso}`,
      `# User Prompt\n${input.userPrompt}`,
      `# Git Diff\n${input.gitDiff}`,
      input.runtimeOutput ? `# Runtime Output\n${input.runtimeOutput}` : ""
    ].filter(Boolean).join("\n\n")
  };
}
