import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readRelayWorkspace, summarizeContextHealth } from "./workspace-context.js";

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "relay-workspace-context-test-"));
}

function tempGitWorkspace(): string {
  const cwd = tempWorkspace();
  spawnSync("git", ["init"], { cwd, encoding: "utf8" });
  mkdirSync(join(cwd, "src"));
  writeFileSync(join(cwd, "src", "app.ts"), "export const app = true;\n");
  spawnSync("git", ["add", "src/app.ts"], { cwd, encoding: "utf8" });
  return cwd;
}

test("readRelayWorkspace falls back cleanly without Relay files", () => {
  const snapshot = readRelayWorkspace({ cwd: tempWorkspace(), prompt: "inspect" });

  assert.equal(snapshot.config.valid, true);
  assert.equal(snapshot.session.exists, false);
  assert.equal(snapshot.session.base_git_sha, null);
  assert.equal(snapshot.git.base_ref, "HEAD");
  assert.equal(snapshot.state.exists, false);
  assert.equal(snapshot.state.valid_json, true);
  assert.equal(snapshot.budget.status, "ok");
});

test("readRelayWorkspace uses configured token limits", () => {
  const cwd = tempWorkspace();
  mkdirSync(join(cwd, ".relay", "memory"), { recursive: true });
  writeFileSync(join(cwd, ".relay", "config.json"), JSON.stringify({
    tokens: {
      warningLimit: 10,
      requireConfirmationAbove: 20,
      hardLimit: 30
    }
  }));

  const snapshot = readRelayWorkspace({ cwd, prompt: "inspect" });

  assert.equal(snapshot.budget.warning_limit, 10);
  assert.equal(snapshot.budget.confirmation_threshold, 20);
  assert.equal(snapshot.budget.hard_limit, 30);
});

test("summarizeContextHealth reports corrupted session", () => {
  const cwd = tempGitWorkspace();
  mkdirSync(join(cwd, ".relay", "memory"), { recursive: true });
  writeFileSync(join(cwd, ".relay", "session.json"), "{");

  const health = summarizeContextHealth(readRelayWorkspace({ cwd }));

  assert.equal(health.status, "error");
  assert.equal(health.findings.find((finding) => finding.id === "session")?.status, "error");
});

test("readRelayWorkspace respects files.maxIndex config for included_paths", () => {
  const cwd = tempGitWorkspace();
  mkdirSync(join(cwd, ".relay", "memory"), { recursive: true });
  writeFileSync(join(cwd, ".relay", "config.json"), JSON.stringify({ files: { maxIndex: 1 } }));

  const snapshot = readRelayWorkspace({ cwd });

  assert.ok(snapshot.files.included_path_count <= 1);
  assert.ok(snapshot.files.tracked_path_count >= snapshot.files.included_path_count);
});

test("readRelayWorkspace reads semantic state from memory directory", () => {
  const cwd = tempGitWorkspace();
  mkdirSync(join(cwd, ".relay", "memory"), { recursive: true });
  writeFileSync(join(cwd, ".relay", "memory", "semantic-state.json"), JSON.stringify({
    active_target: "src/app.ts",
    current_goal: "verify file reading",
    runtime_errors: [],
    verified_hypotheses: [],
    rejected_hypotheses: [],
    next_actions: [],
    code_changes: []
  }));

  const snapshot = readRelayWorkspace({ cwd });

  assert.equal(snapshot.state.exists, true);
  assert.equal(snapshot.state.valid_json, true);
  assert.equal(snapshot.state.parsed?.current_goal, "verify file reading");
  assert.equal(snapshot.state.parsed?.active_target, "src/app.ts");
});

test("readRelayWorkspace zone_tokens.total is a positive number for a prompt", () => {
  const snapshot = readRelayWorkspace({ cwd: tempWorkspace(), prompt: "hello" });

  assert.ok(snapshot.zone_tokens.total > 0);
  assert.ok(snapshot.zone_tokens.static_block >= 0);
  assert.ok(snapshot.zone_tokens.dynamic_input > 0);
});

test("readRelayWorkspace returns zones with non-empty dynamicInput for a prompt", () => {
  const snapshot = readRelayWorkspace({ cwd: tempWorkspace(), prompt: "test prompt" });

  assert.ok(typeof snapshot.zones.staticBlock === "string");
  assert.ok(typeof snapshot.zones.stateLayer === "string");
  assert.ok(typeof snapshot.zones.dynamicInput === "string");
  assert.ok(snapshot.zones.dynamicInput.includes("test prompt"));
});

test("summarizeContextHealth returns ok for a valid initialized workspace", () => {
  const cwd = tempGitWorkspace();
  mkdirSync(join(cwd, ".relay", "memory"), { recursive: true });
  writeFileSync(join(cwd, ".relay", "config.json"), JSON.stringify({}));

  const health = summarizeContextHealth(readRelayWorkspace({ cwd }));

  assert.equal(health.findings.find(f => f.id === "config")?.status, "ok");
  assert.equal(health.findings.find(f => f.id === "token_budget")?.status, "ok");
});
