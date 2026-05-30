import { getEncoding } from "js-tiktoken";

export interface TokenEstimate {
  tokens: number;
  tokenizer: string;
}

export interface TokenEstimateOptions {
  provider?: string;
  model?: string;
  /** Overrides the provider-derived correction factor when set. */
  correctionFactor?: number;
}

type EncodingName = "cl100k_base" | "o200k_base";

/**
 * Claude does not publish an offline tokenizer, and `@anthropic-ai/sdk`'s
 * `countTokens` is a network call that this offline-first tool must not make.
 * `cl100k_base` is the closest widely-available proxy, but Claude's tokenizer
 * empirically emits modestly MORE tokens than GPT for the same English/code
 * text — observed in the ~10-20% range depending on content. We multiply the
 * base count by 1.15 (mid-band, deliberately slightly conservative) so budget
 * checks fail safe (warn/block a little early rather than silently overrun a
 * real context window). This is an estimate, not ground truth, so it is
 * overridable via `opts.correctionFactor` or the RELAY_CLAUDE_TOKEN_FACTOR env var.
 */
export const CLAUDE_TOKEN_CORRECTION_FACTOR = 1.15;

const _encoders = new Map<EncodingName, ReturnType<typeof getEncoding> | null>();

function getEncoder(name: EncodingName): ReturnType<typeof getEncoding> | null {
  if (!_encoders.has(name)) {
    try {
      _encoders.set(name, getEncoding(name));
    } catch {
      _encoders.set(name, null);
    }
  }
  return _encoders.get(name) ?? null;
}

function isNewerOpenAiModel(model: string): boolean {
  return /^(gpt-4o|gpt-4\.1|o1|o3|o4)/.test(model);
}

function isClaudeModel(model: string): boolean {
  return /^claude/.test(model);
}

function selectEncoding(provider: string, model: string): EncodingName {
  if ((provider === "openai" || provider === "copilot") && isNewerOpenAiModel(model)) {
    return "o200k_base";
  }
  return "cl100k_base";
}

function resolveClaudeFactor(opts: TokenEstimateOptions): number {
  if (typeof opts.correctionFactor === "number") return opts.correctionFactor;
  const fromEnv = Number(process.env.RELAY_CLAUDE_TOKEN_FACTOR);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return CLAUDE_TOKEN_CORRECTION_FACTOR;
}

export function estimateTokens(text: string, opts: TokenEstimateOptions = {}): TokenEstimate {
  const provider = (opts.provider ?? "").toLowerCase();
  const model = (opts.model ?? "").toLowerCase();
  const encodingName = selectEncoding(provider, model);
  const enc = getEncoder(encodingName);

  if (!enc) {
    return { tokens: Math.ceil(text.length / 4), tokenizer: "char_div_4_fallback" };
  }

  const baseTokens = enc.encode(text).length;

  // Claude (native Anthropic, or a Claude model routed through Copilot) is
  // estimated from the base encoding with an empirical correction factor.
  const claudeRequested =
    provider === "anthropic" || (provider === "copilot" && isClaudeModel(model));
  if (claudeRequested) {
    const factor = resolveClaudeFactor(opts);
    if (factor !== 1) {
      return { tokens: Math.ceil(baseTokens * factor), tokenizer: `${encodingName}*claude_factor` };
    }
  }

  return { tokens: baseTokens, tokenizer: encodingName };
}
