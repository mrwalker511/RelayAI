import test from "node:test";
import assert from "node:assert/strict";
import { buildDynamicInput } from "./dynamic-input.js";
import { buildPromptPayload } from "./payload-builder.js";
import { getPrefixHash } from "./prefix-hash.js";

test("buildPromptPayload emits zones in stable prefix-first order", () => {
  const payload = buildPromptPayload({
    staticBlock: "static",
    stateLayer: "state",
    dynamicInput: "dynamic",
  });

  assert.equal(payload, [
    "<STATIC_BLOCK>\nstatic\n</STATIC_BLOCK>",
    "<STATE_LAYER>\nstate\n</STATE_LAYER>",
    "<DYNAMIC_INPUT>\ndynamic\n</DYNAMIC_INPUT>",
  ].join("\n\n"));
});

test("prefix hash ignores dynamic input changes", () => {
  const first = getPrefixHash("static", "state");
  const second = getPrefixHash("static", "state");
  const changedState = getPrefixHash("static", "new state");

  assert.equal(first, second);
  assert.notEqual(first, changedState);
});

test("dynamic input contains volatile content outside the prefix zones", () => {
  const dynamic = buildDynamicInput({
    prompt: "fix the test",
    gitDiff: "diff --git a/a b/a",
    timestampIso: "2026-05-17T00:00:00.000Z",
  });

  assert.match(dynamic, /## Timestamp\n2026-05-17T00:00:00\.000Z/);
  assert.match(dynamic, /## User Prompt\nfix the test/);
  assert.match(dynamic, /## Git Diff\ndiff --git a\/a b\/a/);
});
