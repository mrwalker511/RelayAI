import test from "node:test";
import assert from "node:assert/strict";
import { compactHistoryToState } from "./gc.js";
import { createEmptySemanticState } from "./semantic-state.js";
import { estimateTokens } from "../tokens/tokenizer.js";

test("compactHistoryToState parses JSON emitted by the configured command", async () => {
  const json = JSON.stringify({
    active_target: "src/index.ts",
    current_goal: "make gc testable",
    runtime_errors: ["none"],
    verified_hypotheses: ["provider command is configurable"],
    rejected_hypotheses: [],
    next_actions: ["add cli smoke tests"],
    code_changes: ["added gc command option"],
  });

  const result = await compactHistoryToState("history", createEmptySemanticState(), {
    command: ["/bin/sh", "-c", `cat >/dev/null; printf '%s' '${json}'`],
  });

  assert.equal(result.semanticState.active_target, "src/index.ts");
  assert.equal(result.semanticState.current_goal, "make gc testable");
  assert.deepEqual(result.semanticState.next_actions, ["add cli smoke tests"]);
  assert.match(result.compactedMarkdown, /make gc testable/);
});

test("compactHistoryToState rejects malformed command output", async () => {
  await assert.rejects(
    compactHistoryToState("history", createEmptySemanticState(), {
      command: ["/bin/sh", "-c", "cat >/dev/null; printf '%s' 'not json'"],
    }),
    /no valid JSON/
  );
});

test("compactHistoryToState rejects an empty GC command", async () => {
  await assert.rejects(
    compactHistoryToState("history", createEmptySemanticState(), { command: [] }),
    /GC command is empty/
  );
});

test("compactHistoryToState token counts use estimateTokens not char/4", async () => {
  const json = JSON.stringify({
    active_target: null,
    current_goal: "test tokens",
    runtime_errors: [],
    verified_hypotheses: [],
    rejected_hypotheses: [],
    next_actions: [],
    code_changes: [],
  });

  const rawHistory = "The developer is working on a bug fix. ".repeat(10);
  const result = await compactHistoryToState(rawHistory, createEmptySemanticState(), {
    command: ["/bin/sh", "-c", `cat >/dev/null; printf '%s' '${json}'`],
  });

  assert.equal(result.originalApproxTokens, estimateTokens(rawHistory).tokens);
  assert.equal(result.compactedApproxTokens, estimateTokens(result.compactedMarkdown).tokens);
  assert.ok(result.originalApproxTokens > 0);
  assert.ok(result.compactedApproxTokens > 0);
});

test("compactHistoryToState extracts JSON embedded in prose output", async () => {
  const json = JSON.stringify({
    active_target: null,
    current_goal: "extract embedded json",
    runtime_errors: [],
    verified_hypotheses: [],
    rejected_hypotheses: [],
    next_actions: [],
    code_changes: [],
  });

  const output = `Here is the extracted state:\n\n${json}\n\nLet me know if you need adjustments.`;
  const escaped = output.replace(/'/g, "'\\''");
  const result = await compactHistoryToState("history", createEmptySemanticState(), {
    command: ["/bin/sh", "-c", `cat >/dev/null; printf '%s' '${escaped}'`],
  });

  assert.equal(result.semanticState.current_goal, "extract embedded json");
});
