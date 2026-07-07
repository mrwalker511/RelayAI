import test from "node:test";
import assert from "node:assert/strict";
import { buildStaticBlock } from "./static-block.js";

test("buildStaticBlock with all fields includes provided values", () => {
  const result = buildStaticBlock({
    projectRules: "Use TypeScript strict mode.",
    architectureNotes: "Monorepo with two packages.",
    sourceSnapshot: "// index.ts\nexport {};"
  });
  assert.ok(result.includes("# Static Block"));
  assert.ok(result.includes("Use TypeScript strict mode."));
  assert.ok(result.includes("Monorepo with two packages."));
  assert.ok(result.includes("## Source Snapshot"));
  assert.ok(result.includes("// index.ts"));
});

test("buildStaticBlock with domainContext uses Domain Context section instead of Source Snapshot", () => {
  const result = buildStaticBlock({
    domainContext: "Auth domain rules here.",
    sourceSnapshot: "should not appear"
  });
  assert.ok(result.includes("## Domain Context"));
  assert.ok(result.includes("Auth domain rules here."));
  assert.ok(!result.includes("## Source Snapshot"));
  assert.ok(!result.includes("should not appear"));
});

test("buildStaticBlock with no input uses defaults", () => {
  const result = buildStaticBlock({});
  assert.ok(result.includes("No project rules recorded yet."));
  assert.ok(result.includes("No architecture notes recorded yet."));
  assert.ok(result.includes("No source snapshot recorded yet."));
  assert.ok(result.includes("## Source Snapshot"));
});

test("buildStaticBlock sections appear in correct order", () => {
  const result = buildStaticBlock({ projectRules: "r", architectureNotes: "a", sourceSnapshot: "s" });
  const rulesPos = result.indexOf("## Project Rules");
  const archPos = result.indexOf("## Architecture Notes");
  const snapshotPos = result.indexOf("## Source Snapshot");
  assert.ok(rulesPos < archPos);
  assert.ok(archPos < snapshotPos);
});
