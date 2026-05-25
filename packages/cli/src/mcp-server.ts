import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readRelayWorkspace, summarizeContextHealth } from "@relay/core";
import { z } from "zod";

function jsonContent(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
  };
}

function zonedContent(snapshot: ReturnType<typeof readRelayWorkspace>) {
  type TextContentWithCache = { type: "text"; text: string; cache_control?: { type: string } };
  return {
    content: [
      { type: "text", text: snapshot.zones.staticBlock, cache_control: { type: "ephemeral" } } as TextContentWithCache,
      { type: "text", text: snapshot.zones.stateLayer, cache_control: { type: "ephemeral" } } as TextContentWithCache,
      { type: "text", text: snapshot.zones.dynamicInput } as TextContentWithCache,
    ],
  };
}

function clampMaxChars(value: number | undefined): number {
  if (value === undefined) return 120000;
  if (!Number.isFinite(value) || value < 0) return 120000;
  return Math.min(Math.floor(value), 500000);
}

function publicSession(snapshot: ReturnType<typeof readRelayWorkspace>) {
  return {
    exists: snapshot.session.exists,
    valid: snapshot.session.valid,
    error: snapshot.session.error,
    session_id: snapshot.session.session_id,
    base_git_sha: snapshot.session.base_git_sha,
    prefix_hash: snapshot.session.prefix_hash,
    created_at: snapshot.session.created_at,
    tracked_path_count: snapshot.session.tracked_path_count
  };
}

function publicBudget(snapshot: ReturnType<typeof readRelayWorkspace>) {
  return {
    tokens: snapshot.budget.tokens,
    status: snapshot.budget.status,
    message: snapshot.budget.message,
    warning_limit: snapshot.budget.warning_limit,
    confirmation_threshold: snapshot.budget.confirmation_threshold,
    hard_limit: snapshot.budget.hard_limit
  };
}

export function createRelayMcpServer(cwd?: string): McpServer {
  const resolveCwd = () => cwd ?? process.cwd();
  const server = new McpServer({
    name: "relay",
    version: "0.1.0"
  });

  server.registerTool(
    "get_prompt_payload",
    {
      title: "Get Relay Prompt Payload",
      description: "Use before coding tasks, debugging, code review, test planning, or repository explanations. Returns Relay's cache-friendly prompt payload built from stable project context, semantic state, git delta, and the user prompt.",
      inputSchema: z.object({
        prompt: z.string().min(1).describe("The user's task or question to place in Relay's dynamic input zone.")
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ prompt }) => {
      const snapshot = readRelayWorkspace({ cwd: resolveCwd(), prompt });
      const base = {
        blocked: snapshot.budget.status === "blocked",
        budget: publicBudget(snapshot),
        zones: snapshot.zone_tokens,
        prefix: snapshot.prefix,
        session: publicSession(snapshot),
        git: {
          base_ref: snapshot.git.base_ref,
          diff_present: snapshot.git.diff_present,
          diff_tokens: snapshot.git.diff_tokens
        }
      };

      return snapshot.budget.status === "blocked"
        ? jsonContent({ ...base, message: snapshot.budget.message })
        : zonedContent(snapshot);
    }
  );

  server.registerTool(
    "get_project_context",
    {
      title: "Get Relay Project Context",
      description: "Use when you need a concise overview of Relay's current project context, session metadata, semantic memory state, file index, prefix hash, and token budget without the full prompt payload.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      const snapshot = readRelayWorkspace({ cwd });
      return jsonContent({
        cwd: snapshot.cwd,
        relay_dir: snapshot.relay_dir,
        config: {
          valid: snapshot.config.valid,
          path: snapshot.config.path,
          error: snapshot.config.error
        },
        session: publicSession(snapshot),
        prefix: snapshot.prefix,
        state: {
          semantic_state_path: snapshot.state.semantic_state_path,
          exists: snapshot.state.exists,
          valid_json: snapshot.state.valid_json,
          error: snapshot.state.error,
          parsed: snapshot.state.parsed
        },
        files: {
          tracked_path_count: snapshot.files.tracked_path_count,
          included_path_count: snapshot.files.included_path_count,
          included_paths: snapshot.files.included_paths
        },
        zones: snapshot.zone_tokens,
        budget: publicBudget(snapshot),
        git: {
          base_ref: snapshot.git.base_ref,
          diff_present: snapshot.git.diff_present,
          diff_tokens: snapshot.git.diff_tokens
        }
      });
    }
  );

  server.registerTool(
    "get_git_delta",
    {
      title: "Get Relay Git Delta",
      description: "Use when you need the current diff since the Relay session base SHA. The result is read-only and may be truncated by max_chars.",
      inputSchema: z.object({
        max_chars: z.number().int().nonnegative().optional().describe("Maximum diff characters to return. Defaults to 120000 and is capped at 500000.")
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ max_chars: maxChars }) => {
      const snapshot = readRelayWorkspace({ cwd });
      const limit = clampMaxChars(maxChars);
      const diff = snapshot.git.diff;
      return jsonContent({
        base_ref: snapshot.git.base_ref,
        diff: diff.slice(0, limit),
        diff_tokens: snapshot.git.diff_tokens,
        truncated: diff.length > limit,
        original_chars: diff.length,
        returned_chars: Math.min(diff.length, limit)
      });
    }
  );

  server.registerTool(
    "get_semantic_state",
    {
      title: "Get Relay Semantic State",
      description: "Use when you need Relay's compacted memory: active target, current goal, known errors, hypotheses, next actions, and code changes.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      const snapshot = readRelayWorkspace({ cwd });
      return jsonContent({
        semantic_state_path: snapshot.state.semantic_state_path,
        exists: snapshot.state.exists,
        valid_json: snapshot.state.valid_json,
        error: snapshot.state.error,
        semantic_state: snapshot.state.parsed
      });
    }
  );

  server.registerTool(
    "get_token_budget",
    {
      title: "Get Relay Token Budget",
      description: "Use before large context requests or when deciding whether to compact Relay memory. Computes token usage for an optional prompt without sending anything to a provider.",
      inputSchema: z.object({
        prompt: z.string().optional().describe("Optional prompt to include in the dynamic input zone. Defaults to an inspect placeholder.")
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ prompt }) => {
      const snapshot = readRelayWorkspace({ cwd: resolveCwd(), prompt });
      return jsonContent({
        zones: snapshot.zone_tokens,
        budget: publicBudget(snapshot)
      });
    }
  );

  server.registerTool(
    "inspect_context_health",
    {
      title: "Inspect Relay Context Health",
      description: "Use when Relay context looks stale, too large, missing, or invalid. Returns actionable health findings for config, session, semantic state, prefix drift, token budget, and git delta.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      const snapshot = readRelayWorkspace({ cwd });
      return jsonContent({
        ...summarizeContextHealth(snapshot),
        session: publicSession(snapshot),
        budget: publicBudget(snapshot),
        git: {
          base_ref: snapshot.git.base_ref,
          diff_present: snapshot.git.diff_present,
          diff_tokens: snapshot.git.diff_tokens
        }
      });
    }
  );

  return server;
}

export async function runMcpServer(cwd?: string): Promise<void> {
  process.stderr.write(`[relay-mcp] starting in ${cwd ?? process.cwd()}\n`);
  try {
    await createRelayMcpServer(cwd).connect(new StdioServerTransport());
  } catch (err) {
    process.stderr.write(`[relay-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
