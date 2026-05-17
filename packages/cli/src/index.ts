#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { appendFileSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { runMcpServer } from "./mcp-server.js";
import {
  DEFAULT_RELAY_CONFIG,
  RelayConfigSchema,
  buildPromptPayload,
  buildStaticBlock,
  buildStateLayer,
  buildDynamicInput,
  checkTokenBudget,
  compactHistoryToState,
  createEmptySemanticState,
  createSessionSnapshot,
  createShellProvider,
  detectPromptLoop,
  estimateTokens,
  estimateZoneAwareInputCost,
  getGitDiffSince,
  getPrefixHash,
  inspectCacheDiagnostics,
  inspectZoneTokens,
  listTrackedFiles,
  runRelayDoctor,
  serializeSemanticState
} from "@relay/core";
import type { RelayConfig } from "@relay/core";

const program = new Command();
const relayDir = join(process.cwd(), ".relay");
const callLogPath = join(relayDir, "calls.json");

function ensureRelayDir(): void {
  mkdirSync(join(relayDir, "memory"), { recursive: true });
}

function readOptional(path: string, fallback = ""): string {
  return existsSync(path) ? readFileSync(path, "utf8") : fallback;
}

function readRelayConfig(): RelayConfig {
  const configPath = join(relayDir, "config.json");
  const configText = readOptional(configPath, "");
  if (!configText) return DEFAULT_RELAY_CONFIG;

  try {
    return RelayConfigSchema.parse(JSON.parse(configText));
  } catch (error) {
    process.stderr.write(`Error: .relay/config.json is invalid: ${(error as Error).message}\n`);
    process.exit(1);
  }
}

function parseNonNegativeNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InvalidArgumentError("must be a non-negative number");
  }
  return parsed;
}

function parseCacheHitRate(value: string): number {
  const parsed = parseNonNegativeNumber(value);
  if (parsed > 1) {
    throw new InvalidArgumentError("must be between 0 and 1");
  }
  return parsed;
}

function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

function readCallLog(): number[] {
  try {
    return JSON.parse(readOptional(callLogPath, "[]"));
  } catch {
    return [];
  }
}

function writeCallLog(timestamps: number[]): void {
  const windowMs = 60_000;
  const now = Date.now();
  const pruned = timestamps.filter((t) => now - t <= windowMs * 2);
  writeFileSync(callLogPath, JSON.stringify(pruned));
}

function printZoneBreakdown(zones: ReturnType<typeof buildZonesForAsk>): void {
  const report = inspectZoneTokens(zones);
  process.stderr.write(
    `Token breakdown:\n` +
    `  static_block  ${report.staticBlock.toLocaleString()}\n` +
    `  state_layer   ${report.stateLayer.toLocaleString()}\n` +
    `  dynamic_input ${report.dynamicInput.toLocaleString()}\n` +
    `  total         ${report.total.toLocaleString()}\n`
  );
}

function buildZonesForAsk(prompt: string, baseRef: string, semanticState: string, files: string) {
  return {
    staticBlock: buildStaticBlock({}),
    stateLayer: buildStateLayer({ semanticStateJson: semanticState, fileIndex: files }),
    dynamicInput: buildDynamicInput({ prompt, gitDiff: getGitDiffSince(baseRef) })
  };
}

function parseSessionJson(sessionText: string): Record<string, unknown> {
  try {
    return JSON.parse(sessionText);
  } catch {
    process.stderr.write("Error: .relay/session.json is corrupted. Delete it and run `relay session start`.\n");
    process.exit(1);
  }
}

function appendAskHistory(entry: {
  prompt: string;
  budgetTokens: number;
  budgetStatus: string;
  baseRef: string;
  route: string;
  provider?: string;
  providerExitCode?: number;
}): void {
  const rawPath = join(relayDir, "memory", "session.raw.md");
  const lines = [
    "",
    `## Ask - ${new Date().toISOString()}`,
    "",
    `- route: ${entry.route}`,
    `- provider: ${entry.provider ?? "none"}`,
    `- base_ref: ${entry.baseRef}`,
    `- budget_status: ${entry.budgetStatus}`,
    `- budget_tokens: ${entry.budgetTokens}`,
  ];
  if (entry.providerExitCode !== undefined) {
    lines.push(`- provider_exit_code: ${entry.providerExitCode}`);
  }
  lines.push("", "### Prompt", "", entry.prompt, "");
  appendFileSync(rawPath, `${lines.join("\n")}\n`);
}

program
  .name("relay")
  .description("Local-first context and prompt-cache optimizer for coding CLIs.")
  .version("0.1.0");

program.command("init").description("Initialize Relay in the current repository.").action(() => {
  ensureRelayDir();
  writeFileSync(join(relayDir, "config.json"), JSON.stringify(DEFAULT_RELAY_CONFIG, null, 2));
  writeFileSync(join(relayDir, "memory", "semantic-state.json"), serializeSemanticState(createEmptySemanticState()));
  writeFileSync(join(relayDir, "memory", "session.raw.md"), "# Raw Session History\n");
  writeFileSync(join(relayDir, "memory", "session.compacted.md"), "# Compacted Session History\n");
  console.log("Initialized .relay workspace.");
});

const session = program.command("session").description("Manage Relay sessions.");
session.command("start").description("Start a git-anchored Relay session.").action(() => {
  ensureRelayDir();
  const trackedPaths = listTrackedFiles();
  const staticBlock = buildStaticBlock({});
  const stateLayer = buildStateLayer({
    semanticStateJson: serializeSemanticState(createEmptySemanticState()),
    fileIndex: trackedPaths.slice(0, 200).join("\n")
  });
  const prefixHash = getPrefixHash(staticBlock, stateLayer);
  const snapshot = createSessionSnapshot(trackedPaths, {
    prefixHash,
    staticBlockHash: getPrefixHash(staticBlock, ""),
    stateLayerHash: getPrefixHash(stateLayer, "")
  });
  writeFileSync(join(relayDir, "session.json"), JSON.stringify(snapshot, null, 2));
  console.log(`Started Relay session ${snapshot.session_id}.`);
  console.log(`Base git SHA: ${snapshot.base_git_sha}`);
  console.log(`Prefix hash: ${snapshot.prefix_hash}`);
});
session.command("status").description("Show current Relay session metadata.").action(() => {
  console.log(readOptional(join(relayDir, "session.json"), "No active session found."));
});

program.command("ask")
  .argument("<prompt>", "Prompt to route through Relay context construction.")
  .description("Build a cache-optimized prompt payload.")
  .option("--provider <name>", "Route the payload through a configured provider")
  .option("--dry-run", "Print the resolved command and payload without executing")
  .action(async (prompt: string, options: { provider?: string; dryRun?: boolean }) => {
    ensureRelayDir();

    // Anomaly detection — include current call before checking threshold
    const callLog = readCallLog();
    const updatedLog = [...callLog, Date.now()];
    writeCallLog(updatedLog);
    const anomaly = detectPromptLoop(updatedLog);
    if (anomaly.anomalous) {
      process.stderr.write(`Warning: anomalous call rate detected — ${anomaly.reasons.join("; ")}\n`);
    }

    const cfg = readRelayConfig();
    const semanticState = readOptional(join(relayDir, "memory", "semantic-state.json"), serializeSemanticState(createEmptySemanticState()));
    const files = listTrackedFiles().slice(0, 200).join("\n");
    const sessionText = readOptional(join(relayDir, "session.json"), "{}");
    const sessionData = parseSessionJson(sessionText);
    const baseRef = (sessionData.base_git_sha as string | undefined) ?? "HEAD";

    const zones = buildZonesForAsk(prompt, baseRef, semanticState, files);
    const payload = buildPromptPayload(zones);
    const budget = checkTokenBudget(payload, cfg.tokens);

    printZoneBreakdown(zones);

    if (budget.status === "blocked") {
      process.stderr.write(`Error: ${budget.message} Run \`relay gc run\` to compact context.\n`);
      process.exit(1);
    }

    if (budget.status === "requires_confirmation") {
      process.stderr.write(`Warning: ${budget.message} (${budget.tokens.toLocaleString()} tokens)\n`);
      process.stderr.write(`Tip: run \`relay gc run\` to compact context before proceeding.\n`);
      const ok = await confirm("Proceed anyway?");
      if (!ok) {
        process.stderr.write("Aborted.\n");
        process.exit(0);
      }
    } else if (budget.status === "warning") {
      process.stderr.write(`Warning: ${budget.message} (${budget.tokens.toLocaleString()} tokens)\n`);
    }

    if (options.dryRun) {
      const name = options.provider ?? cfg.provider.default;
      let provider;
      try { provider = createShellProvider(name, cfg); }
      catch (err) { process.stderr.write(`${(err as Error).message}\n`); process.exit(1); }
      appendAskHistory({
        prompt,
        budgetTokens: budget.tokens,
        budgetStatus: budget.status,
        baseRef,
        route: "dry-run",
        provider: name
      });
      process.stderr.write(`[dry-run] ${provider.commandLine} < <relay-payload>\n`);
      console.log("---BEGIN RELAY PAYLOAD---");
      console.log(payload);
      console.log("---END RELAY PAYLOAD---");
      return;
    }

    if (options.provider) {
      let provider;
      try { provider = createShellProvider(options.provider, cfg); }
      catch (err) { process.stderr.write(`${(err as Error).message}\n`); process.exit(1); }
      const exitCode = await provider.sendPrompt(payload);
      appendAskHistory({
        prompt,
        budgetTokens: budget.tokens,
        budgetStatus: budget.status,
        baseRef,
        route: "provider",
        provider: options.provider,
        providerExitCode: exitCode
      });
      process.exit(exitCode);
    }

    appendAskHistory({
      prompt,
      budgetTokens: budget.tokens,
      budgetStatus: budget.status,
      baseRef,
      route: "stdout"
    });
    console.log("---BEGIN RELAY PAYLOAD---");
    console.log(payload);
    console.log("---END RELAY PAYLOAD---");
  });

program.command("diff").description("Show git diff since current session base SHA.").action(() => {
  const sessionText = readOptional(join(relayDir, "session.json"), "{}");
  const sessionData = parseSessionJson(sessionText);
  console.log(getGitDiffSince((sessionData.base_git_sha as string | undefined) ?? "HEAD"));
});

program.command("doctor").description("Check whether the current workspace is ready for Relay dogfooding.").action(() => {
  const report = runRelayDoctor(process.cwd());
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "error") {
    process.exit(1);
  }
});

program.command("mcp").description("Run Relay as a read-only MCP context server over stdio.").action(async () => {
  await runMcpServer();
});

const cache = program.command("cache").description("Inspect deterministic prompt-cache metadata.");
cache.command("fingerprint").description("Print current static/state prefix hash.").action(() => {
  const semanticState = readOptional(join(relayDir, "memory", "semantic-state.json"), serializeSemanticState(createEmptySemanticState()));
  const staticBlock = buildStaticBlock({});
  const stateLayer = buildStateLayer({ semanticStateJson: semanticState });
  console.log(getPrefixHash(staticBlock, stateLayer));
});
cache.command("inspect")
  .description("Inspect cache-relevant prefix details.")
  .option("--input-cost-per-million <number>", "Input token cost per million tokens", parseNonNegativeNumber)
  .option("--cached-input-cost-per-million <number>", "Cached input token cost per million tokens", parseNonNegativeNumber)
  .option("--expected-cache-hit-rate <number>", "Expected prefix cache hit rate from 0 to 1", parseCacheHitRate)
  .action((options: {
    inputCostPerMillion?: number;
    cachedInputCostPerMillion?: number;
    expectedCacheHitRate?: number;
  }) => {
    ensureRelayDir();
    const semanticState = readOptional(join(relayDir, "memory", "semantic-state.json"), serializeSemanticState(createEmptySemanticState()));
    const sessionPath = join(relayDir, "session.json");
    const sessionExists = existsSync(sessionPath);
    const sessionData = sessionExists ? parseSessionJson(readFileSync(sessionPath, "utf8")) : {};
    const baseRef = (sessionData.base_git_sha as string | undefined) ?? "HEAD";
    const files = listTrackedFiles().slice(0, 200).join("\n");
    const staticBlock = buildStaticBlock({});
    const stateLayer = buildStateLayer({ semanticStateJson: semanticState, fileIndex: files });
    const dynamicInput = buildDynamicInput({ prompt: "(cache inspect)", gitDiff: getGitDiffSince(baseRef) });
    const savedPrefixHash = sessionData.prefix_hash as string | undefined;
    const savedStaticBlockHash = sessionData.static_block_hash as string | undefined;
    const savedStateLayerHash = sessionData.state_layer_hash as string | undefined;
    const report: ReturnType<typeof inspectCacheDiagnostics> & {
      cost?: ReturnType<typeof estimateZoneAwareInputCost>;
    } = inspectCacheDiagnostics({
      staticBlock,
      stateLayer,
      dynamicInput,
      sessionPrefixHash: savedPrefixHash,
      sessionStaticBlockHash: savedStaticBlockHash,
      sessionStateLayerHash: savedStateLayerHash,
      session: {
        exists: sessionExists,
        session_id: sessionData.session_id ?? null,
        base_git_sha: sessionData.base_git_sha ?? null,
        prefix_hash: savedPrefixHash ?? null,
        static_block_hash: savedStaticBlockHash ?? null,
        state_layer_hash: savedStateLayerHash ?? null,
        created_at: sessionData.created_at ?? null,
        tracked_path_count: Array.isArray(sessionData.tracked_paths) ? sessionData.tracked_paths.length : 0
      }
    });

    if (options.inputCostPerMillion !== undefined) {
      report.cost = estimateZoneAwareInputCost({
        staticBlockTokens: report.zones.static_block,
        stateLayerTokens: report.zones.state_layer,
        dynamicInputTokens: report.zones.dynamic_input,
        inputCostPerMillion: options.inputCostPerMillion,
        cachedInputCostPerMillion: options.cachedInputCostPerMillion,
        expectedCacheHitRate: options.expectedCacheHitRate
      });
    }

    console.log(JSON.stringify(report, null, 2));
  });
cache.command("warm")
  .description("Send a stable prefix-shaped payload to a configured provider.")
  .option("--provider <name>", "Route the warmup payload through a configured provider")
  .option("--dry-run", "Print the resolved command and payload without executing")
  .action(async (options: { provider?: string; dryRun?: boolean }) => {
    ensureRelayDir();
    const cfg = readRelayConfig();
    const semanticState = readOptional(join(relayDir, "memory", "semantic-state.json"), serializeSemanticState(createEmptySemanticState()));
    const files = listTrackedFiles().slice(0, 200).join("\n");
    const zones = {
      staticBlock: buildStaticBlock({}),
      stateLayer: buildStateLayer({ semanticStateJson: semanticState, fileIndex: files }),
      dynamicInput: buildDynamicInput({ prompt: "(cache warm)", gitDiff: "" })
    };
    const payload = buildPromptPayload(zones);
    const budget = checkTokenBudget(payload, cfg.tokens);
    const name = options.provider ?? cfg.provider.default;

    process.stderr.write(`Prefix hash: ${getPrefixHash(zones.staticBlock, zones.stateLayer)}\n`);
    printZoneBreakdown(zones);

    if (budget.status === "blocked") {
      process.stderr.write(`Error: ${budget.message} Run \`relay gc run\` to compact context.\n`);
      process.exit(1);
    }

    if (budget.status === "requires_confirmation") {
      process.stderr.write(`Warning: ${budget.message} (${budget.tokens.toLocaleString()} tokens)\n`);
      process.stderr.write(`Tip: run \`relay gc run\` to compact context before proceeding.\n`);
      const ok = await confirm("Proceed anyway?");
      if (!ok) {
        process.stderr.write("Aborted.\n");
        process.exit(0);
      }
    } else if (budget.status === "warning") {
      process.stderr.write(`Warning: ${budget.message} (${budget.tokens.toLocaleString()} tokens)\n`);
    }

    let provider;
    try { provider = createShellProvider(name, cfg); }
    catch (err) { process.stderr.write(`${(err as Error).message}\n`); process.exit(1); }

    if (options.dryRun) {
      process.stderr.write(`[dry-run] ${provider.commandLine} < <relay-payload>\n`);
      console.log("---BEGIN RELAY PAYLOAD---");
      console.log(payload);
      console.log("---END RELAY PAYLOAD---");
      return;
    }

    process.exit(await provider.sendPrompt(payload));
  });

const tokens = program.command("tokens").description("Estimate and inspect local token usage.");
tokens.command("estimate").argument("[text...]", "Text to estimate.").action((text: string[] = []) => {
  console.log(estimateTokens(text.join(" ")));
});
tokens.command("budget").description("Show current token budget.").action(() => {
  console.log(JSON.stringify(readRelayConfig().tokens, null, 2));
});
tokens.command("inspect").description("Show zone-by-zone token breakdown for the current session state.").action(() => {
  ensureRelayDir();
  const semanticState = readOptional(join(relayDir, "memory", "semantic-state.json"), serializeSemanticState(createEmptySemanticState()));
  const files = listTrackedFiles().slice(0, 200).join("\n");
  const sessionText = readOptional(join(relayDir, "session.json"), "{}");
  const sessionData = parseSessionJson(sessionText);
  const baseRef = (sessionData.base_git_sha as string | undefined) ?? "HEAD";
  const zones = buildZonesForAsk("(inspect)", baseRef, semanticState, files);
  const report = inspectZoneTokens(zones);
  const cfg = readRelayConfig().tokens;
  console.log(JSON.stringify({
    zones: {
      static_block: report.staticBlock,
      state_layer: report.stateLayer,
      dynamic_input: report.dynamicInput,
      total: report.total
    },
    budget: {
      warning_limit: cfg.warningLimit,
      confirmation_threshold: cfg.requireConfirmationAbove,
      hard_limit: cfg.hardLimit,
      status: checkTokenBudget(buildPromptPayload(zones), cfg).status
    }
  }, null, 2));
});

const gc = program.command("gc").description("Manage token garbage collection.");
gc.command("status").description("Show GC configuration.").action(() => {
  console.log(JSON.stringify(readRelayConfig().gc, null, 2));
});

gc.command("run").description("Compact session history into semantic state using the configured GC command.").action(async () => {
  ensureRelayDir();
  const cfg = readRelayConfig();
  const rawPath = join(relayDir, "memory", "session.raw.md");
  const statePath = join(relayDir, "memory", "semantic-state.json");
  const snapshotPath = join(relayDir, "memory", "semantic-state.snapshot.json");

  const rawFull = readOptional(rawPath);
  const rawHistory = rawFull.replace(/^#\s*Raw Session History\s*/m, "").trim();
  if (!rawHistory) {
    console.log("Session history is empty — nothing to compact.");
    return;
  }

  const existingJson = readOptional(statePath, serializeSemanticState(createEmptySemanticState()));
  let existingState: ReturnType<typeof createEmptySemanticState>;
  try {
    existingState = JSON.parse(existingJson);
  } catch {
    process.stderr.write("Error: semantic-state.json is corrupted. Run `relay gc restore` or `relay init`.\n");
    process.exit(1);
  }

  writeFileSync(snapshotPath, existingJson);
  const gcCommand = cfg.gc.command ?? cfg.provider.commands?.[cfg.provider.default];
  if (!gcCommand || gcCommand.length === 0) {
    process.stderr.write("Error: configure gc.command or provider.commands for the default provider before running `relay gc run`.\n");
    process.exit(1);
  }
  process.stderr.write(`Compacting session history via ${gcCommand.join(" ")}...\n`);

  try {
    const result = await compactHistoryToState(rawHistory, existingState, { command: gcCommand });
    writeFileSync(statePath, serializeSemanticState(result.semanticState));
    writeFileSync(rawPath, "# Raw Session History\n");
    console.log(`Compacted: ${result.originalApproxTokens.toLocaleString()} → ${result.compactedApproxTokens.toLocaleString()} tokens.`);
    console.log("Snapshot saved to semantic-state.snapshot.json. Run `relay gc restore` to roll back.");
  } catch (err) {
    process.stderr.write(`GC failed: ${(err as Error).message}\n`);
    process.exit(1);
  }
});

gc.command("preview").description("Preview compacted state without writing anything.").action(async () => {
  ensureRelayDir();
  const rawPath = join(relayDir, "memory", "session.raw.md");
  const statePath = join(relayDir, "memory", "semantic-state.json");

  const rawHistory = readOptional(rawPath).replace(/^#\s*Raw Session History\s*/m, "").trim();
  if (!rawHistory) {
    console.log("Session history is empty — nothing to preview.");
    return;
  }

  let existingState: ReturnType<typeof createEmptySemanticState>;
  try {
    existingState = JSON.parse(readOptional(statePath, serializeSemanticState(createEmptySemanticState())));
  } catch {
    process.stderr.write("Error: semantic-state.json is corrupted. Run `relay gc restore` or `relay init`.\n");
    process.exit(1);
  }
  process.stderr.write("Previewing compaction (no changes will be written)...\n");
  const cfg = readRelayConfig();
  const gcCommand = cfg.gc.command ?? cfg.provider.commands?.[cfg.provider.default];
  if (!gcCommand || gcCommand.length === 0) {
    process.stderr.write("Error: configure gc.command or provider.commands for the default provider before running `relay gc preview`.\n");
    process.exit(1);
  }

  try {
    const result = await compactHistoryToState(rawHistory, existingState, { command: gcCommand });
    console.log(`Tokens: ${result.originalApproxTokens.toLocaleString()} → ${result.compactedApproxTokens.toLocaleString()}`);
    console.log("\nNew semantic state:");
    console.log(serializeSemanticState(result.semanticState));
  } catch (err) {
    process.stderr.write(`GC preview failed: ${(err as Error).message}\n`);
    process.exit(1);
  }
});

gc.command("restore").description("Roll back to the previous semantic state snapshot.").action(() => {
  const snapshotPath = join(relayDir, "memory", "semantic-state.snapshot.json");
  const statePath = join(relayDir, "memory", "semantic-state.json");
  if (!existsSync(snapshotPath)) {
    process.stderr.write("No snapshot found. Run `relay gc run` first to create one.\n");
    process.exit(1);
  }
  writeFileSync(statePath, readFileSync(snapshotPath));
  console.log("Restored semantic state from snapshot.");
});

const context = program.command("context").description("Inspect context construction state.");
context.command("inspect").description("Print current context construction diagnostics.").action(() => {
  ensureRelayDir();
  const cfg = readRelayConfig();
  const statePath = join(relayDir, "memory", "semantic-state.json");
  const sessionPath = join(relayDir, "session.json");
  const semanticStateExists = existsSync(statePath);
  const semanticState = readOptional(statePath, serializeSemanticState(createEmptySemanticState()));
  let semanticStateValidJson = true;
  try {
    JSON.parse(semanticState);
  } catch {
    semanticStateValidJson = false;
  }

  const sessionExists = existsSync(sessionPath);
  const sessionData = sessionExists ? parseSessionJson(readFileSync(sessionPath, "utf8")) : {};
  const baseRef = (sessionData.base_git_sha as string | undefined) ?? "HEAD";
  const files = listTrackedFiles().slice(0, 200).join("\n");
  const gitDiff = getGitDiffSince(baseRef);
  const zones = {
    staticBlock: buildStaticBlock({}),
    stateLayer: buildStateLayer({ semanticStateJson: semanticState, fileIndex: files }),
    dynamicInput: buildDynamicInput({ prompt: "(inspect)", gitDiff })
  };
  const zoneTokens = inspectZoneTokens(zones);
  const currentPrefixHash = getPrefixHash(zones.staticBlock, zones.stateLayer);
  const savedPrefixHash = sessionData.prefix_hash as string | undefined;
  const budget = checkTokenBudget(buildPromptPayload(zones), cfg.tokens);

  console.log(JSON.stringify({
    session: {
      exists: sessionExists,
      session_id: sessionData.session_id ?? null,
      base_git_sha: sessionData.base_git_sha ?? null,
      prefix_hash: savedPrefixHash ?? null,
      created_at: sessionData.created_at ?? null,
      tracked_path_count: Array.isArray(sessionData.tracked_paths) ? sessionData.tracked_paths.length : 0
    },
    prefix: {
      current_hash: currentPrefixHash,
      session_hash: savedPrefixHash ?? null,
      matches_session: savedPrefixHash ? currentPrefixHash === savedPrefixHash : null
    },
    zones: {
      static_block: zoneTokens.staticBlock,
      state_layer: zoneTokens.stateLayer,
      dynamic_input: zoneTokens.dynamicInput,
      total: zoneTokens.total
    },
    budget: {
      warning_limit: cfg.tokens.warningLimit,
      confirmation_threshold: cfg.tokens.requireConfirmationAbove,
      hard_limit: cfg.tokens.hardLimit,
      status: budget.status
    },
    state: {
      semantic_state_path: statePath,
      exists: semanticStateExists,
      valid_json: semanticStateValidJson
    },
    git: {
      base_ref: baseRef,
      diff_present: gitDiff.trim().length > 0,
      diff_tokens: estimateTokens(gitDiff).tokens
    }
  }, null, 2));
});

await program.parseAsync();
