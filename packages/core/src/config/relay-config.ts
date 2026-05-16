import { z } from "zod";

export const RelayConfigSchema = z.object({
  provider: z.object({
    default: z.enum(["codex", "claude", "copilot", "raw-openai", "raw-anthropic"]).default("codex")
  }).default({ default: "codex" }),
  gc: z.object({
    enabled: z.boolean().default(true),
    historyTokenLimit: z.number().int().positive().default(12000),
    targetSummaryTokens: z.number().int().positive().default(500),
    preserveErrors: z.boolean().default(true),
    preserveDecisions: z.boolean().default(true),
    preserveCodeChanges: z.boolean().default(true)
  }).default({}),
  tokens: z.object({
    provider: z.string().default("openai"),
    model: z.string().default("gpt-4.1"),
    hardLimit: z.number().int().positive().default(100000),
    warningLimit: z.number().int().positive().default(50000),
    requireConfirmationAbove: z.number().int().positive().default(75000)
  }).default({})
});

export type RelayConfig = z.infer<typeof RelayConfigSchema>;

export const DEFAULT_RELAY_CONFIG: RelayConfig = RelayConfigSchema.parse({});
