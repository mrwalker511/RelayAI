import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { getCurrentGitSha, createSessionSnapshot } from "./snapshot.js";

function makeTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "relay-snapshot-test-"));
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "relay@example.test"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Relay Test"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, "README.md"), "# Test\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });
  return dir;
}

test("getCurrentGitSha returns a non-empty SHA in a git repository", () => {
  const dir = makeTempGitRepo();
  try {
    const sha = getCurrentGitSha(dir);
    assert.ok(sha.length > 0, "SHA should not be empty");
    assert.match(sha, /^[0-9a-f]{40}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getCurrentGitSha returns empty string outside a git repository", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-no-git-"));
  try {
    const sha = getCurrentGitSha(dir);
    assert.equal(sha, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createSessionSnapshot returns expected shape", () => {
  const snapshot = createSessionSnapshot(["src/index.ts", "README.md"], {});
  assert.ok(snapshot.session_id.startsWith("sess_"));
  assert.ok(typeof snapshot.base_git_sha === "string");
  assert.deepEqual(snapshot.tracked_paths, ["src/index.ts", "README.md"]);
  assert.ok(snapshot.created_at.includes("T"));
});

test("createSessionSnapshot records prefix hashes when provided", () => {
  const snapshot = createSessionSnapshot([], {
    prefixHash: "abc123",
    staticBlockHash: "def456",
    stateLayerHash: "ghi789",
  });
  assert.equal(snapshot.prefix_hash, "abc123");
  assert.equal(snapshot.static_block_hash, "def456");
  assert.equal(snapshot.state_layer_hash, "ghi789");
});

test("createSessionSnapshot accepts a plain string as prefixHash for backwards compatibility", () => {
  const snapshot = createSessionSnapshot([], "legacy-hash");
  assert.equal(snapshot.prefix_hash, "legacy-hash");
});
