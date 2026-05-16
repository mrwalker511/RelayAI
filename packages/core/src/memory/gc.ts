import { spawn } from "node:child_process";
import type { SemanticState } from "./semantic-state.js";

export interface CompactionResult {
  semanticState: SemanticState;
  compactedMarkdown: string;
  originalApproxTokens: number;
  compactedApproxTokens: number;
}

function buildCompactionPrompt(rawHistory: string, existingState: SemanticState): string {
  return `Extract structured session state from this coding session history. Return ONLY valid JSON — no markdown fences, no explanation, nothing else.

Schema (all fields required, use null for unknown strings, empty arrays for unknowns):
{
  "active_target": string | null,
  "current_goal": string | null,
  "runtime_errors": string[],
  "verified_hypotheses": string[],
  "rejected_hypotheses": string[],
  "next_actions": string[],
  "code_changes": string[]
}

Existing state:
${JSON.stringify(existingState, null, 2)}

Session history to compact:
${rawHistory}`;
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

export async function compactHistoryToState(rawHistory: string, existingState: SemanticState): Promise<CompactionResult> {
  const prompt = buildCompactionPrompt(rawHistory, existingState);
  const raw = await shellCapture("claude", ["--print"], prompt);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`GC model returned no valid JSON.\nRaw output:\n${raw.slice(0, 500)}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(`GC model returned malformed JSON.\nMatched:\n${jsonMatch[0].slice(0, 500)}`);
  }
  const semanticState: SemanticState = {
    active_target: parsed.active_target ?? undefined,
    current_goal: parsed.current_goal ?? undefined,
    runtime_errors: parsed.runtime_errors ?? [],
    verified_hypotheses: parsed.verified_hypotheses ?? [],
    rejected_hypotheses: parsed.rejected_hypotheses ?? [],
    next_actions: parsed.next_actions ?? [],
    code_changes: parsed.code_changes ?? []
  };

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
    compactedApproxTokens: Math.ceil(compactedMarkdown.length / 4)
  };
}
