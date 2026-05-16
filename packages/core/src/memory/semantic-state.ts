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
