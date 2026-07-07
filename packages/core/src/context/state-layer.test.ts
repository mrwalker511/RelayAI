import test from "node:test";
import assert from "node:assert/strict";
import { buildStateLayer } from "./state-layer.js";

test("buildStateLayer with all fields includes provided values", () => {
  const result = buildStateLayer({
    semanticStateJson: '{"active_target":"foo"}',
    fileIndex: "src/index.ts\nsrc/utils.ts",
    sessionSummary: "Working on refactor"
  });
  assert.ok(result.includes("# State Layer"));
  assert.ok(result.includes('{"active_target":"foo"}'));
  assert.ok(result.includes("src/index.ts"));
  assert.ok(result.includes("Working on refactor"));
});

test("buildStateLayer with no input uses defaults", () => {
  const result = buildStateLayer({});
  assert.ok(result.includes("{}"));
  assert.ok(result.includes("No file index recorded yet."));
  assert.ok(result.includes("No session summary recorded yet."));
});

test("buildStateLayer sections appear in correct order", () => {
  const result = buildStateLayer({ semanticStateJson: "{}", fileIndex: "a.ts", sessionSummary: "done" });
  const statePos = result.indexOf("## Semantic State");
  const filePos = result.indexOf("## File Index");
  const summaryPos = result.indexOf("## Session Summary");
  assert.ok(statePos < filePos);
  assert.ok(filePos < summaryPos);
});

test("buildStateLayer with only sessionSummary leaves other sections as defaults", () => {
  const result = buildStateLayer({ sessionSummary: "custom summary" });
  assert.ok(result.includes("No file index recorded yet."));
  assert.ok(result.includes("custom summary"));
});
