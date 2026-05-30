import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRelayMcpServer } from "./mcp-server.js";

const distDir = dirname(fileURLToPath(import.meta.url));
const relayBin = join(distDir, "index.js");
const canSpawnNode = !spawnSync(process.execPath, ["--version"], { encoding: "utf8" }).error;

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "relay-cli-test-"));
}

function tempGitWorkspace(): string {
  const cwd = tempWorkspace();
  spawnSync("git", ["init"], { cwd, encoding: "utf8" });
  mkdirSync(join(cwd, "src"));
  writeFileSync(join(cwd, "src", "app.ts"), "export const app = true;\n");
  writeFileSync(join(cwd, "package.json"), "{}\n");
  spawnSync("git", ["add", "src/app.ts", "package.json"], { cwd, encoding: "utf8" });
  return cwd;
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

async function withMcpServer<T>(cwd: string, fn: (request: (method: string, params?: unknown) => Promise<Record<string, unknown>>) => Promise<T>): Promise<T> {
  const input = new PassThrough();
  const output = new PassThrough();
  const server = createRelayMcpServer(cwd);
  const responses: Record<number, Record<string, unknown>> = {};
  const waiters = new Map<number, (message: Record<string, unknown>) => void>();
  let nextId = 1;

  output.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n").filter(Boolean)) {
      const message = JSON.parse(line) as Record<string, unknown>;
      const id = message.id as number | undefined;
      if (id === undefined) continue;
      const waiter = waiters.get(id);
      if (waiter) {
        waiters.delete(id);
        waiter(message);
      } else {
        responses[id] = message;
      }
    }
  });

  await server.connect(new StdioServerTransport(input, output));

  const request = async (method: string, params?: unknown): Promise<Record<string, unknown>> => {
    const id = nextId++;
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    if (responses[id]) return responses[id];
    return await new Promise((resolve) => waiters.set(id, resolve));
  };

  await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "relay-test-client", version: "0.1.0" }
  });
  input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

  try {
    return await fn(request);
  } finally {
    await server.close();
  }
}

function parseToolJson(response: Record<string, unknown>): Record<string, unknown> {
  assert.ok("result" in response);
  const result = response.result as { content: Array<{ type: string; text?: string }> };
  const content = result.content;
  const first = content[0];
  assert.equal(first.type, "text");
  return JSON.parse(first.text ?? "{}");
}

test("relay init writes provider-neutral default config and memory files", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const { cwd, result } = runRelay(["init"]);

  assert.equal(result.status, 0);
  const config = JSON.parse(readFileSync(join(cwd, ".relay", "config.json"), "utf8"));
  assert.equal(config.provider.default, "default");
  assert.equal(config.tokens.provider, "generic");
  assert.equal(config.tokens.model, "default");
  assert.match(readFileSync(join(cwd, ".relay", "memory", "session.raw.md"), "utf8"), /Raw Session History/);
  assert.ok(existsSync(join(cwd, ".relay", "memory", "project-rules.md")), "project-rules.md created");
  assert.ok(existsSync(join(cwd, ".relay", "memory", "architecture-notes.md")), "architecture-notes.md created");
  assert.ok(existsSync(join(cwd, ".relay", "memory", "source-snapshot.md")), "source-snapshot.md created");
});

test("relay ask includes static block content from memory files in payload", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  writeFileSync(join(cwd, ".relay", "memory", "project-rules.md"), "# Project Rules\n\nAlways write tests.");
  writeFileSync(join(cwd, ".relay", "memory", "source-snapshot.md"), "# Source Snapshot\n\nexport const VERSION = '1.0.0';");

  const result = runRelay(["ask", "check the rules"], cwd).result;

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Always write tests\./);
  assert.match(result.stdout, /VERSION = '1\.0\.0'/);
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

test("relay ask appends prompt activity to raw session history", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  const result = runRelay(["ask", "capture this context"], cwd).result;
  const rawHistory = readFileSync(join(cwd, ".relay", "memory", "session.raw.md"), "utf8");

  assert.equal(result.status, 0);
  assert.match(rawHistory, /## Ask - /);
  assert.match(rawHistory, /- route: stdout/);
  assert.match(rawHistory, /- provider: none/);
  assert.match(rawHistory, /- budget_status: ok/);
  assert.match(rawHistory, /### Prompt\n\ncapture this context/);
});

test("relay ask --provider records provider route and exit code in raw session history", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  const configPath = join(cwd, ".relay", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.provider.commands = {
    test: [process.execPath, "-e", "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));"]
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  const result = runRelay(["ask", "--provider", "test", "send through provider"], cwd).result;
  const rawHistory = readFileSync(join(cwd, ".relay", "memory", "session.raw.md"), "utf8");

  assert.equal(result.status, 0);
  assert.match(rawHistory, /- route: provider/);
  assert.match(rawHistory, /- provider: test/);
  assert.match(rawHistory, /- provider_exit_code: 0/);
  assert.match(rawHistory, /### Prompt\n\nsend through provider/);
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
  assert.equal(report.prefix.matches_session, true);
});

test("relay session start writes per-zone prefix hashes", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  const result = runRelay(["session", "start"], cwd).result;
  const session = JSON.parse(readFileSync(join(cwd, ".relay", "session.json"), "utf8"));

  assert.equal(result.status, 0);
  assert.equal(typeof session.prefix_hash, "string");
  assert.equal(typeof session.static_block_hash, "string");
  assert.equal(typeof session.state_layer_hash, "string");
  assert.match(session.static_block_hash, /^[a-f0-9]{64}$/);
  assert.match(session.state_layer_hash, /^[a-f0-9]{64}$/);
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

test("relay cache inspect returns expanded prefix diagnostics", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  const result = runRelay(["cache", "inspect"], cwd).result;
  const report = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(typeof report.prefix.current_hash, "string");
  assert.equal(report.prefix.session_hash, null);
  assert.equal(report.prefix.matches_session, null);
  assert.deepEqual(report.prefix.drift_reasons, []);
  assert.equal(typeof report.zones.static_block, "number");
  assert.equal(typeof report.zones.state_layer, "number");
  assert.equal(typeof report.zones.dynamic_input, "number");
  assert.equal(typeof report.zones.total, "number");
  assert.deepEqual(report.findings.dynamic_content_in_prefix, []);
  assert.equal(report.session.exists, false);
  assert.equal(report.cost, undefined);
});

test("relay cache inspect reports session hash comparison after session start", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  assert.equal(runRelay(["session", "start"], cwd).result.status, 0);

  const result = runRelay(["cache", "inspect"], cwd).result;
  const report = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(report.session.exists, true);
  assert.equal(typeof report.prefix.session_hash, "string");
  assert.equal(typeof report.prefix.current_zone_hashes.static_block, "string");
  assert.equal(typeof report.prefix.current_zone_hashes.state_layer, "string");
  assert.equal(typeof report.prefix.session_zone_hashes.static_block, "string");
  assert.equal(typeof report.prefix.session_zone_hashes.state_layer, "string");
  assert.deepEqual(report.prefix.changed_zones, []);
  assert.deepEqual(report.prefix.drift_reasons, []);
  assert.equal(report.prefix.matches_session, true);
  assert.equal(typeof report.session.static_block_hash, "string");
  assert.equal(typeof report.session.state_layer_hash, "string");
});

test("relay cache inspect reports corrupted session files clearly", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  writeFileSync(join(cwd, ".relay", "session.json"), "{");

  const result = runRelay(["cache", "inspect"], cwd).result;

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /session\.json is corrupted/);
});

test("relay cache inspect reports cache-aware cost when pricing flags are provided", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  const result = runRelay([
    "cache",
    "inspect",
    "--input-cost-per-million",
    "10",
    "--cached-input-cost-per-million",
    "1",
    "--expected-cache-hit-rate",
    "0.5"
  ], cwd).result;
  const report = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(report.cost.inputCostPerMillion, 10);
  assert.equal(report.cost.cachedInputCostPerMillion, 1);
  assert.equal(report.cost.expectedCacheHitRate, 0.5);
  assert.equal(report.cost.cacheEligibleTokens, report.zones.static_block + report.zones.state_layer);
  assert.equal(report.cost.dynamicTokens, report.zones.dynamic_input);
  assert.equal(report.cost.totalTokens, report.zones.total);
  assert.equal(typeof report.cost.uncachedCost, "number");
  assert.equal(typeof report.cost.cacheAdjustedCost, "number");
  assert.equal(typeof report.cost.estimatedSavings, "number");
});

test("relay cache inspect rejects invalid cost flags clearly", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  const result = runRelay(["cache", "inspect", "--expected-cache-hit-rate", "1.5"], cwd).result;

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be between 0 and 1/);
});

test("relay cache warm --dry-run prints provider command and stable warmup payload", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  const configPath = join(cwd, ".relay", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.provider.commands = {
    test: [process.execPath, "-e", "process.stdin.resume();"]
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  const result = runRelay(["cache", "warm", "--provider", "test", "--dry-run"], cwd).result;

  assert.equal(result.status, 0);
  assert.match(result.stderr, /Prefix hash: [a-f0-9]{64}/);
  assert.match(result.stderr, /Token breakdown:/);
  assert.match(result.stderr, /\[dry-run\] /);
  assert.match(result.stdout, /---BEGIN RELAY PAYLOAD---/);
  assert.match(result.stdout, /<STATIC_BLOCK>/);
  assert.match(result.stdout, /<STATE_LAYER>/);
  assert.match(result.stdout, /<DYNAMIC_INPUT>/);
  assert.match(result.stdout, /## User Prompt\n\(cache warm\)/);
  assert.doesNotMatch(result.stdout, /diff --git/);
});

test("relay cache warm reports missing provider config clearly", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  const result = runRelay(["cache", "warm", "--provider", "missing", "--dry-run"], cwd).result;

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown provider 'missing'/);
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

test("relay ask prefix hash is stable when only the prompt changes", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  // Capture prefix hash before any ask call
  const before = JSON.parse(runRelay(["context", "inspect"], cwd).result.stdout);
  const hashBefore: string = before.prefix.current_hash;

  // Run ask — the prompt goes into DYNAMIC_INPUT only, never into the prefix
  assert.equal(runRelay(["ask", "first prompt — this is volatile content"], cwd).result.status, 0);

  // Capture prefix hash after ask
  const after = JSON.parse(runRelay(["context", "inspect"], cwd).result.stdout);
  const hashAfter: string = after.prefix.current_hash;

  assert.equal(hashBefore, hashAfter, "prefix hash (STATIC_BLOCK + STATE_LAYER) must be identical across calls with different prompts — cache stability invariant");
});

test("relay doctor reports warnings before Relay init without failing", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const result = runRelay(["doctor"], tempGitWorkspace()).result;
  const report = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(report.status, "warning");
  assert.equal(report.checks.find((check: { id: string }) => check.id === "relay_workspace").status, "warning");
});

test("relay doctor reports initialized workspace diagnostics", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempGitWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  const result = runRelay(["doctor"], cwd).result;
  const report = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(report.status, "warning");
  assert.equal(report.checks.find((check: { id: string }) => check.id === "config").status, "ok");
  assert.equal(report.checks.find((check: { id: string }) => check.id === "provider_command").status, "warning");
});

test("relay doctor exits nonzero on corrupted config", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempGitWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  writeFileSync(join(cwd, ".relay", "config.json"), "{");

  const result = runRelay(["doctor"], cwd).result;
  const report = JSON.parse(result.stdout);

  assert.notEqual(result.status, 0);
  assert.equal(report.status, "error");
  assert.equal(report.checks.find((check: { id: string }) => check.id === "config").status, "error");
});

test("relay mcp lists read-only context tools", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, async () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  await withMcpServer(cwd, async (request) => {
    const response = await request("tools/list", {});
    const result = response.result as { tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> };
    const names = result.tools.map((tool) => tool.name).sort();

    assert.deepEqual(names, [
      "get_git_delta",
      "get_project_context",
      "get_prompt_payload",
      "get_semantic_state",
      "get_token_budget",
      "inspect_context_health"
    ]);
    assert.ok(result.tools.every((tool) => tool.annotations?.readOnlyHint === true));
  });
});

test("relay mcp get_prompt_payload returns Relay zones", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, async () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  await withMcpServer(cwd, async (request) => {
    const response = await request("tools/call", {
      name: "get_prompt_payload",
      arguments: { prompt: "summarize this repo" }
    });
    assert.ok("result" in response);
    const result = response.result as { content: Array<{ type: string; text: string }> };
    assert.equal(result.content.length, 3);
    assert.match(result.content[0].text, /# Static Block/);
    assert.match(result.content[1].text, /# State Layer/);
    assert.match(result.content[2].text, /summarize this repo/);
  });
});

test("relay mcp get_git_delta reports truncation", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, async () => {
  const cwd = tempGitWorkspace();
  // Commit the initial files so getCurrentGitSha() returns a real SHA and git diff works
  spawnSync("git", ["-c", "user.email=test@test.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", "commit", "-m", "init"], { cwd, encoding: "utf8" });
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  assert.equal(runRelay(["session", "start"], cwd).result.status, 0);
  writeFileSync(join(cwd, "src", "app.ts"), "export const app = false;\nexport const changed = true;\n");

  await withMcpServer(cwd, async (request) => {
    const result = parseToolJson(await request("tools/call", {
      name: "get_git_delta",
      arguments: { max_chars: 20 }
    }));

    assert.equal(typeof result.base_ref, "string");
    assert.ok((result.base_ref as string).length > 0);
    assert.equal(result.truncated, true);
    assert.equal(result.returned_chars, 20);
    assert.equal((result.diff as string).length, 20);
  });
});

test("relay mcp inspect_context_health reports corrupted session without crashing", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, async () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  writeFileSync(join(cwd, ".relay", "session.json"), "{");

  await withMcpServer(cwd, async (request) => {
    const result = parseToolJson(await request("tools/call", {
      name: "inspect_context_health",
      arguments: {}
    }));
    const findings = result.findings as Array<{ id: string; status: string; message: string }>;

    assert.equal(result.status, "error");
    assert.equal(findings.find((finding) => finding.id === "session")?.status, "error");
  });
});

test("relay session start writes real git tracked paths", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempGitWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  const result = runRelay(["session", "start"], cwd).result;
  const session = JSON.parse(readFileSync(join(cwd, ".relay", "session.json"), "utf8"));

  assert.equal(result.status, 0);
  assert.deepEqual(session.tracked_paths, ["package.json", "src/app.ts"]);
});

test("relay session end removes session.json", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempGitWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  assert.equal(runRelay(["session", "start"], cwd).result.status, 0);
  assert.ok(existsSync(join(cwd, ".relay", "session.json")));

  const result = runRelay(["session", "end"], cwd).result;

  assert.equal(result.status, 0);
  assert.ok(!existsSync(join(cwd, ".relay", "session.json")));
  assert.match(result.stdout, /session ended/i);
});

test("relay session end reports message when no session is active", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  const result = runRelay(["session", "end"], cwd).result;

  assert.equal(result.status, 0);
  assert.match(result.stdout, /No active session/);
});

test("relay session end --reset-memory resets raw history and semantic state", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempGitWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  assert.equal(runRelay(["session", "start"], cwd).result.status, 0);
  writeFileSync(join(cwd, ".relay", "memory", "session.raw.md"), "# Raw Session History\nsome history");

  const result = runRelay(["session", "end", "--reset-memory"], cwd).result;

  assert.equal(result.status, 0);
  const raw = readFileSync(join(cwd, ".relay", "memory", "session.raw.md"), "utf8");
  assert.equal(raw.trim(), "# Raw Session History");
});

test("relay init creates .gitignore with Relay session data entries when none exists", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const { cwd, result } = runRelay(["init"]);

  assert.equal(result.status, 0);
  const gitignore = readFileSync(join(cwd, ".gitignore"), "utf8");
  assert.match(gitignore, /\.relay\/memory\/session\.raw\.md/);
  assert.match(gitignore, /\.relay\/session\.json/);
});

test("relay init appends Relay entries to existing .gitignore without duplicating", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  writeFileSync(join(cwd, ".gitignore"), "node_modules\ndist\n");
  runRelay(["init"], cwd);
  runRelay(["init"], cwd);

  const gitignore = readFileSync(join(cwd, ".gitignore"), "utf8");
  const sessionRawLines = gitignore.split("\n").filter(l => l.trim() === ".relay/memory/session.raw.md");
  assert.equal(sessionRawLines.length, 1, ".relay/memory/session.raw.md should appear exactly once");
  assert.match(gitignore, /node_modules/);
});

test("relay init does not modify .gitignore that already contains .relay", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  const original = "node_modules\n.relay\ndist\n";
  writeFileSync(join(cwd, ".gitignore"), original);
  runRelay(["init"], cwd);

  const gitignore = readFileSync(join(cwd, ".gitignore"), "utf8");
  assert.equal(gitignore, original, "should not modify .gitignore when .relay directory entry already exists");
});

test("relay ask --model flag is accepted and does not change exit code", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  const result = runRelay(["ask", "--model", "claude-opus-4-7", "hello"], cwd).result;

  assert.equal(result.status, 0);
  assert.match(result.stdout, /---BEGIN RELAY PAYLOAD---/);
});

test("relay ask --model is recorded in raw session history", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  runRelay(["ask", "--model", "claude-opus-4-7", "model test"], cwd);
  const raw = readFileSync(join(cwd, ".relay", "memory", "session.raw.md"), "utf8");

  assert.match(raw, /- model: claude-opus-4-7/);
});

test("relay gc run writes compactedMarkdown to session.compacted.md", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, async () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  const json = JSON.stringify({
    active_target: null,
    current_goal: "write compact tests",
    runtime_errors: [],
    verified_hypotheses: [],
    rejected_hypotheses: [],
    next_actions: ["add more tests"],
    code_changes: []
  });
  const configPath = join(cwd, ".relay", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.gc = {
    ...config.gc,
    command: [process.execPath, "-e", `process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write(${JSON.stringify(json)}); });`]
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  writeFileSync(join(cwd, ".relay", "memory", "session.raw.md"), "# Raw Session History\nSome history here.");

  const result = runRelay(["gc", "run"], cwd).result;

  assert.equal(result.status, 0);
  const compacted = readFileSync(join(cwd, ".relay", "memory", "session.compacted.md"), "utf8");
  assert.match(compacted, /write compact tests/);
  assert.match(compacted, /# Compacted Session/);
});

test("relay mcp get_project_context returns workspace cwd", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, async () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  await withMcpServer(cwd, async (request) => {
    const result = parseToolJson(await request("tools/call", {
      name: "get_project_context",
      arguments: {}
    }));
    assert.equal(result.cwd, cwd);
  });
});

test("relay mcp get_token_budget returns zone token counts", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, async () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  await withMcpServer(cwd, async (request) => {
    const result = parseToolJson(await request("tools/call", {
      name: "get_token_budget",
      arguments: { prompt: "test prompt" }
    }));
    assert.equal(typeof (result.zones as { total: number }).total, "number");
    assert.equal((result.budget as { status: string }).status, "ok");
  });
});

test("relay mcp get_semantic_state reports state path and valid json", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, async () => {
  const cwd = tempWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);

  await withMcpServer(cwd, async (request) => {
    const result = parseToolJson(await request("tools/call", {
      name: "get_semantic_state",
      arguments: {}
    }));
    assert.equal(result.exists, true);
    assert.equal(result.valid_json, true);
    assert.ok((result.semantic_state_path as string).endsWith("semantic-state.json"));
  });
});

function readAuditEvents(cwd: string): Array<Record<string, unknown>> {
  const path = join(cwd, ".relay", "audit.log");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

test("relay ask enriches the audit ledger with prefix hash and zone tokens; prefix_stable goes false then true", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempGitWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  assert.equal(runRelay(["session", "start"], cwd).result.status, 0);

  assert.equal(runRelay(["ask", "same prompt"], cwd).result.status, 0);
  assert.equal(runRelay(["ask", "same prompt"], cwd).result.status, 0);

  const asks = readAuditEvents(cwd).filter((e) => e.event === "ask");
  assert.ok(asks.length >= 2);
  const [first, second] = asks.slice(-2);
  assert.equal(typeof first.prefix_hash, "string");
  assert.equal(typeof first.static_block_tokens, "number");
  assert.equal(typeof first.tokenizer, "string");
  assert.equal(first.prefix_stable, false, "first ask has no predecessor");
  assert.equal(second.prefix_stable, true, "second identical ask is prefix-stable");
});

test("relay ask --measure parses provider usage into the audit ledger", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempGitWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  assert.equal(runRelay(["session", "start"], cwd).result.status, 0);
  const configPath = join(cwd, ".relay", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const envelope = JSON.stringify({ type: "result", usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 5, output_tokens: 20 } });
  config.provider.commands = {
    claude: [process.execPath, "-e", `process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write(${JSON.stringify(envelope)}); process.exit(0); });`]
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  const result = runRelay(["ask", "--provider", "claude", "--measure", "measure me"], cwd).result;
  assert.equal(result.status, 0);

  const asks = readAuditEvents(cwd).filter((e) => e.event === "ask" && e.usage_source === "provider");
  assert.equal(asks.length, 1);
  const ev = asks[0];
  assert.equal(ev.usage_input_tokens, 10);
  assert.equal(ev.usage_cached_input_tokens, 90);
  assert.equal(ev.usage_cache_creation_tokens, 5);
  assert.equal(ev.usage_output_tokens, 20);
  assert.equal(typeof ev.prefix_hash, "string");
});

test("relay usage record writes a manual usage event", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempGitWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  const result = runRelay(["usage", "record", "--input", "100", "--cached-input", "900", "--cache-creation", "50", "--output", "200"], cwd).result;
  assert.equal(result.status, 0);

  const usage = readAuditEvents(cwd).filter((e) => e.event === "usage");
  assert.equal(usage.length, 1);
  assert.equal(usage[0].usage_source, "manual");
  assert.equal(usage[0].usage_input_tokens, 100);
  assert.equal(usage[0].usage_cached_input_tokens, 900);
});

test("relay savings --json reports measured and projected sections", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, () => {
  const cwd = tempGitWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  assert.equal(runRelay(["session", "start"], cwd).result.status, 0);
  assert.equal(runRelay(["ask", "warm the ledger"], cwd).result.status, 0);
  assert.equal(runRelay(["usage", "record", "--input", "100", "--cached-input", "900", "--cache-creation", "50", "--output", "200"], cwd).result.status, 0);

  const result = runRelay(["savings", "--input-cost-per-million", "3", "--cached-input-cost-per-million", "0.3", "--json"], cwd).result;
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.measured.callsWithUsage, 1);
  assert.equal(typeof report.measured.savings, "number");
  assert.ok(report.projected.estimate);
  assert.equal(typeof report.stability.stabilityRate, "number");
});
