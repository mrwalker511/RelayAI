import test from "node:test";
import assert from "node:assert/strict";
import { inspectCacheDiagnostics } from "./cache-diagnostics.js";
import { getPrefixHash } from "./prefix-hash.js";

test("cache diagnostics match an unchanged saved session prefix", () => {
  const staticBlock = "stable static";
  const stateLayer = "stable state";
  const report = inspectCacheDiagnostics({
    staticBlock,
    stateLayer,
    dynamicInput: "first dynamic input",
    sessionPrefixHash: getPrefixHash(staticBlock, stateLayer)
  });

  assert.equal(report.prefix.current_hash, getPrefixHash(staticBlock, stateLayer));
  assert.equal(report.prefix.session_hash, getPrefixHash(staticBlock, stateLayer));
  assert.equal(report.prefix.matches_session, true);
  assert.deepEqual(report.prefix.drift_reasons, []);
});

test("cache diagnostics report changed state or static content as drift", () => {
  const sessionPrefixHash = getPrefixHash("old static", "old state");

  const stateChanged = inspectCacheDiagnostics({
    staticBlock: "old static",
    stateLayer: "new state",
    dynamicInput: "dynamic",
    sessionPrefixHash
  });
  const staticChanged = inspectCacheDiagnostics({
    staticBlock: "new static",
    stateLayer: "old state",
    dynamicInput: "dynamic",
    sessionPrefixHash
  });

  assert.equal(stateChanged.prefix.matches_session, false);
  assert.equal(staticChanged.prefix.matches_session, false);
  assert.deepEqual(stateChanged.prefix.drift_reasons, ["static_or_state_prefix_changed"]);
  assert.deepEqual(staticChanged.prefix.drift_reasons, ["static_or_state_prefix_changed"]);
});

test("cache diagnostics prefix hash ignores dynamic input changes", () => {
  const staticBlock = "static";
  const stateLayer = "state";
  const first = inspectCacheDiagnostics({
    staticBlock,
    stateLayer,
    dynamicInput: "diff --git a/a b/a",
    sessionPrefixHash: getPrefixHash(staticBlock, stateLayer)
  });
  const second = inspectCacheDiagnostics({
    staticBlock,
    stateLayer,
    dynamicInput: "2026-05-17T00:00:00.000Z\nError: dynamic failure",
    sessionPrefixHash: getPrefixHash(staticBlock, stateLayer)
  });

  assert.equal(first.prefix.current_hash, second.prefix.current_hash);
  assert.equal(second.prefix.matches_session, true);
});

test("cache diagnostics report ISO timestamps and git diff text in prefix zones", () => {
  const report = inspectCacheDiagnostics({
    staticBlock: "built at 2026-05-17T00:00:00.000Z",
    stateLayer: "diff --git a/a b/a\n--- a/a\n+++ b/a",
    dynamicInput: "dynamic"
  });

  assert.deepEqual(
    report.findings.dynamic_content_in_prefix.map((finding) => [finding.zone, finding.kind]),
    [
      ["static_block", "iso_timestamp"],
      ["state_layer", "git_diff"],
      ["state_layer", "git_diff"],
      ["state_layer", "git_diff"]
    ]
  );
  assert.deepEqual(report.prefix.drift_reasons, ["volatile_content_in_static_block", "volatile_content_in_state_layer"]);
});

test("cache diagnostics do not report volatile content in dynamic input as a prefix problem", () => {
  const report = inspectCacheDiagnostics({
    staticBlock: "static",
    stateLayer: "state",
    dynamicInput: "2026-05-17T00:00:00.000Z\ndiff --git a/a b/a\nError: dynamic failure"
  });

  assert.deepEqual(report.findings.dynamic_content_in_prefix, []);
  assert.deepEqual(report.prefix.drift_reasons, []);
});
