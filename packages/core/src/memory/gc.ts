import { spawn } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import type { SemanticState } from "./semantic-state.js";

export interface CompactionResult {
  semanticState: SemanticState;
  compactedMarkdown: string;
  originalApproxTokens: number;
  compactedApproxTokens: number;
}

interface RawExtracted {
  active_target: string | null;
  current_goal: string | null;
  runtime_errors: string[];
  verified_hypotheses: string[];
  rejected_hypotheses: string[];
  next_actions: string[];
  code_changes: string[];
}

const SEMANTIC_STATE_JSON_SCHEMA = {
  type: "object",
  properties: {
    active_target: { anyOf: [{ type: "string" }, { type: "null" }] },
    current_goal: { anyOf: [{ type: "string" }, { type: "null" }] },
    runtime_errors: { type: "array", items: { type: "string" } },
    verified_hypotheses: { type: "array", items: { type: "string" } },
    rejected_hypotheses: { type: "array", items: { type: "string" } },
    next_actions: { type: "array", items: { type: "string" } },
    code_changes: { type: "array", items: { type: "string" } },
  },
  required: ["active_target", "current_goal", "runtime_errors", "verified_hypotheses", "rejected_hypotheses", "next_actions", "code_changes"],
  additionalProperties: false,
} as const;

// Stable system prompt — cached prefix so repeated GC runs skip re-processing it
const GC_SYSTEM_PROMPT =
  "Extract structured session state from coding session history. " +
  "Merge with the existing state: preserve verified_hypotheses and code_changes unless clearly superseded. " +
  "Use null for unknown string fields, empty arrays for unknown array fields.";

async function compactViaApi(rawHistory: string, existingState: SemanticState): Promise<RawExtracted> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: GC_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content:
          `Existing state:\n${JSON.stringify(existingState, null, 2)}\n\n` +
          `Session history to compact:\n${rawHistory}`,
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: SEMANTIC_STATE_JSON_SCHEMA,
      },
    },
  });

  const textBlock = response.content.find(b => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("GC API returned no text content");
  return JSON.parse(textBlock.text) as RawExtracted;
}

async function shellCapture(command: string, args: string[], stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("exit", (code, signal) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString("utf8").trim());
      else if (signal) reject(new Error(`'${command}' was killed by signal ${signal}`));
      else reject(new Error(`'${command}' exited with code ${code}`));
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT")
        reject(new Error(`'${command}' not found in PATH — ensure the Claude CLI is installed and authenticated.`));
      else reject(err);
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

async function compactViaCli(rawHistory: string, existingState: SemanticState): Promise<RawExtracted> {
  const prompt =
    `Extract structured session state from this coding session history. Return ONLY valid JSON — no markdown fences, no explanation.\n\n` +
    `Schema: { "active_target": string|null, "current_goal": string|null, "runtime_errors": string[], ` +
    `"verified_hypotheses": string[], "rejected_hypotheses": string[], "next_actions": string[], "code_changes": string[] }\n\n` +
    `Existing state:\n${JSON.stringify(existingState, null, 2)}\n\nSession history:\n${rawHistory}`;

  const raw = await shellCapture("claude", ["--print"], prompt);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`GC model returned no valid JSON.\nRaw output:\n${raw.slice(0, 500)}`);
  try {
    return JSON.parse(jsonMatch[0]) as RawExtracted;
  } catch {
    throw new Error(`GC model returned malformed JSON.\nMatched:\n${jsonMatch[0].slice(0, 500)}`);
  }
}

function buildSemanticState(parsed: RawExtracted): SemanticState {
  return {
    active_target: parsed.active_target ?? undefined,
    current_goal: parsed.current_goal ?? undefined,
    runtime_errors: parsed.runtime_errors ?? [],
    verified_hypotheses: parsed.verified_hypotheses ?? [],
    rejected_hypotheses: parsed.rejected_hypotheses ?? [],
    next_actions: parsed.next_actions ?? [],
    code_changes: parsed.code_changes ?? [],
  };
}

export async function compactHistoryToState(rawHistory: string, existingState: SemanticState): Promise<CompactionResult> {
  // Use the Anthropic API directly when a key is available (structured outputs + prompt caching).
  // Fall back to the Claude CLI for users who rely on `claude auth` rather than a raw API key.
  const parsed = process.env.ANTHROPIC_API_KEY
    ? await compactViaApi(rawHistory, existingState)
    : await compactViaCli(rawHistory, existingState);

  const semanticState = buildSemanticState(parsed);

  const lines = [
    "# Compacted Session",
    "",
    `**Goal:** ${semanticState.current_goal ?? "—"}`,
    `**Target:** ${semanticState.active_target ?? "—"}`,
  ];
  if (semanticState.next_actions.length > 0) {
    lines.push("", "**Next actions:**", ...semanticState.next_actions.map(a => `- ${a}`));
  }
  const compactedMarkdown = lines.join("\n");

  return {
    semanticState,
    compactedMarkdown,
    originalApproxTokens: Math.ceil(rawHistory.length / 4),
    compactedApproxTokens: Math.ceil(compactedMarkdown.length / 4),
  };
}
