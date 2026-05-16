#!/usr/bin/env node
import { Command } from "commander";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_RELAY_CONFIG,
  buildPromptPayload,
  buildStaticBlock,
  buildStateLayer,
  buildDynamicInput,
  checkTokenBudget,
  createEmptySemanticState,
  createSessionSnapshot,
  estimateTokens,
  getGitDiffSince,
  getPrefixHash,
  listTrackedFiles,
  serializeSemanticState
} from "@relay/core";

const program = new Command();
const relayDir = join(process.cwd(), ".relay");

function ensureRelayDir(): void {
  mkdirSync(join(relayDir, "memory"), { recursive: true });
}

function readOptional(path: string, fallback = ""): string {
  return existsSync(path) ? readFileSync(path, "utf8") : fallback;
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
  .action((prompt: string) => {
    ensureRelayDir();
    const semanticState = readOptional(join(relayDir, "memory", "semantic-state.json"), serializeSemanticState(createEmptySemanticState()));
    const files = listTrackedFiles().slice(0, 200).join("\n");
    const sessionText = readOptional(join(relayDir, "session.json"), "{}");
    const session = JSON.parse(sessionText);
    const baseRef = session.base_git_sha ?? "HEAD";
    const zones = {
      staticBlock: buildStaticBlock({}),
      stateLayer: buildStateLayer({ semanticStateJson: semanticState, fileIndex: files }),
      dynamicInput: buildDynamicInput({ prompt, gitDiff: getGitDiffSince(baseRef) })
    };
    const payload = buildPromptPayload(zones);
    const budget = checkTokenBudget(payload, DEFAULT_RELAY_CONFIG.tokens);
    console.log(`Token estimate: ${budget.tokens} (${budget.status})`);
    console.log("---BEGIN RELAY PAYLOAD---");
    console.log(payload);
    console.log("---END RELAY PAYLOAD---");
  });

program.command("diff").description("Show git diff since current session base SHA.").action(() => {
  const sessionText = readOptional(join(relayDir, "session.json"), "{}");
  const session = JSON.parse(sessionText);
  console.log(getGitDiffSince(session.base_git_sha ?? "HEAD"));
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
