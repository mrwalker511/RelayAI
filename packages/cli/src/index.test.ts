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

test("relay context inspect reports diagnostics without an active session", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  const result = runRelay(["context", "inspect"], cwd).result;
  const report = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(report.session.exists, false);
  assert.equal(report.prefix.matches_session, null);
  assert.equal(typeof report.prefix.current_hash, "string");
  assert.equal(typeof report.zones.total, "number");
  assert.equal(report.budget.status, "ok");
  assert.equal(report.state.exists, true);
  assert.equal(report.state.valid_json, true);
});

test("relay context inspect reports session prefix comparison when a session exists", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  assert.equal(runRelay(["session", "start"], cwd).result.status, 0);

  const result = runRelay(["context", "inspect"], cwd).result;
  const report = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(report.session.exists, true);
  assert.equal(typeof report.session.prefix_hash, "string");
  assert.equal(typeof report.prefix.matches_session, "boolean");
});

test("relay context inspect uses configured token budget limits", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  const configPath = join(cwd, ".relay", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.tokens.warningLimit = 10;
  config.tokens.requireConfirmationAbove = 20;
  config.tokens.hardLimit = 30;
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  const result = runRelay(["context", "inspect"], cwd).result;
  const report = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(report.budget.warning_limit, 10);
  assert.equal(report.budget.confirmation_threshold, 20);
  assert.equal(report.budget.hard_limit, 30);
});

test("relay context inspect reports corrupted session files clearly", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  writeFileSync(join(cwd, ".relay", "session.json"), "{");

  const result = runRelay(["context", "inspect"], cwd).result;

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /session\.json is corrupted/);
});

test("relay tokens budget uses configured token limits", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  const configPath = join(cwd, ".relay", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.tokens.warningLimit = 111;
  config.tokens.requireConfirmationAbove = 222;
  config.tokens.hardLimit = 333;
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  const result = runRelay(["tokens", "budget"], cwd).result;
  const budget = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(budget.warningLimit, 111);
  assert.equal(budget.requireConfirmationAbove, 222);
  assert.equal(budget.hardLimit, 333);
});

test("relay tokens inspect uses configured token limits", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  const configPath = join(cwd, ".relay", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.tokens.warningLimit = 111;
  config.tokens.requireConfirmationAbove = 222;
  config.tokens.hardLimit = 333;
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  const result = runRelay(["tokens", "inspect"], cwd).result;
  const report = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(report.budget.warning_limit, 111);
  assert.equal(report.budget.confirmation_threshold, 222);
  assert.equal(report.budget.hard_limit, 333);
});

test("relay gc status uses configured GC settings", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  const configPath = join(cwd, ".relay", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.gc.enabled = false;
  config.gc.historyTokenLimit = 1234;
  config.gc.targetSummaryTokens = 321;
  config.gc.command = ["example-gc"];
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  const result = runRelay(["gc", "status"], cwd).result;
  const gc = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(gc.enabled, false);
  assert.equal(gc.historyTokenLimit, 1234);
  assert.equal(gc.targetSummaryTokens, 321);
  assert.deepEqual(gc.command, ["example-gc"]);
});
