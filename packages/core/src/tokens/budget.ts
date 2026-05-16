import { estimateTokens } from "./tokenizer.js";

export interface TokenBudgetConfig {
  hardLimit: number;
  warningLimit: number;
  requireConfirmationAbove: number;
}

export interface BudgetCheckResult {
  tokens: number;
  status: "ok" | "warning" | "requires_confirmation" | "blocked";
  message: string;
}

export function checkTokenBudget(payload: string, config: TokenBudgetConfig): BudgetCheckResult {
  const { tokens } = estimateTokens(payload);

  if (tokens > config.hardLimit) {
    return { tokens, status: "blocked", message: `Payload exceeds hard limit of ${config.hardLimit} tokens.` };
  }

  if (tokens > config.requireConfirmationAbove) {
    return { tokens, status: "requires_confirmation", message: "Payload requires confirmation before transmission." };
  }

  if (tokens > config.warningLimit) {
    return { tokens, status: "warning", message: "Payload exceeds warning limit." };
  }

  return { tokens, status: "ok", message: "Payload is within token budget." };
}
