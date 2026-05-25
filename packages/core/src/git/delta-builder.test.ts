import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildDeltaPrompt } from "./delta-builder.js";

function makeTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "relay-delta-test-"));
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "relay@example.test"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Relay Test"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, "README.md"), "# Test\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });
  return dir;
}

test("buildDeltaPrompt includes user prompt in output", () => {
  const dir = makeTempGitRepo();
  try {
    const result = buildDeltaPrompt({ baseRef: "HEAD", userPrompt: "review this code", cwd: dir });
    assert.match(result, /review this code/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildDeltaPrompt reports no changes when diff is empty", () => {
  const dir = makeTempGitRepo();
  try {
    const result = buildDeltaPrompt({ baseRef: "HEAD", userPrompt: "check status", cwd: dir });
    assert.match(result, /No changes detected\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildDeltaPrompt includes diff content when file is modified after base SHA", () => {
  const dir = makeTempGitRepo();
  try {
    const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    writeFileSync(join(dir, "README.md"), "# Test\n\nnew content\n");
    const result = buildDeltaPrompt({ baseRef: baseSha, userPrompt: "what changed?", cwd: dir });
    assert.match(result, /new content/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildDeltaPrompt section headers are present in output", () => {
  const dir = makeTempGitRepo();
  try {
    const result = buildDeltaPrompt({ baseRef: "HEAD", userPrompt: "hello", cwd: dir });
    assert.match(result, /# User Prompt/);
    assert.match(result, /# Delta Since/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
