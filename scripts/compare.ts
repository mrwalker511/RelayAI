#!/usr/bin/env tsx
/**
 * pnpm run compare [-- --prompt "..." --cwd /path/to/repo]
 *
 * Compares token counts for a Relay-assembled payload vs the naive baseline
 * (all tracked file contents concatenated). No live provider required.
 *
 * Requires: pnpm build (imports @relay/core dist)
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { listTrackedFiles, estimateTokens, readRelayWorkspace, RelayConfigSchema, estimateZoneAwareInputCost } from "@relay/core";
import type { TokenEstimateOptions } from "@relay/core";

// ── Argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function flag(name: string, fallback = ""): string {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const cwd = resolve(flag("--cwd", process.cwd()));
const prompt = flag("--prompt", "Summarize this codebase and its main entry points.");

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

function fmt(n: number): string {
  return n.toLocaleString();
}

function pct(relay: number, baseline: number): string {
  if (baseline === 0) return "N/A";
  const p = ((baseline - relay) / baseline) * 100;
  return (p > 0 ? "-" : "+") + Math.abs(p).toFixed(1) + "%";
}

// ── Main ──────────────────────────────────────────────────────────────────────

void (async () => {
  // Baseline: all tracked files concatenated
  const trackedFiles = listTrackedFiles(cwd);
  const SOURCE_EXTENSIONS = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".go", ".rs", ".java", ".rb", ".php", ".cs",
    ".md", ".json", ".yaml", ".yml", ".toml", ".sh",
  ]);

  let baselineText = "";
  let baselineFileCount = 0;
  const skippedFiles: string[] = [];

  for (const rel of trackedFiles.slice(0, 500)) {
    const ext = rel.slice(rel.lastIndexOf("."));
    if (
      rel.includes("node_modules/") ||
      rel.includes("dist/") ||
      rel.endsWith(".lock") ||
      rel.endsWith(".snap") ||
      rel.endsWith(".min.js") ||
      rel.endsWith(".d.ts") ||
      !SOURCE_EXTENSIONS.has(ext)
    ) {
      skippedFiles.push(rel);
      continue;
    }
    try {
      baselineText += readFileSync(join(cwd, rel), "utf8") + "\n";
      baselineFileCount++;
    } catch {
      // binary or unreadable — skip
    }
  }

  // Use the same tokenizer (provider/model) the Relay side uses, so the
  // baseline vs Relay comparison is apples-to-apples.
  let tokenizerOptions: TokenEstimateOptions | undefined;
  try {
    const cfg = RelayConfigSchema.parse(JSON.parse(readFileSync(join(cwd, ".relay", "config.json"), "utf8")));
    tokenizerOptions = { provider: cfg.tokens.provider, model: cfg.tokens.model };
  } catch {
    // No (valid) config — fall back to the default tokenizer.
  }

  const baselineTokens = estimateTokens(prompt + "\n" + baselineText, tokenizerOptions).tokens;

  // Relay side: zone_tokens from workspace context
  let relayZones: { static_block: number; state_layer: number; dynamic_input: number; total: number } | null = null;
  let relayError: string | null = null;
  const relayInitialized = existsSync(join(cwd, ".relay", "config.json"));

  try {
    const ws = await readRelayWorkspace({ cwd, prompt });
    relayZones = ws.zone_tokens;
  } catch (err) {
    relayError = (err as Error).message;
  }

  // Report
  console.log();
  console.log(`${BOLD}RelayAI Token Comparison${RESET}  ${DIM}${cwd}${RESET}`);
  console.log(`${DIM}Prompt: "${prompt.slice(0, 80)}${prompt.length > 80 ? "…" : ""}"${RESET}`);
  console.log();

  console.log(`${BOLD}WITHOUT Relay (naive baseline)${RESET}`);
  console.log(`  Source files read:   ${fmt(baselineFileCount)} of ${trackedFiles.length} tracked`);
  if (skippedFiles.length > 0) {
    console.log(`  ${DIM}Skipped:             ${skippedFiles.length} (lock/dist/binary/non-source)${RESET}`);
  }
  console.log(`  ${BOLD}Total input tokens:  ${fmt(baselineTokens)}${RESET}  ${DIM}(all files + prompt, every call at full price)${RESET}`);
  console.log();

  if (relayError) {
    console.log(`${BOLD}WITH Relay${RESET}`);
    console.log(`  ${YELLOW}Could not load workspace: ${relayError}${RESET}`);
    if (!relayInitialized) {
      console.log(`  ${DIM}Run 'relay init' in this directory first.${RESET}`);
    }
  } else if (relayZones) {
    const cacheEligible = relayZones.static_block + relayZones.state_layer;
    const reduction = baselineTokens - relayZones.total;
    const isPositive = relayZones.total < baselineTokens;

    console.log(`${BOLD}WITH Relay (assembled payload)${RESET}`);
    console.log(`  STATIC_BLOCK:        ${fmt(relayZones.static_block)} tokens  ${DIM}← stable prefix, provider-cached${RESET}`);
    console.log(`  STATE_LAYER:         ${fmt(relayZones.state_layer)} tokens  ${DIM}← stable prefix, provider-cached${RESET}`);
    console.log(`  DYNAMIC_INPUT:       ${fmt(relayZones.dynamic_input)} tokens  ${DIM}← volatile: prompt + git diff${RESET}`);
    console.log(`  ${BOLD}Total input tokens:  ${fmt(relayZones.total)}${RESET}`);
    console.log();

    // Amortized repeat-call view: on a warm cache the cache-eligible prefix is
    // billed at the cached rate (assume 0.1× input, Anthropic's cache-read price).
    // estimateZoneAwareInputCost with hit-rate 1 and unit pricing yields cost in
    // "$ per $1/M input", i.e. ×1e6 gives a full-price-token-equivalent.
    const repeat = estimateZoneAwareInputCost({
      staticBlockTokens: relayZones.static_block,
      stateLayerTokens: relayZones.state_layer,
      dynamicInputTokens: relayZones.dynamic_input,
      inputCostPerMillion: 1,
      cachedInputCostPerMillion: 0.1,
      expectedCacheHitRate: 1
    });
    const repeatEffective = Math.round(repeat.cacheAdjustedCost * 1_000_000);

    console.log(`${BOLD}Comparison (per call)${RESET}`);
    const color = isPositive ? GREEN : YELLOW;
    console.log(`  First call (cold cache):  Relay ${fmt(relayZones.total)} vs baseline ${fmt(baselineTokens)} tokens  ${color}(${pct(relayZones.total, baselineTokens)})${RESET}`);
    console.log(`  Repeat call (warm cache): ${CYAN}~${fmt(repeatEffective)} effective tokens${RESET} vs baseline ${fmt(baselineTokens)}  ${GREEN}(${pct(repeatEffective, baselineTokens)})${RESET}`);
    console.log(`    ${DIM}cache-eligible ${fmt(cacheEligible)} tok @ ~0.1× + dynamic ${fmt(relayZones.dynamic_input)} tok @ full; baseline pays full every call${RESET}`);
    console.log();

    if (!relayInitialized) {
      console.log(`  ${YELLOW}Note: .relay/ not initialized — run 'relay init' for full zone accounting.${RESET}`);
    }

    if (isPositive) {
      console.log(`${GREEN}${BOLD}Result: Relay is smaller on the first call AND cheaper on repeats once the prefix is cached.${RESET}`);
    } else {
      console.log(`${YELLOW}${BOLD}Result: On the FIRST call Relay's payload is larger than the naive baseline (typical for small repos). The win is on REPEAT calls — see the warm-cache line above — and grows with repo size.${RESET}`);
      console.log(`${DIM}Consider 'relay context build' with hierarchical: true for large codebases. For real billed numbers use 'relay ask --measure' + 'relay savings'.${RESET}`);
    }
  }

  console.log();
})();
