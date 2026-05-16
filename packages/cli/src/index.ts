#!/usr/bin/env node
import { Command } from "commander";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  DEFAULT_RELAY_CONFIG,
  buildPromptPayload,
  buildStaticBlock,
  buildStateLayer,
  buildDynamicInput,
  checkTokenBudget,
  createEmptySemanticState,
  createSessionSnapshot,
  detectPromptLoop,
  estimateTokens,
  getGitDiffSince,
  getPrefixHash,
  inspectZoneTokens,
  listTrackedFiles,
  serializeSemanticState
} from "@relay/core";

const program = new Command();
const relayDir = join(process.cwd(), ".relay");
const callLogPath = join(relayDir, "calls.json");

function ensureRelayDir(): void {
  mkdirSync(join(relayDir, "memory"), { recursive: true });
}

function readOptional(path: string, fallback = ""): string {
  return existsSync(path) ? readFileSync(path, "utf8") : fallback;
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
  const staticBlock = buildStaticBlock({});
  const stateLayer = buildStateLayer({ semanticStateJson: serializeSemanticState(createEmptySemanticState()) });
  const prefixHash = getPrefixHash(staticBlock, stateLayer);
  const snapshot = createSessionSnapshot(["src", "tests", "package.json"], prefixHash);
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
  .action(async (prompt: string) => {
    ensureRelayDir();

    // Anomaly detection — include current call before checking threshold
    const callLog = readCallLog();
    const updatedLog = [...callLog, Date.now()];
    writeCallLog(updatedLog);
    const anomaly = detectPromptLoop(updatedLog);
    if (anomaly.anomalous) {
      process.stderr.write(`Warning: anomalous call rate detected — ${anomaly.reasons.join("; ")}\n`);
    }

    const semanticState = readOptional(join(relayDir, "memory", "semantic-state.json"), serializeSemanticState(createEmptySemanticState()));
    const files = listTrackedFiles().slice(0, 200).join("\n");
    const sessionText = readOptional(join(relayDir, "session.json"), "{}");
    const sessionData = JSON.parse(sessionText);
    const baseRef = sessionData.base_git_sha ?? "HEAD";

    const zones = buildZonesForAsk(prompt, baseRef, semanticState, files);
    const payload = buildPromptPayload(zones);
    const budget = checkTokenBudget(payload, DEFAULT_RELAY_CONFIG.tokens);

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

    console.log("---BEGIN RELAY PAYLOAD---");
    console.log(payload);
    console.log("---END RELAY PAYLOAD---");
  });

program.command("diff").description("Show git diff since current session base SHA.").action(() => {
  const sessionText = readOptional(join(relayDir, "session.json"), "{}");
  const sessionData = JSON.parse(sessionText);
  console.log(getGitDiffSince(sessionData.base_git_sha ?? "HEAD"));
});

const cache = program.command("cache").description("Inspect deterministic prompt-cache metadata.");
cache.command("fingerprint").description("Print current static/state prefix hash.").action(() => {
  const semanticState = readOptional(join(relayDir, "memory", "semantic-state.json"), serializeSemanticState(createEmptySemanticState()));
  const staticBlock = buildStaticBlock({});
  const stateLayer = buildStateLayer({ semanticStateJson: semanticState });
  console.log(getPrefixHash(staticBlock, stateLayer));
});
cache.command("inspect").description("Inspect cache-relevant prefix details.").action(() => {
  const semanticState = readOptional(join(relayDir, "memory", "semantic-state.json"), serializeSemanticState(createEmptySemanticState()));
  const staticBlock = buildStaticBlock({});
  const stateLayer = buildStateLayer({ semanticStateJson: semanticState });
  console.log(JSON.stringify({ prefixHash: getPrefixHash(staticBlock, stateLayer), staticTokens: estimateTokens(staticBlock).tokens, stateTokens: estimateTokens(stateLayer).tokens }, null, 2));
});
cache.command("warm").description("Placeholder command for provider cache warming.").action(() => {
  console.log("Cache warming is planned. Current MVP emits deterministic payloads for external provider reuse.");
});

const tokens = program.command("tokens").description("Estimate and inspect local token usage.");
tokens.command("estimate").argument("[text...]", "Text to estimate.").action((text: string[] = []) => {
  console.log(estimateTokens(text.join(" ")));
});
tokens.command("budget").description("Show current default token budget.").action(() => {
  console.log(JSON.stringify(DEFAULT_RELAY_CONFIG.tokens, null, 2));
});
tokens.command("inspect").description("Show zone-by-zone token breakdown for the current session state.").action(() => {
  ensureRelayDir();
  const semanticState = readOptional(join(relayDir, "memory", "semantic-state.json"), serializeSemanticState(createEmptySemanticState()));
  const files = listTrackedFiles().slice(0, 200).join("\n");
  const sessionText = readOptional(join(relayDir, "session.json"), "{}");
  const sessionData = JSON.parse(sessionText);
  const baseRef = sessionData.base_git_sha ?? "HEAD";
  const zones = buildZonesForAsk("(inspect)", baseRef, semanticState, files);
  const report = inspectZoneTokens(zones);
  const cfg = DEFAULT_RELAY_CONFIG.tokens;
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
  console.log(JSON.stringify(DEFAULT_RELAY_CONFIG.gc, null, 2));
});
gc.command("run").description("Placeholder compaction command.").action(() => {
  ensureRelayDir();
  console.log("Context GC placeholder executed. Implement model-assisted or heuristic compaction next.");
});
gc.command("preview").description("Preview compacted state.").action(() => {
  console.log(readOptional(join(relayDir, "memory", "semantic-state.json"), "No semantic state found."));
});
gc.command("restore").description("Placeholder restore command.").action(() => {
  console.log("Restore is planned. Keep snapshots of session.compacted.md before destructive GC.");
});

program.command("context").description("Inspect context construction state.").action(() => {
  console.log("Use `relay ask <prompt>` to print the assembled three-zone payload.");
});

program.parse();
