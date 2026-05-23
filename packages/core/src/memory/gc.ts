import { spawn } from "node:child_process";
import { estimateTokens } from "../tokens/tokenizer.js";
import type { SemanticState } from "./semantic-state.js";

export interface CompactionResult {
  semanticState: SemanticState;
  compactedMarkdown: string;
  originalApproxTokens: number;
  compactedApproxTokens: number;
}

export interface CompactionOptions {
  command: string[];
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

// Stable system prompt used for local GC compaction.
const GC_SYSTEM_PROMPT =
  "Extract structured session state from coding session history. " +
  "Merge with the existing state: preserve verified_hypotheses and code_changes unless clearly superseded. " +
  "Use null for unknown string fields, empty arrays for unknown array fields.";

async function shellCapture(command: string, args: string[], stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stdin.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code !== "EPIPE") reject(err);
    });
    child.on("close", (code, signal) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString("utf8").trim());
      else if (signal) reject(new Error(`'${command}' was killed by signal ${signal}`));
      else reject(new Error(`'${command}' exited with code ${code}`));
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT")
        reject(new Error(`'${command}' not found in PATH; ensure the configured GC command is installed and authenticated.`));
      else reject(err);
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

async function compactViaCli(rawHistory: string, existingState: SemanticState, commandTemplate: string[]): Promise<RawExtracted> {
  if (commandTemplate.length === 0) throw new Error("GC command is empty.");
  const [command, ...args] = commandTemplate;
  const prompt =
    `${GC_SYSTEM_PROMPT} Return ONLY valid JSON; no markdown fences, no explanation.\n\n` +
    `Schema: { "active_target": string|null, "current_goal": string|null, "runtime_errors": string[], ` +
    `"verified_hypotheses": string[], "rejected_hypotheses": string[], "next_actions": string[], "code_changes": string[] }\n\n` +
    `Existing state:\n${JSON.stringify(existingState, null, 2)}\n\nSession history:\n${rawHistory}`;

  const raw = await shellCapture(command, args, prompt);
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

export async function compactHistoryToState(rawHistory: string, existingState: SemanticState, options: CompactionOptions): Promise<CompactionResult> {
  const parsed = await compactViaCli(rawHistory, existingState, options.command);
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
    originalApproxTokens: estimateTokens(rawHistory).tokens,
    compactedApproxTokens: estimateTokens(compactedMarkdown).tokens,
  };
}
