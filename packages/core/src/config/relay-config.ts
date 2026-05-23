import { z } from "zod";

export const RelayConfigSchema = z.object({
  provider: z.object({
    default: z.string().default("default"),
    commands: z.record(z.string(), z.array(z.string())).optional()
  }).default({ default: "default" }),
  routing: z.object({
    ask: z.string().optional(),
    gc: z.string().optional(),
    diff: z.string().optional(),
    summarize: z.string().optional()
  }).default({}),
  gc: z.object({
    enabled: z.boolean().default(true),
    command: z.array(z.string()).optional(),
    historyTokenLimit: z.number().int().positive().default(12000),
    targetSummaryTokens: z.number().int().positive().default(500),
    preserveErrors: z.boolean().default(true),
    preserveDecisions: z.boolean().default(true),
    preserveCodeChanges: z.boolean().default(true)
  }).default({}),
  tokens: z.object({
    provider: z.string().default("generic"),
    model: z.string().default("default"),
    hardLimit: z.number().int().positive().default(100000),
    warningLimit: z.number().int().positive().default(50000),
    requireConfirmationAbove: z.number().int().positive().default(75000)
  }).default({}),
  files: z.object({
    maxIndex: z.number().int().positive().default(200)
  }).default({})
});

export type RelayConfig = z.infer<typeof RelayConfigSchema>;

export const DEFAULT_RELAY_CONFIG: RelayConfig = RelayConfigSchema.parse({});

export const KNOWN_CONTEXT_WINDOWS: Record<string, Record<string, number>> = {
  anthropic: {
    "claude-3-5-sonnet": 200000,
    "claude-3-5-haiku": 200000,
    "claude-3-opus": 200000,
    "claude-3-haiku": 200000,
    "claude-sonnet-4": 200000,
    "claude-opus-4": 200000
  },
  openai: {
    "gpt-4o": 128000,
    "gpt-4o-mini": 128000,
    "gpt-4-turbo": 128000,
    "gpt-4.1": 128000,
    "o1": 200000,
    "o3": 200000,
    "o4-mini": 200000
  },
  copilot: {
    "gpt-4o": 128000,
    "gpt-4.1": 128000,
    "o3": 200000,
    "o4-mini": 200000,
    "claude-3-5-sonnet": 200000,
    "claude-sonnet-4": 200000,
    default: 128000
  },
  ollama: {
    "llama3.3": 128000,
    "llama3.1": 32000,
    "llama3.2": 16000,
    "llama3": 8000,
    "mistral": 32000,
    "mistral-nemo": 32000,
    "mixtral": 32000,
    "qwen2.5": 32000,
    "qwen2.5-coder": 128000,
    "deepseek-coder-v2": 128000,
    "deepseek-r1": 128000,
    "phi4": 16000,
    "phi3": 4000,
    "codellama": 16000,
    "gemma3": 32000,
    default: 32000
  }
};

const SCHEMA_DEFAULTS = { hardLimit: 100000, warningLimit: 50000, requireConfirmationAbove: 75000 };

export function resolveTokenBudget(config: RelayConfig): RelayConfig["tokens"] {
  const { provider, model } = config.tokens;
  const providerMap = KNOWN_CONTEXT_WINDOWS[provider.toLowerCase()];
  const windowSize = providerMap?.[model.toLowerCase()] ?? providerMap?.["default"];

  if (!windowSize) return config.tokens;

  const hardLimit = Math.floor(windowSize * 0.85);
  const warningLimit = Math.floor(windowSize * 0.5);
  const requireConfirmationAbove = Math.floor(windowSize * 0.7);

  return {
    ...config.tokens,
    hardLimit: config.tokens.hardLimit === SCHEMA_DEFAULTS.hardLimit ? hardLimit : config.tokens.hardLimit,
    warningLimit: config.tokens.warningLimit === SCHEMA_DEFAULTS.warningLimit ? warningLimit : config.tokens.warningLimit,
    requireConfirmationAbove:
      config.tokens.requireConfirmationAbove === SCHEMA_DEFAULTS.requireConfirmationAbove
        ? requireConfirmationAbove
        : config.tokens.requireConfirmationAbove
  };
}
