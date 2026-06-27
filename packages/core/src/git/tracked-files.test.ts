import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { listTrackedFiles, listTrackedFilesAsync, buildPrioritizedFileIndex, buildPrioritizedFileIndexAsync } from "./tracked-files.js";

function makeTempGitRepo(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "relay-tracked-test-"));
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "relay@example.test"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Relay Test"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, stdio: "ignore" });
  const allFiles = { "README.md": "# Test\n", ...files };
  for (const [name, content] of Object.entries(allFiles)) {
    const full = join(dir, name);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  execFileSync("git", ["add", "."], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });
  return dir;
}

test("listTrackedFiles returns tracked files in a git repo", () => {
  const dir = makeTempGitRepo({ "src/index.ts": "export {};\n" });
  try {
    const files = listTrackedFiles(dir);
    assert.ok(files.includes("README.md"));
    assert.ok(files.includes("src/index.ts"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listTrackedFiles returns empty array outside a git repository", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-no-git-"));
  try {
    const files = listTrackedFiles(dir);
    assert.deepEqual(files, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildPrioritizedFileIndex places priority paths first", () => {
  const dir = makeTempGitRepo({
    "src/a.ts": "a",
    "src/b.ts": "b",
    "src/c.ts": "c",
  });
  try {
    const index = buildPrioritizedFileIndex(dir, { priorityPaths: ["src/c.ts"] });
    const cPos = index.indexOf("src/c.ts");
    const aPos = index.indexOf("src/a.ts");
    assert.ok(cPos !== -1, "src/c.ts should be in index");
    assert.ok(cPos < aPos, "priority path should come before non-priority");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildPrioritizedFileIndex respects the limit option", () => {
  const dir = makeTempGitRepo({
    "a.ts": "a",
    "b.ts": "b",
    "c.ts": "c",
  });
  try {
    const index = buildPrioritizedFileIndex(dir, { limit: 2 });
    assert.ok(index.length <= 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listTrackedFilesAsync returns same files as sync version", async () => {
  const dir = makeTempGitRepo({ "src/index.ts": "export {};\n" });
  try {
    const [sync, async_] = await Promise.all([
      Promise.resolve(listTrackedFiles(dir)),
      listTrackedFilesAsync(dir),
    ]);
    assert.deepEqual(sync.sort(), async_.sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildPrioritizedFileIndexAsync returns same result as sync version", async () => {
  const dir = makeTempGitRepo({ "src/a.ts": "a", "src/b.ts": "b" });
  try {
    const [sync, async_] = await Promise.all([
      Promise.resolve(buildPrioritizedFileIndex(dir, { priorityPaths: ["src/a.ts"] })),
      buildPrioritizedFileIndexAsync(dir, { priorityPaths: ["src/a.ts"] }),
    ]);
    assert.deepEqual(sync, async_);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildPrioritizedFileIndex excludes files matching excludePatterns", () => {
  const dir = makeTempGitRepo({
    "src/index.ts": "export {};\n",
    "src/index.d.ts": "export {};\n",
  });
  try {
    const index = buildPrioritizedFileIndex(dir);
    assert.ok(!index.some((f) => f.endsWith(".d.ts")), ".d.ts files should be excluded by default");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
