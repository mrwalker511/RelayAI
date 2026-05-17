import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const distDir = dirname(fileURLToPath(import.meta.url));
const relayBin = join(distDir, "index.js");
const canSpawnNode = !spawnSync(process.execPath, ["--version"], { encoding: "utf8" }).error;

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "relay-cli-test-"));
}

function runRelay(args: string[], cwd = tempWorkspace()) {
  return {
    cwd,
    result: spawnSync(process.execPath, [relayBin, ...args], {
      cwd,
      encoding: "utf8",
    }),
  };
}

test("relay init writes provider-neutral default config and memory files", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const { cwd, result } = runRelay(["init"]);

  assert.equal(result.status, 0);
  const config = JSON.parse(readFileSync(join(cwd, ".relay", "config.json"), "utf8"));
  assert.equal(config.provider.default, "default");
  assert.equal(config.tokens.provider, "generic");
  assert.equal(config.tokens.model, "default");
  assert.match(readFileSync(join(cwd, ".relay", "memory", "session.raw.md"), "utf8"), /Raw Session History/);
});

test("relay ask prints inspectable payload without configured provider", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  const result = runRelay(["ask", "summarize this repo"], cwd).result;

  assert.equal(result.status, 0);
  assert.match(result.stdout, /---BEGIN RELAY PAYLOAD---/);
  assert.match(result.stdout, /<STATIC_BLOCK>/);
  assert.match(result.stdout, /<STATE_LAYER>/);
  assert.match(result.stdout, /<DYNAMIC_INPUT>/);
  assert.match(result.stderr, /Token breakdown:/);
});

test("relay ask --provider reports missing provider config clearly", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  const result = runRelay(["ask", "--provider", "missing", "hello"], cwd).result;

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown provider 'missing'/);
});

test("relay gc preview reports missing GC command before calling a provider", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  const rawPath = join(cwd, ".relay", "memory", "session.raw.md");
  writeFileSync(rawPath, "# Raw Session History\nNeed to compact this.");

  const result = runRelay(["gc", "preview"], cwd).result;

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /configure gc\.command or provider\.commands/);
});
