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
  assert.equal(typeof report.prefix.matches_session, "boolean");
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
    const result = parseToolJson(await request("tools/call", {
      name: "get_prompt_payload",
      arguments: { prompt: "summarize this repo" }
    }));

    assert.equal(result.blocked, false);
    assert.equal((result.budget as { status: string }).status, "ok");
    assert.match(result.payload as string, /<STATIC_BLOCK>/);
    assert.match(result.payload as string, /<STATE_LAYER>/);
    assert.match(result.payload as string, /<DYNAMIC_INPUT>/);
    assert.match(result.payload as string, /summarize this repo/);
  });
});

test("relay mcp get_git_delta reports truncation", { skip: canSpawnNode ? false : "nested Node execution is unavailable in this sandbox" }, async () => {
  const cwd = tempGitWorkspace();
  assert.equal(runRelay(["init"], cwd).result.status, 0);
  assert.equal(runRelay(["session", "start"], cwd).result.status, 0);
  writeFileSync(join(cwd, "src", "app.ts"), "export const app = false;\nexport const changed = true;\n");

  await withMcpServer(cwd, async (request) => {
    const result = parseToolJson(await request("tools/call", {
      name: "get_git_delta",
      arguments: { max_chars: 20 }
    }));

    assert.equal(result.base_ref, "HEAD");
    assert.equal(result.truncated, true);
    assert.equal(result.returned_chars, 20);
    assert.match(result.diff as string, /diff/);
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
