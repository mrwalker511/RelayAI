import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRelayDoctor } from "./doctor.js";
import { DEFAULT_RELAY_CONFIG } from "./config/relay-config.js";
import { serializeSemanticState, createEmptySemanticState } from "./memory/semantic-state.js";

function tempGitWorkspace(): string {
  const cwd = mkdtempSync(join(tmpdir(), "relay-doctor-test-"));
  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "relay@example.test"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Relay Test"], { cwd, stdio: "ignore" });
  writeFileSync(join(cwd, "README.md"), "# Test\n");
  execFileSync("git", ["add", "README.md"], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd, stdio: "ignore" });
  return cwd;
}

function initRelay(cwd: string, config = DEFAULT_RELAY_CONFIG): void {
  mkdirSync(join(cwd, ".relay", "memory"), { recursive: true });
  writeFileSync(join(cwd, ".relay", "config.json"), JSON.stringify(config, null, 2));
  writeFileSync(join(cwd, ".relay", "memory", "semantic-state.json"), serializeSemanticState(createEmptySemanticState()));
  writeFileSync(join(cwd, ".relay", "session.json"), JSON.stringify({
    session_id: "sess_test",
    base_git_sha: "abc123",
    prefix_hash: "def456",
    tracked_paths: ["README.md"],
    created_at: "2026-05-17T00:00:00.000Z"
  }, null, 2));
}

test("runRelayDoctor reports missing Relay workspace as warnings", () => {
  const report = runRelayDoctor(tempGitWorkspace());

  assert.equal(report.status, "warning");
  assert.equal(report.checks.find((check) => check.id === "git")?.status, "ok");
  assert.equal(report.checks.find((check) => check.id === "relay_workspace")?.status, "warning");
  assert.equal(report.checks.find((check) => check.id === "config")?.status, "warning");
});

test("runRelayDoctor reports initialized workspace with configured commands as ok", () => {
  const cwd = tempGitWorkspace();
  initRelay(cwd, {
    ...DEFAULT_RELAY_CONFIG,
    provider: {
      default: "node",
      commands: {
        node: [process.execPath]
      }
    },
    gc: {
      ...DEFAULT_RELAY_CONFIG.gc,
      command: [process.execPath]
    }
  });

  const report = runRelayDoctor(cwd);

  assert.equal(report.status, "ok");
  assert.equal(report.checks.find((check) => check.id === "provider_command")?.status, "ok");
  assert.equal(report.checks.find((check) => check.id === "gc_command")?.status, "ok");
});

test("runRelayDoctor reports corrupted config as an error", () => {
  const cwd = tempGitWorkspace();
  initRelay(cwd);
  writeFileSync(join(cwd, ".relay", "config.json"), "{");

  const report = runRelayDoctor(cwd);

  assert.equal(report.status, "error");
  assert.equal(report.checks.find((check) => check.id === "config")?.status, "error");
});

test("runRelayDoctor reports corrupted session as an error", () => {
  const cwd = tempGitWorkspace();
  initRelay(cwd);
  writeFileSync(join(cwd, ".relay", "session.json"), "{");

  const report = runRelayDoctor(cwd);

  assert.equal(report.status, "error");
  assert.equal(report.checks.find((check) => check.id === "session")?.status, "error");
});

test("runRelayDoctor reports invalid token budget ordering", () => {
  const cwd = tempGitWorkspace();
  initRelay(cwd, {
    ...DEFAULT_RELAY_CONFIG,
    tokens: {
      ...DEFAULT_RELAY_CONFIG.tokens,
      warningLimit: 100,
      requireConfirmationAbove: 50,
      hardLimit: 200
    }
  });

  const report = runRelayDoctor(cwd);

  assert.equal(report.status, "error");
  assert.equal(report.checks.find((check) => check.id === "token_budget_order")?.status, "error");
});

test("runRelayDoctor warns for missing provider and GC commands", () => {
  const cwd = tempGitWorkspace();
  initRelay(cwd);

  const report = runRelayDoctor(cwd);

  assert.equal(report.status, "warning");
  assert.equal(report.checks.find((check) => check.id === "provider_command")?.status, "warning");
  assert.equal(report.checks.find((check) => check.id === "gc_command")?.status, "warning");
});
