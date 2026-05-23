import { listTrackedFiles } from "../git/tracked-files.js";

export interface SemanticState {
  active_target?: string;
  current_goal?: string;
  runtime_errors: string[];
  verified_hypotheses: string[];
  rejected_hypotheses: string[];
  next_actions: string[];
  code_changes: string[];
}

export function createEmptySemanticState(): SemanticState {
  return {
    runtime_errors: [],
    verified_hypotheses: [],
    rejected_hypotheses: [],
    next_actions: [],
    code_changes: []
  };
}

export function serializeSemanticState(state: SemanticState): string {
  return JSON.stringify(state, null, 2);
}

export interface TrimOptions {
  cwd?: string;
  maxCodeChanges?: number;
  maxNextActions?: number;
}

export function trimSemanticState(state: SemanticState, options: TrimOptions = {}): SemanticState {
  const { cwd, maxCodeChanges = 20, maxNextActions = 10 } = options;

  let codeChanges = state.code_changes ?? [];
  let nextActions = state.next_actions ?? [];

  if (cwd) {
    const tracked = new Set(listTrackedFiles(cwd));
    codeChanges = codeChanges.filter((entry) => {
      const match = entry.match(/[\w./\\-]+\.[a-z]+/g);
      return !match || match.some((f) => tracked.has(f));
    });
  }

  codeChanges = codeChanges.slice(-maxCodeChanges);
  nextActions = nextActions.slice(-maxNextActions);

  return { ...state, code_changes: codeChanges, next_actions: nextActions };
}
