export interface PromptZones {
  staticBlock: string;
  stateLayer: string;
  dynamicInput: string;
}

export interface ZoneBuildInput {
  projectRules: string;
  architectureNotes: string;
  sourceSnapshot: string;
  domainContext?: string;
  semanticState: string;
  fileIndex: string;
  userPrompt: string;
  gitDiff: string;
  runtimeOutput?: string;
  timestampIso: string;
}
