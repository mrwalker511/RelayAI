import { z } from "zod";

export const RelayConfigSchema = z.object({
  provider: z.object({
    default: z.string().default("default"),
    commands: z.record(z.string(), z.array(z.string())).optional()
  }).default({ default: "default" }),
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
  }).default({})
});

export type RelayConfig = z.infer<typeof RelayConfigSchema>;

export const DEFAULT_RELAY_CONFIG: RelayConfig = RelayConfigSchema.parse({});
