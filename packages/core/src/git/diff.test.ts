import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { getGitDiffSince, getGitDiffSinceAsync, getStagedDiff, getStagedDiffAsync, summarizeDiff } from "./diff.js";

function makeTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "relay-diff-test-"));
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "relay@example.test"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Relay Test"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, "file.ts"), "export const x = 1;\n");
  execFileSync("git", ["add", "file.ts"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });
  return dir;
}

test("getGitDiffSince returns empty string when nothing changed since HEAD", () => {
  const dir = makeTempGitRepo();
  try {
    const diff = getGitDiffSince("HEAD", dir);
    assert.equal(diff.trim(), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getGitDiffSince returns diff content after modifying a tracked file", () => {
  const dir = makeTempGitRepo();
  try {
    const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    writeFileSync(join(dir, "file.ts"), "export const x = 2;\n");
    const diff = getGitDiffSince(baseSha, dir);
    assert.match(diff, /file\.ts/);
    assert.match(diff, /\+export const x = 2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getGitDiffSince throws on invalid ref", () => {
  const dir = makeTempGitRepo();
  try {
    assert.throws(() => getGitDiffSince("invalid-sha-xyz", dir), /Unable to read git diff/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getStagedDiff returns empty string when nothing is staged", () => {
  const dir = makeTempGitRepo();
  try {
    const diff = getStagedDiff(dir);
    assert.equal(diff.trim(), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getStagedDiff returns staged content after git add", () => {
  const dir = makeTempGitRepo();
  try {
    writeFileSync(join(dir, "file.ts"), "export const x = 99;\n");
    execFileSync("git", ["add", "file.ts"], { cwd: dir, stdio: "ignore" });
    const diff = getStagedDiff(dir);
    assert.match(diff, /file\.ts/);
    assert.match(diff, /\+export const x = 99/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getGitDiffSinceAsync returns same result as sync version", async () => {
  const dir = makeTempGitRepo();
  try {
    const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    writeFileSync(join(dir, "file.ts"), "export const x = 42;\n");
    const [sync, async_] = await Promise.all([
      Promise.resolve(getGitDiffSince(baseSha, dir)),
      getGitDiffSinceAsync(baseSha, dir),
    ]);
    assert.equal(sync, async_);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getStagedDiffAsync returns same result as sync version", async () => {
  const dir = makeTempGitRepo();
  try {
    writeFileSync(join(dir, "file.ts"), "export const x = 99;\n");
    execFileSync("git", ["add", "file.ts"], { cwd: dir, stdio: "ignore" });
    const [sync, async_] = await Promise.all([
      Promise.resolve(getStagedDiff(dir)),
      getStagedDiffAsync(dir),
    ]);
    assert.equal(sync, async_);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("summarizeDiff returns no-diff message for empty input", () => {
  assert.equal(summarizeDiff(""), "No git diff.");
  assert.equal(summarizeDiff("   "), "No git diff.");
});

test("summarizeDiff summarizes a standard diff", () => {
  const diff = [
    "diff --git a/src/index.ts b/src/index.ts",
    "index abc..def 100644",
    "--- a/src/index.ts",
    "+++ b/src/index.ts",
    "@@ -1,2 +1,3 @@",
    " const x = 1;",
    "+const y = 2;",
  ].join("\n");
  const summary = summarizeDiff(diff);
  assert.match(summary, /src\/index\.ts/);
  assert.match(summary, /\+1\/-0/);
});

test("summarizeDiff skips lock and dist files", () => {
  const diff = [
    "diff --git a/yarn.lock b/yarn.lock",
    "index abc..def 100644",
    "--- a/yarn.lock",
    "+++ b/yarn.lock",
    "@@ -1 +1 @@",
    "+added line",
    "diff --git a/dist/index.js b/dist/index.js",
    "index abc..def 100644",
    "+added dist line",
  ].join("\n");
  const summary = summarizeDiff(diff);
  assert.equal(summary, "No relevant diff.");
});
