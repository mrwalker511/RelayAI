#!/usr/bin/env tsx
/**
 * pnpm run bench [-- --cwd /path/to/repo]
 *
 * Reproducible synthetic benchmark: runs the five fixed prompts from
 * docs/bench-prompts.md through Relay's payload assembly and reports, per
 * turn, the zone token split and prefix stability — then models a five-turn
 * session against the naive baseline (all tracked source files concatenated
 * into every call, no caching).
 *
 * No provider is called and no API key is needed. For live measured numbers
 * use `relay ask --measure` + `relay savings` (see docs/BENCHMARKS.md).
 *
 * Requires: pnpm build, and an initialized .relay/ in the target repo
 * (relay init && relay session start, plus pnpm sigmap for the snapshot).
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  listTrackedFiles,
  estimateTokens,
  readRelayWorkspace,
  RelayConfigSchema,
  estimateZoneAwareInputCost,
} from "@relay-cache/core";
import type { TokenEstimateOptions } from "@relay-cache/core";

const args = process.argv.slice(2);
function flag(name: string, fallback = ""): string {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const cwd = resolve(flag("--cwd", process.cwd()));

// The five fixed prompts from docs/bench-prompts.md — do not reorder or edit,
// so results stay comparable across runs, repos, and machines.
const PROMPTS = [
  "Summarize this codebase: its purpose, the main packages or modules, and what a new contributor should read first.",
  "Trace the data flow from the primary entry point to the first I/O operation (file, network, or subprocess). List the functions or methods involved in order.",
  "Identify the three most common error-handling patterns in this codebase. For each pattern, give one representative code location and explain what happens when the error occurs.",
  "Which source modules or files have the weakest test coverage? List up to five, explain why each matters, and suggest one test case for each.",
  "Identify the single most impactful refactoring you would make to improve maintainability. Describe the current state, the proposed change, and the risk of making the change.",
];

// Cache pricing ratio: cached-prefix reads bill at ~0.1× the input rate
// (Anthropic cache-read pricing; other providers are similar).
const CACHED_RATE = 0.1;

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".rb", ".php", ".cs",
  ".md", ".json", ".yaml", ".yml", ".toml", ".sh",
]);

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

void (async () => {
  // Tokenizer: match the target repo's Relay config so both sides use the
  // same estimator.
  let tokenizerOptions: TokenEstimateOptions | undefined;
  try {
    const cfg = RelayConfigSchema.parse(
      JSON.parse(readFileSync(join(cwd, ".relay", "config.json"), "utf8"))
    );
    tokenizerOptions = { provider: cfg.tokens.provider, model: cfg.tokens.model };
  } catch {
    // fall back to default tokenizer
  }

  // Naive baseline: every tracked source file concatenated into every call.
  let baselineText = "";
  let baselineFileCount = 0;
  for (const rel of listTrackedFiles(cwd).slice(0, 500)) {
    const ext = rel.slice(rel.lastIndexOf("."));
    if (
      rel.includes("node_modules/") || rel.includes("dist/") ||
      rel.endsWith(".lock") || rel.endsWith(".min.js") || rel.endsWith(".d.ts") ||
      !SOURCE_EXTENSIONS.has(ext)
    ) continue;
    try {
      baselineText += readFileSync(join(cwd, rel), "utf8") + "\n";
      baselineFileCount++;
    } catch { /* binary or unreadable — skip */ }
  }

  interface TurnRow {
    turn: number;
    static_block: number;
    state_layer: number;
    dynamic_input: number;
    total: number;
    baseline: number;
    static_hash: string;
    state_hash: string;
  }

  const rows: TurnRow[] = [];
  for (const [i, prompt] of PROMPTS.entries()) {
    const ws = readRelayWorkspace({ cwd, prompt });
    const baseline = estimateTokens(prompt + "\n" + baselineText, tokenizerOptions).tokens;
    rows.push({
      turn: i + 1,
      static_block: ws.zone_tokens.static_block,
      state_layer: ws.zone_tokens.state_layer,
      dynamic_input: ws.zone_tokens.dynamic_input,
      total: ws.zone_tokens.total,
      baseline,
      static_hash: ws.prefix.current_zone_hashes.static_block,
      state_hash: ws.prefix.current_zone_hashes.state_layer,
    });
  }

  const prefixStable = rows.every(
    (r) => r.static_hash === rows[0].static_hash && r.state_hash === rows[0].state_hash
  );

  // Session cost model (in full-price token equivalents):
  //   baseline  — every turn pays the full concatenation at the input rate.
  //   Relay     — turn 1 pays the full payload; turns 2+ pay the cache-eligible
  //               prefix at CACHED_RATE and only DYNAMIC_INPUT at full rate.
  let baselineSession = 0;
  let relaySession = 0;
  for (const r of rows) {
    baselineSession += r.baseline;
    if (r.turn === 1 || !prefixStable) {
      relaySession += r.total;
    } else {
      const est = estimateZoneAwareInputCost({
        staticBlockTokens: r.static_block,
        stateLayerTokens: r.state_layer,
        dynamicInputTokens: r.dynamic_input,
        inputCostPerMillion: 1,
        cachedInputCostPerMillion: CACHED_RATE,
        expectedCacheHitRate: 1,
      });
      relaySession += est.cacheAdjustedCost * 1_000_000;
    }
  }

  console.log();
  console.log(`Relay synthetic bench  ${cwd}`);
  console.log(`Baseline corpus: ${baselineFileCount} tracked source files`);
  console.log();
  console.log("turn  static  state  dynamic  relay-total  baseline");
  for (const r of rows) {
    console.log(
      String(r.turn).padEnd(4) +
      fmt(r.static_block).padStart(8) +
      fmt(r.state_layer).padStart(7) +
      fmt(r.dynamic_input).padStart(9) +
      fmt(r.total).padStart(13) +
      fmt(r.baseline).padStart(10)
    );
  }
  console.log();
  console.log(`Prefix stable across all ${rows.length} turns: ${prefixStable ? "YES" : "NO — cache would miss"}`);
  console.log();
  console.log(`Five-turn session, effective full-price input tokens (cache reads @ ${CACHED_RATE}×):`);
  console.log(`  Naive baseline: ${fmt(baselineSession)}`);
  console.log(`  Relay:          ${fmt(relaySession)}  (${(((baselineSession - relaySession) / baselineSession) * 100).toFixed(1)}% less)`);
  console.log();
  console.log(JSON.stringify({
    cwd,
    prefix_stable: prefixStable,
    turns: rows.map(({ static_hash: _s, state_hash: _t, ...rest }) => rest),
    session: {
      baseline_effective_tokens: Math.round(baselineSession),
      relay_effective_tokens: Math.round(relaySession),
      reduction_pct: Number((((baselineSession - relaySession) / baselineSession) * 100).toFixed(1)),
    },
  }, null, 2));
})();
