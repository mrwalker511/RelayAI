import test from "node:test";
import assert from "node:assert/strict";
import { compactHistoryToState } from "./gc.js";
import { createEmptySemanticState } from "./semantic-state.js";

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
