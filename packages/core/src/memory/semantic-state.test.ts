import test from "node:test";
import assert from "node:assert/strict";
import { createEmptySemanticState, serializeSemanticState, trimSemanticState } from "./semantic-state.js";

test("createEmptySemanticState returns all required fields with empty arrays", () => {
  const s = createEmptySemanticState();
  assert.deepEqual(s.runtime_errors, []);
  assert.deepEqual(s.verified_hypotheses, []);
  assert.deepEqual(s.rejected_hypotheses, []);
  assert.deepEqual(s.next_actions, []);
  assert.deepEqual(s.code_changes, []);
  assert.equal(s.active_target, undefined);
  assert.equal(s.current_goal, undefined);
});

test("serializeSemanticState round-trips through JSON.parse", () => {
  const s = createEmptySemanticState();
  s.active_target = "fix bug";
  s.code_changes = ["src/index.ts: added export"];
  const json = serializeSemanticState(s);
  const parsed = JSON.parse(json);
  assert.equal(parsed.active_target, "fix bug");
  assert.deepEqual(parsed.code_changes, ["src/index.ts: added export"]);
});

test("trimSemanticState slices code_changes to maxCodeChanges", () => {
  const s = createEmptySemanticState();
  s.code_changes = Array.from({ length: 25 }, (_, i) => `change ${i}`);
  const trimmed = trimSemanticState(s, { maxCodeChanges: 5 });
  assert.equal(trimmed.code_changes.length, 5);
  assert.equal(trimmed.code_changes[0], "change 20");
});

test("trimSemanticState slices next_actions to maxNextActions", () => {
  const s = createEmptySemanticState();
  s.next_actions = Array.from({ length: 15 }, (_, i) => `action ${i}`);
  const trimmed = trimSemanticState(s, { maxNextActions: 3 });
  assert.equal(trimmed.next_actions.length, 3);
  assert.equal(trimmed.next_actions[0], "action 12");
});

test("trimSemanticState does not mutate the original state", () => {
  const s = createEmptySemanticState();
  s.code_changes = Array.from({ length: 25 }, (_, i) => `change ${i}`);
  trimSemanticState(s, { maxCodeChanges: 5 });
  assert.equal(s.code_changes.length, 25);
});

test("trimSemanticState uses defaults of 20 and 10 when options omitted", () => {
  const s = createEmptySemanticState();
  s.code_changes = Array.from({ length: 30 }, (_, i) => `c${i}`);
  s.next_actions = Array.from({ length: 15 }, (_, i) => `a${i}`);
  const trimmed = trimSemanticState(s);
  assert.equal(trimmed.code_changes.length, 20);
  assert.equal(trimmed.next_actions.length, 10);
});

test("trimSemanticState preserves other fields unchanged", () => {
  const s = createEmptySemanticState();
  s.active_target = "goal";
  s.verified_hypotheses = ["h1"];
  const trimmed = trimSemanticState(s);
  assert.equal(trimmed.active_target, "goal");
  assert.deepEqual(trimmed.verified_hypotheses, ["h1"]);
});
