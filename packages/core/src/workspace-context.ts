import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_RELAY_CONFIG, RelayConfigSchema, resolveTokenBudget } from "./config/relay-config.js";
import type { RelayConfig } from "./config/relay-config.js";
import { loadHierarchicalContext } from "./context/hierarchical-loader.js";
import { buildDynamicInput } from "./context/dynamic-input.js";
import { buildPromptPayload } from "./context/payload-builder.js";
import { getPrefixHash } from "./context/prefix-hash.js";
import { buildStateLayer } from "./context/state-layer.js";
import { buildStaticBlock } from "./context/static-block.js";
import type { PromptZones } from "./context/zones.js";
import { getGitDiffSince } from "./git/diff.js";
import { buildPrioritizedFileIndex, listTrackedFiles } from "./git/tracked-files.js";
import { createEmptySemanticState, serializeSemanticState, trimSemanticState } from "./memory/semantic-state.js";
import type { SemanticState } from "./memory/semantic-state.js";
import { checkTokenBudget, inspectZoneTokens } from "./tokens/budget.js";
import { estimateTokens } from "./tokens/tokenizer.js";
import { readOptional } from "./utils/fs.js";

export interface RelayWorkspaceOptions {
  cwd?: string;
  prompt?: string;
}

export interface RelayWorkspaceSnapshot {
  cwd: string;
  relay_dir: string;
  config: {
    valid: boolean;
    path: string;
    error: string | null;
    value: RelayConfig;
  };
  session: {
    exists: boolean;
    path: string;
    valid: boolean;
    error: string | null;
    data: Record<string, unknown>;
    session_id: unknown;
    base_git_sha: string | null;
    prefix_hash: string | null;
    static_block_hash: string | null;
    state_layer_hash: string | null;
    created_at: unknown;
    tracked_path_count: number;
  };
  state: {
    semantic_state_path: string;
    exists: boolean;
    valid_json: boolean;
    error: string | null;
    json: string;
    parsed: SemanticState | null;
  };
  git: {
    base_ref: string;
    diff: string;
    diff_present: boolean;
    diff_tokens: number;
  };
  files: {
    tracked_paths: string[];
    included_paths: string[];
    tracked_path_count: number;
    included_path_count: number;
  };
  zones: PromptZones;
  payload: string;
  prefix: {
    current_hash: string;
    session_hash: string | null;
    matches_session: boolean | null;
    current_zone_hashes: {
      static_block: string;
      state_layer: string;
    };
    session_zone_hashes: {
      static_block: string | null;
      state_layer: string | null;
    };
    changed_zones: Array<"static_block" | "state_layer">;
    drift_reasons: string[];
  };
  zone_tokens: {
    static_block: number;
    state_layer: number;
    dynamic_input: number;
    total: number;
  };
  budget: {
    tokens: number;
    status: "ok" | "warning" | "requires_confirmation" | "blocked";
    message: string;
    warning_limit: number;
    confirmation_threshold: number;
    hard_limit: number;
  };
}

function parseJsonObject(text: string): { valid: boolean; data: Record<string, unknown>; error: string | null } {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { valid: true, data: parsed as Record<string, unknown>, error: null };
    }
    return { valid: false, data: {}, error: "JSON value is not an object." };
  } catch (error) {
    return { valid: false, data: {}, error: (error as Error).message };
  }
}

function readRelayConfig(configPath: string): RelayWorkspaceSnapshot["config"] {
  const configText = readOptional(configPath, "");
  if (!configText) {
    return { valid: true, path: configPath, error: null, value: DEFAULT_RELAY_CONFIG };
  }

  try {
    return { valid: true, path: configPath, error: null, value: RelayConfigSchema.parse(JSON.parse(configText)) };
  } catch (error) {
    return { valid: false, path: configPath, error: (error as Error).message, value: DEFAULT_RELAY_CONFIG };
  }
}

function readSemanticState(statePath: string): RelayWorkspaceSnapshot["state"] {
  const fallback = serializeSemanticState(createEmptySemanticState());
  const exists = existsSync(statePath);
  const json = readOptional(statePath, fallback);

  try {
    return {
      semantic_state_path: statePath,
      exists,
      valid_json: true,
      error: null,
      json,
      parsed: JSON.parse(json) as SemanticState
    };
  } catch (error) {
    return {
      semantic_state_path: statePath,
      exists,
      valid_json: false,
      error: (error as Error).message,
      json,
      parsed: null
    };
  }
}

function readSession(sessionPath: string): RelayWorkspaceSnapshot["session"] {
  const exists = existsSync(sessionPath);
  const parsed = parseJsonObject(readOptional(sessionPath, "{}"));
  const data = parsed.data;
  const trackedPaths = Array.isArray(data.tracked_paths) ? data.tracked_paths : [];

  return {
    exists,
    path: sessionPath,
    valid: parsed.valid,
    error: parsed.error,
    data,
    session_id: data.session_id ?? null,
    base_git_sha: typeof data.base_git_sha === "string" ? data.base_git_sha : null,
    prefix_hash: typeof data.prefix_hash === "string" ? data.prefix_hash : null,
    static_block_hash: typeof data.static_block_hash === "string" ? data.static_block_hash : null,
    state_layer_hash: typeof data.state_layer_hash === "string" ? data.state_layer_hash : null,
    created_at: data.created_at ?? null,
    tracked_path_count: trackedPaths.length
  };
}

function buildPrefixReport(
  staticBlock: string,
  stateLayer: string,
  session: RelayWorkspaceSnapshot["session"]
): RelayWorkspaceSnapshot["prefix"] {
  const currentHash = getPrefixHash(staticBlock, stateLayer);
  const staticBlockHash = getPrefixHash(staticBlock, "");
  const stateLayerHash = getPrefixHash(stateLayer, "");
  const changedZones: Array<"static_block" | "state_layer"> = [];

  if (session.static_block_hash && session.static_block_hash !== staticBlockHash) {
    changedZones.push("static_block");
  }
  if (session.state_layer_hash && session.state_layer_hash !== stateLayerHash) {
    changedZones.push("state_layer");
  }

  const matchesSession = session.prefix_hash ? currentHash === session.prefix_hash : null;
  return {
    current_hash: currentHash,
    session_hash: session.prefix_hash,
    matches_session: matchesSession,
    current_zone_hashes: {
      static_block: staticBlockHash,
      state_layer: stateLayerHash
    },
    session_zone_hashes: {
      static_block: session.static_block_hash,
      state_layer: session.state_layer_hash
    },
    changed_zones: changedZones,
    drift_reasons: matchesSession === false
      ? changedZones.length > 0 ? changedZones.map((zone) => `${zone}_prefix_changed`) : ["static_or_state_prefix_changed"]
      : []
  };
}

export function readRelayWorkspace(options: RelayWorkspaceOptions = {}): RelayWorkspaceSnapshot {
  const cwd = options.cwd ?? process.cwd();
  const prompt = options.prompt ?? "(inspect)";
  const relayDir = join(cwd, ".relay");
  const config = readRelayConfig(join(relayDir, "config.json"));
  const state = readSemanticState(join(relayDir, "memory", "semantic-state.json"));
  const session = readSession(join(relayDir, "session.json"));
  const baseRef = (session.base_git_sha && session.base_git_sha !== "unknown") ? session.base_git_sha : "HEAD";
  const trackedPaths = listTrackedFiles(cwd);
  const stateFiles = [
    ...(state.parsed?.code_changes ?? []),
    ...(state.parsed?.next_actions ?? []),
  ].join(" ").match(/[\w./\\-]+\.[a-z]+/g) ?? [];
  const includedPaths = buildPrioritizedFileIndex(cwd, {
    limit: config.value.files.maxIndex,
    priorityPaths: stateFiles,
  });
  const trimmedState = state.parsed ? trimSemanticState(state.parsed, { cwd }) : createEmptySemanticState();
  let gitDiff = "";
  try {
    gitDiff = getGitDiffSince(baseRef, cwd);
  } catch {
    // Not in a git repo or git unavailable — proceed without diff context
  }
  const sourceSnapshotRaw = readOptional(join(relayDir, "memory", "source-snapshot.md")) || undefined;
  const sigemapPath = join(relayDir, "sigmap.md");
  const sourceSnapshot =
    sourceSnapshotRaw && !sourceSnapshotRaw.includes("Paste stable key source files here")
      ? sourceSnapshotRaw
      : existsSync(sigemapPath) ? readOptional(sigemapPath) : sourceSnapshotRaw;

  let domainContext: string | undefined;
  if (config.value.context.hierarchical) {
    const contextDir = join(cwd, config.value.context.contextDir);
    domainContext = loadHierarchicalContext({ contextDir, prompt, gitDiff, maxBranches: config.value.context.maxBranches }).loaded;
  }

  const zones = {
    staticBlock: buildStaticBlock({
      projectRules: readOptional(join(relayDir, "memory", "project-rules.md")) || undefined,
      architectureNotes: readOptional(join(relayDir, "memory", "architecture-notes.md")) || undefined,
      sourceSnapshot,
      domainContext,
    }),
    stateLayer: buildStateLayer({ semanticStateJson: serializeSemanticState(trimmedState), fileIndex: includedPaths.join("\n") }),
    dynamicInput: buildDynamicInput({ prompt, gitDiff })
  };
  const payload = buildPromptPayload(zones);
  const zoneTokens = inspectZoneTokens(zones);
  const resolvedTokens = resolveTokenBudget(config.value);
  const budget = checkTokenBudget(payload, resolvedTokens);

  return {
    cwd,
    relay_dir: relayDir,
    config,
    session,
    state,
    git: {
      base_ref: baseRef,
      diff: gitDiff,
      diff_present: gitDiff.trim().length > 0,
      diff_tokens: estimateTokens(gitDiff).tokens
    },
    files: {
      tracked_paths: trackedPaths,
      included_paths: includedPaths,
      tracked_path_count: trackedPaths.length,
      included_path_count: includedPaths.length
    },
    zones,
    payload,
    prefix: buildPrefixReport(zones.staticBlock, zones.stateLayer, session),
    zone_tokens: {
      static_block: zoneTokens.staticBlock,
      state_layer: zoneTokens.stateLayer,
      dynamic_input: zoneTokens.dynamicInput,
      total: zoneTokens.total
    },
    budget: {
      tokens: budget.tokens,
      status: budget.status,
      message: budget.message,
      warning_limit: config.value.tokens.warningLimit,
      confirmation_threshold: config.value.tokens.requireConfirmationAbove,
      hard_limit: config.value.tokens.hardLimit
    }
  };
}

export function summarizeContextHealth(snapshot: RelayWorkspaceSnapshot): {
  status: "ok" | "warning" | "error";
  findings: Array<{ id: string; status: "ok" | "warning" | "error"; message: string }>;
} {
  const findings: Array<{ id: string; status: "ok" | "warning" | "error"; message: string }> = [];

  findings.push(snapshot.config.valid
    ? { id: "config", status: "ok", message: ".relay/config.json is valid or defaults are in use." }
    : { id: "config", status: "error", message: snapshot.config.error ?? ".relay/config.json is invalid." });
  findings.push(snapshot.session.exists
    ? snapshot.session.valid
      ? { id: "session", status: "ok", message: "Relay session metadata is readable." }
      : { id: "session", status: "error", message: snapshot.session.error ?? ".relay/session.json is invalid." }
    : { id: "session", status: "warning", message: "No active Relay session found; git diff falls back to HEAD." });
  findings.push(snapshot.state.exists && snapshot.state.valid_json
    ? { id: "semantic_state", status: "ok", message: "Semantic state is readable." }
    : snapshot.state.exists
      ? { id: "semantic_state", status: "error", message: snapshot.state.error ?? "Semantic state is invalid JSON." }
      : { id: "semantic_state", status: "warning", message: "No semantic state file found; empty state is used." });
  findings.push(snapshot.prefix.matches_session === false
    ? { id: "prefix", status: "warning", message: `Prefix drift detected: ${snapshot.prefix.drift_reasons.join(", ") || "prefix changed"}.` }
    : { id: "prefix", status: "ok", message: "Prefix hash is stable for the available session metadata." });
  findings.push(snapshot.budget.status === "blocked"
    ? { id: "token_budget", status: "error", message: snapshot.budget.message }
    : snapshot.budget.status === "warning" || snapshot.budget.status === "requires_confirmation"
      ? { id: "token_budget", status: "warning", message: snapshot.budget.message }
      : { id: "token_budget", status: "ok", message: snapshot.budget.message });
  findings.push(snapshot.git.diff_tokens > 20000
    ? { id: "git_delta", status: "warning", message: `Git delta is large (${snapshot.git.diff_tokens.toLocaleString()} estimated tokens).` }
    : { id: "git_delta", status: "ok", message: snapshot.git.diff_present ? "Git delta is present." : "No git delta is present." });

  const status = findings.some((finding) => finding.status === "error")
    ? "error"
    : findings.some((finding) => finding.status === "warning") ? "warning" : "ok";
  return { status, findings };
}
