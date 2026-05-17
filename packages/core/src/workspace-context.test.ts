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
