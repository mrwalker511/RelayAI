#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { appendFileSync, mkdirSync, unlinkSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { runMcpServer } from "./mcp-server.js";
import { BASH_COMPLETION, ZSH_COMPLETION, FISH_COMPLETION, installHint } from "./completions.js";
import {
  DEFAULT_RELAY_CONFIG,
  RelayConfigSchema,
  buildPromptPayload,
  buildPrioritizedFileIndex,
  buildStaticBlock,
  buildStateLayer,
  buildDynamicInput,
  checkTokenBudget,
  compactHistoryToState,
  createEmptySemanticState,
  createSessionSnapshot,
  createShellProvider,
  createShellProviderForTask,
  detectPromptLoop,
  estimateTokens,
  estimateZoneAwareInputCost,
  getGitDiffSince,
  getGitDiffSinceAsync,
  getStagedDiff,
  getStagedDiffAsync,
  getPrefixHash,
  inspectCacheDiagnostics,
  inspectZoneTokens,
  listTrackedFiles,
  buildPrioritizedFileIndexAsync,
  loadHierarchicalContext,
  renderBranchSections,
  readOptional,
  resolveTokenBudget,
  runRelayDoctor,
  serializeSemanticState,
  appendAuditEvent,
  readAuditLog,
  filterAuditLog,
  parseProviderUsage,
  computeMeasuredSavings,
  summarizePrefixStability,
  projectSavingsFromHistory,
  deepMerge
} from "@relay/core";
import type { RelayConfig, StaticBlockInput, TokenEstimateOptions, ProviderUsage, ZoneTokenReport } from "@relay/core";

const program = new Command();
const _pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const _pkgVersion = (JSON.parse(readFileSync(join(_pkgDir, "package.json"), "utf8")) as { version: string }).version;
const relayDir = join(process.cwd(), ".relay");
const callLogPath = join(relayDir, "calls.json");
const auditLogPath = join(relayDir, "audit.log");

function auditAppend(cfg: RelayConfig, fields: { event: string; session_id: string | null; [key: string]: unknown }): void {
  if (!cfg.audit.enabled) return;
  try {
    appendAuditEvent(auditLogPath, fields, cfg.audit.maxLines);
  } catch (err) {
    process.stderr.write(`[relay] Warning: could not write to audit log: ${(err as Error).message}\n`);
  }
}

/** Prefix hash of the most recent prior `ask` event for the same session (null-session matches null-session). */
function previousAskPrefixHash(sessionId: string | null): string | undefined {
  const events = readAuditLog(auditLogPath).filter(
    (e) => e.event === "ask" && (e.session_id ?? null) === sessionId
  );
  for (let i = events.length - 1; i >= 0; i--) {
    const h = events[i].prefix_hash;
    if (typeof h === "string") return h;
  }
  return undefined;
}

function ensureRelayDir(): void {
  try {
    mkdirSync(join(relayDir, "memory"), { recursive: true });
  } catch (err) {
    process.stderr.write(`Error: cannot create .relay workspace: ${(err as Error).message}\nCheck directory permissions and available disk space.\n`);
    process.exit(1);
  }
}

function readRelayConfig(): RelayConfig {
  // Load optional base config from RELAY_BASE_CONFIG env var (file path)
  let baseRaw: Record<string, unknown> = {};
  const baseConfigPath = process.env["RELAY_BASE_CONFIG"];
  if (baseConfigPath) {
    const baseText = readOptional(baseConfigPath, "");
    if (!baseText) {
      process.stderr.write(`Warning: RELAY_BASE_CONFIG file not found: ${baseConfigPath}\n`);
    } else {
      try {
        baseRaw = JSON.parse(baseText) as Record<string, unknown>;
      } catch {
        process.stderr.write(`Error: RELAY_BASE_CONFIG file is not valid JSON: ${baseConfigPath}\n`);
        process.exit(1);
      }
      const baseValidation = RelayConfigSchema.safeParse(baseRaw);
      if (!baseValidation.success) {
        process.stderr.write(`Error: RELAY_BASE_CONFIG file is invalid: ${baseConfigPath}\n  ${baseValidation.error.message}\n`);
        process.exit(1);
      }
    }
  }

  // Load local .relay/config.json (overrides base)
  const configPath = join(relayDir, "config.json");
  const configText = readOptional(configPath, "");
  const localRaw: Record<string, unknown> = configText ? (() => {
    try { return JSON.parse(configText) as Record<string, unknown>; }
    catch { process.stderr.write("Error: .relay/config.json is not valid JSON.\n"); process.exit(1); }
  })() : {};

  // Deep-merge base ← local, then validate through Zod (fills remaining defaults)
  const merged = baseConfigPath ? deepMerge(baseRaw, localRaw) : localRaw;
  try {
    return RelayConfigSchema.parse(merged);
  } catch (error) {
    const src = baseConfigPath ? "merged config" : ".relay/config.json";
    process.stderr.write(`Error: ${src} is invalid: ${(error as Error).message}\n`);
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
  if (!process.stdin.isTTY) {
    process.stderr.write(`Warning: cannot prompt — stdin is not a TTY. Re-run interactively or raise the token budget in .relay/config.json.\n`);
    return Promise.resolve(false);
  }
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
  const pruned = timestamps.filter((t) => now - t <= windowMs);
  writeFileSync(callLogPath, JSON.stringify(pruned));
}

function tokenizerOptionsFor(cfg?: RelayConfig): TokenEstimateOptions | undefined {
  return cfg ? { provider: cfg.tokens.provider, model: cfg.tokens.model } : undefined;
}

/**
 * Reads the static-block inputs plus the volatile, prompt-selected hierarchical
 * branches. The stable trunk goes into the static block (cacheable prefix); the
 * branches are returned separately so callers can place them in DYNAMIC_INPUT.
 */
function readContextInputs(
  dir: string,
  opts?: { cfg?: RelayConfig; prompt?: string; gitDiff?: string }
): { staticBlockInput: StaticBlockInput; relevantContext?: string } {
  const projectRules = readOptional(join(dir, "memory", "project-rules.md")) || undefined;
  const architectureNotes = readOptional(join(dir, "memory", "architecture-notes.md")) || undefined;

  const snapshotRaw = readOptional(join(dir, "memory", "source-snapshot.md")) || undefined;
  const sigemapPath = join(dir, "sigmap.md");
  const sourceSnapshot =
    snapshotRaw && !snapshotRaw.includes("Paste stable key source files here")
      ? snapshotRaw
      : existsSync(sigemapPath) ? readFileSync(sigemapPath, "utf8") : snapshotRaw;

  let domainContext: string | undefined;
  let relevantContext: string | undefined;
  if (opts?.cfg?.context.hierarchical) {
    const contextDir = join(process.cwd(), opts.cfg.context.contextDir);
    const hc = loadHierarchicalContext({
      contextDir,
      prompt: opts.prompt,
      gitDiff: opts.gitDiff,
      maxBranches: opts.cfg.context.maxBranches,
    });
    domainContext = hc.trunk;
    relevantContext = renderBranchSections(hc.branches) || undefined;
  }

  return {
    staticBlockInput: { projectRules, architectureNotes, sourceSnapshot, domainContext },
    relevantContext,
  };
}

function readStaticBlockInput(
  dir: string,
  opts?: { cfg?: RelayConfig; prompt?: string; gitDiff?: string }
): StaticBlockInput {
  return readContextInputs(dir, opts).staticBlockInput;
}

function safeGetGitDiff(baseRef: string): string {
  try {
    return getGitDiffSince(baseRef);
  } catch (err) {
    process.stderr.write(`Warning: could not read git diff — ${(err as Error).message}\n`);
    return "";
  }
}

function safeGetStagedDiff(): string {
  try {
    return getStagedDiff();
  } catch (err) {
    process.stderr.write(`Warning: could not read staged diff — ${(err as Error).message}\n`);
    return "";
  }
}

async function safeGetGitDiffAsync(baseRef: string): Promise<string> {
  try {
    return await getGitDiffSinceAsync(baseRef);
  } catch (err) {
    process.stderr.write(`Warning: could not read git diff — ${(err as Error).message}\n`);
    return "";
  }
}

async function safeGetStagedDiffAsync(): Promise<string> {
  try {
    return await getStagedDiffAsync();
  } catch (err) {
    process.stderr.write(`Warning: could not read staged diff — ${(err as Error).message}\n`);
    return "";
  }
}

function buildZonesForAsk(
  prompt: string,
  baseRef: string,
  semanticState: string,
  files: string,
  staticBlockInput: StaticBlockInput = {},
  diffOverride?: string,
  diffMode?: "full" | "summarized" | "auto",
  includeTimestamp?: boolean,
  relevantContext?: string,
  tokenizerOptions?: TokenEstimateOptions
) {
  return {
    staticBlock: buildStaticBlock(staticBlockInput),
    stateLayer: buildStateLayer({ semanticStateJson: semanticState, fileIndex: files }),
    dynamicInput: buildDynamicInput({
      prompt,
      gitDiff: diffOverride ?? safeGetGitDiff(baseRef),
      diffMode,
      includeTimestamp,
      relevantContext,
      tokenizerOptions
    })
  };
}

function printZoneBreakdown(report: ZoneTokenReport): void {
  process.stderr.write(
    `Token breakdown:\n` +
    `  static_block  ${report.staticBlock.toLocaleString()}\n` +
    `  state_layer   ${report.stateLayer.toLocaleString()}\n` +
    `  dynamic_input ${report.dynamicInput.toLocaleString()}\n` +
    `  total         ${report.total.toLocaleString()}\n`
  );
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
  model?: string;
  providerExitCode?: number;
}): void {
  const rawPath = join(relayDir, "memory", "session.raw.md");
  const lines = [
    "",
    `## Ask - ${new Date().toISOString()}`,
    "",
    `- route: ${entry.route}`,
    `- provider: ${entry.provider ?? "none"}`,
    `- model: ${entry.model ?? "default"}`,
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
  .version(_pkgVersion);

program.command("init").description("Initialize Relay in the current repository.").action(() => {
  ensureRelayDir();
  const configPath = join(relayDir, "config.json");
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(DEFAULT_RELAY_CONFIG, null, 2));
  } else {
    process.stderr.write("config.json already exists — skipping (existing configuration preserved).\n");
  }
  const semanticStatePath = join(relayDir, "memory", "semantic-state.json");
  if (!existsSync(semanticStatePath)) {
    writeFileSync(semanticStatePath, serializeSemanticState(createEmptySemanticState()));
  } else {
    process.stderr.write("memory/semantic-state.json already exists — skipping (existing state preserved).\n");
  }
  const rawHistoryPath = join(relayDir, "memory", "session.raw.md");
  if (!existsSync(rawHistoryPath)) {
    writeFileSync(rawHistoryPath, "# Raw Session History\n");
  }
  const compactedHistoryPath = join(relayDir, "memory", "session.compacted.md");
  if (!existsSync(compactedHistoryPath)) {
    writeFileSync(compactedHistoryPath, "# Compacted Session History\n");
  }
  if (!existsSync(join(relayDir, "memory", "project-rules.md"))) {
    writeFileSync(join(relayDir, "memory", "project-rules.md"), "# Project Rules\n\nAdd project-specific coding conventions and rules here.\n");
  }
  if (!existsSync(join(relayDir, "memory", "architecture-notes.md"))) {
    writeFileSync(join(relayDir, "memory", "architecture-notes.md"), "# Architecture Notes\n\nDocument stable architectural decisions and patterns here.\n");
  }
  if (!existsSync(join(relayDir, "memory", "source-snapshot.md"))) {
    writeFileSync(join(relayDir, "memory", "source-snapshot.md"), "# Source Snapshot\n\nPaste stable key source files here to maximize prompt-cache prefix size.\n");
  }
  const gitignorePath = join(process.cwd(), ".gitignore");
  const gitignoreContent = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  const alreadyCovered =
    gitignoreContent.includes(".relay/memory/session.raw.md") ||
    gitignoreContent.split("\n").some((line) => line.trim() === ".relay");
  if (!alreadyCovered) {
    const gitignoreEntry = "# Relay session data\n.relay/memory/session.raw.md\n.relay/memory/session.compacted.md\n.relay/memory/semantic-state.json\n.relay/memory/semantic-state.snapshot.json\n.relay/session.json\n.relay/calls.json\n.relay/audit.log\n";
    appendFileSync(gitignorePath, gitignoreContent.endsWith("\n") || gitignoreContent === "" ? gitignoreEntry : `\n${gitignoreEntry}`);
    process.stderr.write("Updated .gitignore to exclude Relay session data.\n");
  }
  process.stderr.write("Initialized .relay workspace.\n");
});

const session = program.command("session").description("Manage Relay sessions.");
session.command("start").description("Start a git-anchored Relay session.").action(() => {
  ensureRelayDir();
  const cfg = readRelayConfig();
  const trackedPaths = listTrackedFiles();
  const staticBlock = buildStaticBlock(readStaticBlockInput(relayDir));
  const stateLayer = buildStateLayer({
    semanticStateJson: serializeSemanticState(createEmptySemanticState()),
    fileIndex: buildPrioritizedFileIndex(process.cwd(), { limit: cfg.files.maxIndex }).join("\n")
  });
  const prefixHash = getPrefixHash(staticBlock, stateLayer);
  const snapshot = createSessionSnapshot(trackedPaths, {
    prefixHash,
    staticBlockHash: getPrefixHash(staticBlock, ""),
    stateLayerHash: getPrefixHash(stateLayer, "")
  });
  writeFileSync(join(relayDir, "session.json"), JSON.stringify(snapshot, null, 2));
  auditAppend(cfg, {
    event: "session_start",
    session_id: snapshot.session_id,
    base_git_sha: snapshot.base_git_sha,
    prefix_hash: snapshot.prefix_hash ?? null,
    tracked_path_count: snapshot.tracked_paths.length
  });
  console.log(`Started Relay session ${snapshot.session_id}.`);
  console.log(`Base git SHA: ${snapshot.base_git_sha}`);
  console.log(`Prefix hash: ${snapshot.prefix_hash}`);
});
session.command("status").description("Show current Relay session metadata.").action(() => {
  console.log(readOptional(join(relayDir, "session.json"), "No active session found."));
});
session.command("end")
  .description("End the current Relay session, removing session metadata.")
  .option("--reset-memory", "Also reset raw history and semantic state to empty defaults")
  .action((options: { resetMemory?: boolean }) => {
    const sessionPath = join(relayDir, "session.json");
    if (!existsSync(sessionPath)) {
      console.log("No active session to end.");
      return;
    }
    const cfg = readRelayConfig();
    const sessionData = parseSessionJson(readFileSync(sessionPath, "utf8"));
    unlinkSync(sessionPath);
    auditAppend(cfg, {
      event: "session_end",
      session_id: (sessionData.session_id as string | undefined) ?? null,
      reset_memory: options.resetMemory ?? false
    });
    console.log("Relay session ended.");
    if (options.resetMemory) {
      writeFileSync(join(relayDir, "memory", "session.raw.md"), "# Raw Session History\n");
      writeFileSync(join(relayDir, "memory", "semantic-state.json"), serializeSemanticState(createEmptySemanticState()));
      console.log("Memory files reset to defaults.");
    }
  });

program.command("ask")
  .argument("<prompt>", "Prompt to route through Relay context construction.")
  .description("Build a cache-optimized prompt payload.")
  .option("--provider <name>", "Route the payload through a configured provider")
  .option("--model <model>", "Model name for token cost estimation (e.g. claude-opus-4-7)")
  .option("--dry-run", "Print the resolved command and payload without executing")
  .option("--staged", "Use staged diff instead of full session diff")
  .option("--diff-mode <mode>", "Diff rendering mode: full | summarized | auto (default: auto)")
  .option("--include-timestamp", "Include ISO timestamp in dynamic input zone")
  .option("--measure", "Capture provider usage for measured savings (auto-adds --output-format json for the claude builtin)")
  .action(async (prompt: string, options: { provider?: string; model?: string; dryRun?: boolean; staged?: boolean; diffMode?: "full" | "summarized" | "auto"; includeTimestamp?: boolean; measure?: boolean }) => {
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
    const activeSessionText = readOptional(join(relayDir, "session.json"), "{}");
    const activeSessionData = parseSessionJson(activeSessionText);
    const activeSessionId = (activeSessionData.session_id as string | undefined) ?? null;

    if (anomaly.anomalous) {
      auditAppend(cfg, {
        event: "anomaly",
        session_id: activeSessionId,
        event_count: updatedLog.length,
        window_ms: 60_000
      });
    }
    const semanticState = readOptional(join(relayDir, "memory", "semantic-state.json"), serializeSemanticState(createEmptySemanticState()));
    const baseRef = (activeSessionData.base_git_sha as string | undefined) ?? "HEAD";

    // Parallelize the two git subprocess calls — they're independent of each other.
    const [filesArr, activeDiff] = await Promise.all([
      buildPrioritizedFileIndexAsync(process.cwd(), { limit: cfg.files.maxIndex }),
      options.staged ? safeGetStagedDiffAsync() : safeGetGitDiffAsync(baseRef),
    ]);
    const files = filesArr.join("\n");
    const { staticBlockInput: staticInput, relevantContext } = readContextInputs(relayDir, { cfg, prompt, gitDiff: activeDiff });
    const tokenizerOptions = tokenizerOptionsFor(cfg);
    const zones = buildZonesForAsk(prompt, baseRef, semanticState, files, staticInput, activeDiff, options.diffMode, options.includeTimestamp, relevantContext, tokenizerOptions);
    const payload = buildPromptPayload(zones);
    const resolvedTokens = resolveTokenBudget(cfg);
    const budget = checkTokenBudget(payload, resolvedTokens, tokenizerOptions);

    // Compute zone token report once and share it with printZoneBreakdown and the audit ledger.
    const zoneReport = inspectZoneTokens(zones, tokenizerOptions);
    printZoneBreakdown(zoneReport);
    const askPrefixHash = getPrefixHash(zones.staticBlock, zones.stateLayer);
    const prevPrefixHash = previousAskPrefixHash(activeSessionId);
    const ledgerFields = {
      prefix_hash: askPrefixHash,
      static_block_hash: getPrefixHash(zones.staticBlock, ""),
      state_layer_hash: getPrefixHash(zones.stateLayer, ""),
      static_block_tokens: zoneReport.staticBlock,
      state_layer_tokens: zoneReport.stateLayer,
      dynamic_input_tokens: zoneReport.dynamicInput,
      tokenizer: estimateTokens(zones.staticBlock, tokenizerOptions).tokenizer,
      prefix_stable: prevPrefixHash !== undefined && prevPrefixHash === askPrefixHash
    };

    if (budget.status === "blocked") {
      auditAppend(cfg, {
        event: "budget_blocked",
        session_id: activeSessionId,
        budget_tokens: budget.tokens,
        hard_limit: resolvedTokens.hardLimit
      });
      process.stderr.write(`Error: ${budget.message} Run \`relay gc run\` to compact context.\n`);
      process.exit(1);
    }

    if (budget.status === "requires_confirmation") {
      process.stderr.write(`Warning: ${budget.message} (${budget.tokens.toLocaleString()} tokens)\n`);
      process.stderr.write(`Tip: run \`relay gc run\` to compact context before proceeding.\n`);
      const ok = await confirm("Proceed anyway?");
      if (!ok) {
        process.stderr.write("Operation cancelled.\n");
        process.exit(1);
      }
    } else if (budget.status === "warning") {
      auditAppend(cfg, {
        event: "budget_warning",
        session_id: activeSessionId,
        budget_tokens: budget.tokens,
        warning_limit: resolvedTokens.warningLimit
      });
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
        provider: name,
        model: options.model
      });
      auditAppend(cfg, {
        event: "ask",
        session_id: activeSessionId,
        route: "dry-run",
        provider: name,
        model: options.model ?? null,
        budget_status: budget.status,
        budget_tokens: budget.tokens,
        prompt_chars: prompt.length,
        ...ledgerFields
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
      if (options.measure) provider = provider.withMeasure();
      const result = await provider.sendPrompt(payload, { capture: options.measure });
      const exitCode = result.exitCode;

      let usage: ProviderUsage | null = null;
      if (options.measure) {
        usage = result.capturedOutput ? parseProviderUsage(provider.name, result.capturedOutput) : null;
        if (!usage) {
          process.stderr.write("[relay] --measure: could not parse provider usage; record it with `relay usage record`.\n");
        }
      }

      appendAskHistory({
        prompt,
        budgetTokens: budget.tokens,
        budgetStatus: budget.status,
        baseRef,
        route: "provider",
        provider: options.provider,
        model: options.model,
        providerExitCode: exitCode
      });
      auditAppend(cfg, {
        event: "ask",
        session_id: activeSessionId,
        route: "provider",
        provider: options.provider,
        model: options.model ?? null,
        budget_status: budget.status,
        budget_tokens: budget.tokens,
        prompt_chars: prompt.length,
        provider_exit_code: exitCode,
        ...ledgerFields,
        ...(usage ? {
          usage_source: "provider",
          usage_input_tokens: usage.inputTokens ?? 0,
          usage_cached_input_tokens: usage.cachedInputTokens ?? 0,
          usage_cache_creation_tokens: usage.cacheCreationTokens ?? 0,
          usage_output_tokens: usage.outputTokens ?? 0
        } : {})
      });
      process.exit(exitCode);
    }

    appendAskHistory({
      prompt,
      budgetTokens: budget.tokens,
      budgetStatus: budget.status,
      baseRef,
      route: "stdout",
      model: options.model
    });
    auditAppend(cfg, {
      event: "ask",
      session_id: activeSessionId,
      route: "stdout",
      provider: null,
      model: options.model ?? null,
      budget_status: budget.status,
      budget_tokens: budget.tokens,
      prompt_chars: prompt.length,
      ...ledgerFields
    });
    console.log("---BEGIN RELAY PAYLOAD---");
    console.log(payload);
    console.log("---END RELAY PAYLOAD---");
  });

program.command("diff")
  .description("Show git diff since current session base SHA.")
  .option("--staged", "Show staged diff instead of session diff")
  .action((options: { staged?: boolean }) => {
    if (options.staged) {
      console.log(safeGetStagedDiff());
      return;
    }
    const sessionText = readOptional(join(relayDir, "session.json"), "{}");
    const sessionData = parseSessionJson(sessionText);
    console.log(safeGetGitDiff((sessionData.base_git_sha as string | undefined) || "HEAD"));
  });

program.command("doctor").description("Check whether the current workspace is ready for Relay dogfooding.").action(() => {
  const report = runRelayDoctor(process.cwd());
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "error") {
    process.exit(1);
  }
});

program
  .command("mcp")
  .description("Run Relay as a read-only MCP context server over stdio.")
  .option("--cwd <path>", "Project directory for Relay workspace lookup. Defaults to process.cwd().")
  .action(async (opts: { cwd?: string }) => {
    await runMcpServer(opts.cwd);
  });

const cache = program.command("cache").description("Inspect deterministic prompt-cache metadata.");
cache.command("fingerprint").description("Print current static/state prefix hash.").action(() => {
  const semanticState = readOptional(join(relayDir, "memory", "semantic-state.json"), serializeSemanticState(createEmptySemanticState()));
  const staticBlock = buildStaticBlock(readStaticBlockInput(relayDir));
  const stateLayer = buildStateLayer({ semanticStateJson: semanticState });
  console.log(getPrefixHash(staticBlock, stateLayer));
});
cache.command("inspect")
  .description("Inspect cache-relevant prefix details.")
  .option("--input-cost-per-million <number>", "Input token cost per million tokens", parseNonNegativeNumber)
  .option("--cached-input-cost-per-million <number>", "Cached input token cost per million tokens", parseNonNegativeNumber)
  .option("--expected-cache-hit-rate <number>", "Expected prefix cache hit rate from 0 to 1", parseCacheHitRate)
  .option("--use-recorded-history", "Use the measured prefix-stability rate from the audit log instead of --expected-cache-hit-rate")
  .action((options: {
    inputCostPerMillion?: number;
    cachedInputCostPerMillion?: number;
    expectedCacheHitRate?: number;
    useRecordedHistory?: boolean;
  }) => {
    ensureRelayDir();
    const semanticState = readOptional(join(relayDir, "memory", "semantic-state.json"), serializeSemanticState(createEmptySemanticState()));
    const sessionPath = join(relayDir, "session.json");
    const sessionExists = existsSync(sessionPath);
    const sessionData = sessionExists ? parseSessionJson(readFileSync(sessionPath, "utf8")) : {};
    const baseRef = (sessionData.base_git_sha as string | undefined) ?? "HEAD";
    const cfg = readRelayConfig();
    const files = buildPrioritizedFileIndex(process.cwd(), { limit: cfg.files.maxIndex }).join("\n");
    const gitDiff = safeGetGitDiff(baseRef);
    const tokenizerOptions = tokenizerOptionsFor(cfg);
    const { staticBlockInput, relevantContext } = readContextInputs(relayDir, { cfg, prompt: "(cache inspect)", gitDiff });
    const staticBlock = buildStaticBlock(staticBlockInput);
    const stateLayer = buildStateLayer({ semanticStateJson: semanticState, fileIndex: files });
    const dynamicInput = buildDynamicInput({ prompt: "(cache inspect)", gitDiff, relevantContext, tokenizerOptions });
    const savedPrefixHash = sessionData.prefix_hash as string | undefined;
    const savedStaticBlockHash = sessionData.static_block_hash as string | undefined;
    const savedStateLayerHash = sessionData.state_layer_hash as string | undefined;
    const report: ReturnType<typeof inspectCacheDiagnostics> & {
      cost?: ReturnType<typeof estimateZoneAwareInputCost>;
      recorded_stability_rate?: number;
      cache_hit_rate_source?: "recorded" | "flag" | "default";
    } = inspectCacheDiagnostics({
      staticBlock,
      stateLayer,
      dynamicInput,
      sessionPrefixHash: savedPrefixHash,
      sessionStaticBlockHash: savedStaticBlockHash,
      sessionStateLayerHash: savedStateLayerHash,
      tokenizerOptions,
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

    let cacheHitRate = options.expectedCacheHitRate;
    let hitRateSource: "recorded" | "flag" | "default" =
      options.expectedCacheHitRate !== undefined ? "flag" : "default";
    if (options.useRecordedHistory) {
      const stability = summarizePrefixStability(readAuditLog(auditLogPath), sessionData.session_id as string | undefined);
      cacheHitRate = stability.stabilityRate;
      hitRateSource = "recorded";
      report.recorded_stability_rate = stability.stabilityRate;
    }
    report.cache_hit_rate_source = hitRateSource;

    if (options.inputCostPerMillion !== undefined) {
      report.cost = estimateZoneAwareInputCost({
        staticBlockTokens: report.zones.static_block,
        stateLayerTokens: report.zones.state_layer,
        dynamicInputTokens: report.zones.dynamic_input,
        inputCostPerMillion: options.inputCostPerMillion,
        cachedInputCostPerMillion: options.cachedInputCostPerMillion,
        expectedCacheHitRate: cacheHitRate
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
    const files = buildPrioritizedFileIndex(process.cwd(), { limit: cfg.files.maxIndex }).join("\n");
    const tokenizerOptions = tokenizerOptionsFor(cfg);
    const { staticBlockInput, relevantContext } = readContextInputs(relayDir, { cfg, prompt: "(cache warm)", gitDiff: "" });
    const zones = {
      staticBlock: buildStaticBlock(staticBlockInput),
      stateLayer: buildStateLayer({ semanticStateJson: semanticState, fileIndex: files }),
      dynamicInput: buildDynamicInput({ prompt: "(cache warm)", gitDiff: "", relevantContext, tokenizerOptions })
    };
    const payload = buildPromptPayload(zones);
    const resolvedTokens = resolveTokenBudget(cfg);
    const budget = checkTokenBudget(payload, resolvedTokens, tokenizerOptions);
    const name = options.provider ?? cfg.provider.default;

    process.stderr.write(`Prefix hash: ${getPrefixHash(zones.staticBlock, zones.stateLayer)}\n`);
    printZoneBreakdown(inspectZoneTokens(zones, tokenizerOptions));

    if (budget.status === "blocked") {
      process.stderr.write(`Error: ${budget.message} Run \`relay gc run\` to compact context.\n`);
      process.exit(1);
    }

    if (budget.status === "requires_confirmation") {
      process.stderr.write(`Warning: ${budget.message} (${budget.tokens.toLocaleString()} tokens)\n`);
      process.stderr.write(`Tip: run \`relay gc run\` to compact context before proceeding.\n`);
      const ok = await confirm("Proceed anyway?");
      if (!ok) {
        process.stderr.write("Operation cancelled.\n");
        process.exit(1);
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

    const warmResult = await provider.sendPrompt(payload);
    process.exit(warmResult.exitCode);
  });

const tokens = program.command("tokens").description("Estimate and inspect local token usage.");
tokens.command("estimate").argument("[text...]", "Text to estimate.").action((text: string[] = []) => {
  console.log(estimateTokens(text.join(" "), tokenizerOptionsFor(readRelayConfig())));
});
tokens.command("budget").description("Show current token budget.").action(() => {
  console.log(JSON.stringify(readRelayConfig().tokens, null, 2));
});
tokens.command("inspect").description("Show zone-by-zone token breakdown for the current session state.").action(() => {
  ensureRelayDir();
  const cfg = readRelayConfig();
  const semanticState = readOptional(join(relayDir, "memory", "semantic-state.json"), serializeSemanticState(createEmptySemanticState()));
  const files = buildPrioritizedFileIndex(process.cwd(), { limit: cfg.files.maxIndex }).join("\n");
  const sessionText = readOptional(join(relayDir, "session.json"), "{}");
  const sessionData = parseSessionJson(sessionText);
  const baseRef = (sessionData.base_git_sha as string | undefined) || "HEAD";
  const tokenizerOptions = tokenizerOptionsFor(cfg);
  const gitDiff = safeGetGitDiff(baseRef);
  const { staticBlockInput, relevantContext } = readContextInputs(relayDir, { cfg, prompt: "(inspect)", gitDiff });
  const zones = buildZonesForAsk("(inspect)", baseRef, semanticState, files, staticBlockInput, gitDiff, undefined, undefined, relevantContext, tokenizerOptions);
  const report = inspectZoneTokens(zones, tokenizerOptions);
  const resolvedTokens = resolveTokenBudget(cfg);
  console.log(JSON.stringify({
    zones: {
      static_block: report.staticBlock,
      state_layer: report.stateLayer,
      dynamic_input: report.dynamicInput,
      total: report.total
    },
    budget: {
      warning_limit: resolvedTokens.warningLimit,
      confirmation_threshold: resolvedTokens.requireConfirmationAbove,
      hard_limit: resolvedTokens.hardLimit,
      status: checkTokenBudget(buildPromptPayload(zones), resolvedTokens, tokenizerOptions).status
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
  let gcCommand: string[];
  if (cfg.gc.command && cfg.gc.command.length > 0) {
    gcCommand = cfg.gc.command;
  } else {
    try {
      const gcProvider = createShellProviderForTask("gc", cfg);
      gcCommand = gcProvider.commandTemplate;
    } catch {
      process.stderr.write("Error: configure gc.command or provider.commands for the default provider before running `relay gc run`.\n");
      process.exit(1);
    }
  }
  process.stderr.write(`Compacting session history via ${gcCommand.join(" ")}...\n`);

  try {
    const result = await compactHistoryToState(rawHistory, existingState, { command: gcCommand });
    writeFileSync(statePath, serializeSemanticState(result.semanticState));
    writeFileSync(join(relayDir, "memory", "session.compacted.md"), result.compactedMarkdown);
    writeFileSync(rawPath, "# Raw Session History\n");
    const gcSessionText = readOptional(join(relayDir, "session.json"), "{}");
    const gcSessionData = parseSessionJson(gcSessionText);
    auditAppend(cfg, {
      event: "gc_run",
      session_id: (gcSessionData.session_id as string | undefined) ?? null,
      command: gcCommand[0],
      original_approx_tokens: result.originalApproxTokens,
      compacted_approx_tokens: result.compactedApproxTokens,
      ok: true
    });
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
  let gcCommand: string[];
  if (cfg.gc.command && cfg.gc.command.length > 0) {
    gcCommand = cfg.gc.command;
  } else {
    try {
      const gcProvider = createShellProviderForTask("gc", cfg);
      gcCommand = gcProvider.commandTemplate;
    } catch {
      process.stderr.write("Error: configure gc.command or provider.commands for the default provider before running `relay gc preview`.\n");
      process.exit(1);
    }
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
  const files = buildPrioritizedFileIndex(process.cwd(), { limit: cfg.files.maxIndex }).join("\n");
  const gitDiff = safeGetGitDiff(baseRef);
  const tokenizerOptions = tokenizerOptionsFor(cfg);
  const { staticBlockInput, relevantContext } = readContextInputs(relayDir, { cfg, prompt: "(inspect)", gitDiff });
  const zones = {
    staticBlock: buildStaticBlock(staticBlockInput),
    stateLayer: buildStateLayer({ semanticStateJson: semanticState, fileIndex: files }),
    dynamicInput: buildDynamicInput({ prompt: "(inspect)", gitDiff, relevantContext, tokenizerOptions })
  };
  const zoneTokens = inspectZoneTokens(zones, tokenizerOptions);
  const currentPrefixHash = getPrefixHash(zones.staticBlock, zones.stateLayer);
  const savedPrefixHash = sessionData.prefix_hash as string | undefined;
  const resolvedTokens = resolveTokenBudget(cfg);
  const budget = checkTokenBudget(buildPromptPayload(zones), resolvedTokens, tokenizerOptions);

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
      warning_limit: resolvedTokens.warningLimit,
      confirmation_threshold: resolvedTokens.requireConfirmationAbove,
      hard_limit: resolvedTokens.hardLimit,
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
      diff_tokens: estimateTokens(gitDiff, tokenizerOptions).tokens
    }
  }, null, 2));
});

context.command("build")
  .description("Scaffold hierarchical context files at .relay/context/ from docs.")
  .action(() => {
    ensureRelayDir();
    const contextDir = join(relayDir, "context");
    const branchesDir = join(contextDir, "branches");
    mkdirSync(branchesDir, { recursive: true });

    const archPath = join(process.cwd(), "docs", "ARCHITECTURE.md");
    const agentsPath = join(process.cwd(), "AGENTS.md");
    const archContent = existsSync(archPath) ? readFileSync(archPath, "utf8") : "";
    const agentsContent = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : "";

    // Build trunk.md: project overview + commands reference (~300 tokens target)
    const trunkParts: string[] = ["# Project Context Trunk", ""];
    const archIntro = archContent.split(/^---$/m)[0]?.trim() ?? "";
    if (archIntro) trunkParts.push(archIntro, "");
    const agentsCmds = agentsContent.match(/## Commands[\s\S]+?(?=\n## |\n$|$)/)?.[0]?.trim() ?? "";
    if (agentsCmds) trunkParts.push(agentsCmds, "");
    trunkParts.push("_Load domain branches for detailed module context._");
    writeFileSync(join(contextDir, "trunk.md"), trunkParts.join("\n"), "utf8");

    // Extract domain sections from ARCHITECTURE.md
    const domainPatternMap: Record<string, RegExp[]> = {
      context:   [/context\//i, /payload/i, /three.zone/i, /cache strategy/i],
      git:       [/git\//i, /delta/i, /snapshot/i, /git delta/i],
      memory:    [/memory\//i, /garbage/i, /semantic/i, /compaction/i],
      tokens:    [/tokens\//i, /token guardrail/i, /budget/i, /anomaly/i],
      providers: [/providers\//i, /provider adapter/i, /shell/i],
      config:    [/config\//i, /local runtime/i, /\.relay\//i],
    };

    const parts = archContent.split(/^(?=#{2,3} )/m).filter(Boolean);
    const domainSections: Record<string, string[]> = {};
    for (const part of parts) {
      for (const [domain, patterns] of Object.entries(domainPatternMap)) {
        if (patterns.some((p) => p.test(part))) {
          (domainSections[domain] ??= []).push(part.trim());
        }
      }
    }

    let branchCount = 0;
    for (const [domain, sections] of Object.entries(domainSections)) {
      if (sections.length > 0) {
        writeFileSync(join(branchesDir, `${domain}.md`), sections.join("\n\n"), "utf8");
        branchCount++;
      }
    }

    console.log(`Generated .relay/context/trunk.md and ${branchCount} branch files.`);
    console.log("Enable with: set context.hierarchical = true in .relay/config.json");
  });

program.command("audit")
  .description("Inspect the structured audit log.")
  .option("--tail <n>", "Show last N entries", "20")
  .option("--event <type>", "Filter by event type (ask, session_start, session_end, gc_run, anomaly, budget_warning, budget_blocked)")
  .option("--session <id>", "Filter by session ID")
  .option("--json", "Output raw NDJSON instead of a formatted table")
  .action((options: { tail?: string; event?: string; session?: string; json?: boolean }) => {
    const tail = Math.max(1, parseInt(options.tail ?? "20", 10));
    const all = readAuditLog(auditLogPath);
    const filtered = filterAuditLog(all, {
      event: options.event,
      session_id: options.session,
      tail
    });

    if (filtered.length === 0) {
      process.stderr.write("No audit events found.\n");
      return;
    }

    if (options.json) {
      for (const event of filtered) {
        console.log(JSON.stringify(event));
      }
      return;
    }

    // Formatted table: timestamp | event | session | details
    const termWidth = (process.stdout.columns ?? 120);
    const fixedWidth = 24 + 1 + 16 + 1 + 16 + 1; // ts + event + session + spaces
    const detailsWidth = Math.max(20, termWidth - fixedWidth);
    const col = (s: string, width: number) => s.slice(0, width).padEnd(width);
    const header = `${col("timestamp", 24)} ${col("event", 16)} ${col("session", 16)} details`;
    const divider = "-".repeat(Math.min(header.length, termWidth));
    process.stdout.write(`${header}\n${divider}\n`);
    for (const e of filtered) {
      const ts = (e.ts as string).replace("T", " ").replace("Z", "").slice(0, 23);
      const session = (e.session_id as string | null) ?? "-";
      const details = Object.entries(e)
        .filter(([k]) => !["ts", "event", "session_id", "v"].includes(k))
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(" ");
      const truncatedDetails = details.length > detailsWidth ? `${details.slice(0, detailsWidth - 1)}…` : details;
      process.stdout.write(`${col(ts, 24)} ${col(e.event as string, 16)} ${col(session, 16)} ${truncatedDetails}\n`);
    }
  });

const usage = program.command("usage").description("Record and inspect provider token usage.");
usage.command("record")
  .description("Manually record measured provider token usage for savings reporting.")
  .requiredOption("--input <n>", "Full-price input tokens billed", parseNonNegativeNumber)
  .option("--cached-input <n>", "Cache-read input tokens", parseNonNegativeNumber)
  .option("--cache-creation <n>", "Cache-creation (write) tokens", parseNonNegativeNumber)
  .option("--output <n>", "Output tokens", parseNonNegativeNumber)
  .option("--session <id>", "Session id to attribute the usage to")
  .action((opts: { input: number; cachedInput?: number; cacheCreation?: number; output?: number; session?: string }) => {
    ensureRelayDir();
    const cfg = readRelayConfig();
    const sessionFromFile = parseSessionJson(readOptional(join(relayDir, "session.json"), "{}")).session_id as string | undefined;
    auditAppend(cfg, {
      event: "usage",
      session_id: opts.session ?? sessionFromFile ?? null,
      usage_source: "manual",
      usage_input_tokens: opts.input,
      usage_cached_input_tokens: opts.cachedInput ?? 0,
      usage_cache_creation_tokens: opts.cacheCreation ?? 0,
      usage_output_tokens: opts.output ?? 0
    });
    console.log("Recorded manual usage.");
  });

program.command("savings")
  .description("Report measured and projected prompt-cache savings from the audit log.")
  .option("--input-cost-per-million <n>", "Full-price input token cost per million", parseNonNegativeNumber)
  .option("--cached-input-cost-per-million <n>", "Cache-read input token cost per million", parseNonNegativeNumber)
  .option("--cache-creation-cost-per-million <n>", "Cache-write token cost per million (default: input × 1.25)", parseNonNegativeNumber)
  .option("--output-cost-per-million <n>", "Output token cost per million (default: 0)", parseNonNegativeNumber)
  .option("--session <id>", "Limit the report to one session")
  .option("--json", "Emit JSON")
  .action((opts: {
    inputCostPerMillion?: number;
    cachedInputCostPerMillion?: number;
    cacheCreationCostPerMillion?: number;
    outputCostPerMillion?: number;
    session?: string;
    json?: boolean;
  }) => {
    const events = readAuditLog(auditLogPath);
    const stability = summarizePrefixStability(events, opts.session);
    const pricingDefined = opts.inputCostPerMillion !== undefined;
    const cachedInputCostPerMillion = opts.cachedInputCostPerMillion ?? (opts.inputCostPerMillion ?? 0) * 0.1;
    const measured = pricingDefined ? computeMeasuredSavings(events, {
      inputCostPerMillion: opts.inputCostPerMillion!,
      cachedInputCostPerMillion,
      cacheCreationCostPerMillion: opts.cacheCreationCostPerMillion,
      outputCostPerMillion: opts.outputCostPerMillion
    }, opts.session) : null;
    const projected = pricingDefined ? projectSavingsFromHistory(events, {
      inputCostPerMillion: opts.inputCostPerMillion!,
      cachedInputCostPerMillion
    }, opts.session) : null;

    if (opts.json) {
      console.log(JSON.stringify({ stability, measured, projected }, null, 2));
      return;
    }

    const money = (n: number) => `$${n.toFixed(4)}`;
    const out: string[] = [];
    out.push("MEASURED (from recorded provider/manual usage)");
    if (measured && measured.callsWithUsage > 0) {
      out.push(`  calls with usage:    ${measured.callsWithUsage}`);
      out.push(`  input / cache-read:  ${measured.totalInputTokens.toLocaleString()} / ${measured.totalCachedInputTokens.toLocaleString()} tokens`);
      out.push(`  cache-write / output:${measured.totalCacheCreationTokens.toLocaleString()} / ${measured.totalOutputTokens.toLocaleString()} tokens`);
      out.push(`  actual vs baseline:  ${money(measured.actualCost)} vs ${money(measured.baselineCost)}`);
      out.push(`  saved:               ${money(measured.savings)}  (negative on a first/cache-creating call is expected; aggregate is the honest figure)`);
    } else {
      out.push("  (no recorded usage yet — run `relay ask --measure` or `relay usage record`)");
    }
    out.push("");
    out.push("PROJECTED FROM HISTORY (measured prefix-stability rate × zone estimator)");
    out.push(`  prefix-stability:    ${(stability.stabilityRate * 100).toFixed(1)}% over ${stability.asks} ask(s)`);
    if (projected) {
      out.push(`  avg zones (S/St/D):  ${projected.avgStaticBlockTokens} / ${projected.avgStateLayerTokens} / ${projected.avgDynamicInputTokens} tokens`);
      out.push(`  projected/call saved:${money(projected.estimate.estimatedSavings)}  (PROJECTION, not measured)`);
    }
    out.push("");
    out.push("NOTES");
    if (!pricingDefined) out.push("  Pass --input-cost-per-million (and optionally --cached/--cache-creation/--output) for cost figures.");
    if (pricingDefined) out.push(`  Pricing used: input ${money(opts.inputCostPerMillion!)}/M, cache-read ${money(cachedInputCostPerMillion)}/M.`);
    if (!measured || measured.callsWithUsage === 0) out.push("  No measured usage recorded — projection above is grounded in real prefix stability but uses the estimator for tokens.");
    process.stdout.write(out.join("\n") + "\n");
  });

program
  .command("completion")
  .description("Print shell tab-completion script.")
  .argument("<shell>", "Target shell: bash | zsh | fish")
  .action((shell: string) => {
    switch (shell) {
      case "bash":
        process.stdout.write(BASH_COMPLETION + "\n");
        process.stderr.write(installHint("bash") + "\n");
        break;
      case "zsh":
        process.stdout.write(ZSH_COMPLETION + "\n");
        process.stderr.write(installHint("zsh") + "\n");
        break;
      case "fish":
        process.stdout.write(FISH_COMPLETION + "\n");
        process.stderr.write(installHint("fish") + "\n");
        break;
      default:
        process.stderr.write(`Unknown shell '${shell}'. Choose: bash, zsh, fish\n`);
        process.exit(1);
    }
  });

await program.parseAsync();
