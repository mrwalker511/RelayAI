# Architecture

Relay is a local-first, model-agnostic context engine for coding agents and model CLIs. It sits between the developer and their model provider, assembling deterministic, cache-friendly prompt payloads from repository state, git history, and compact session memory.

---

## System Overview

```
Developer
    │
    │  relay ask "..."
    ▼
┌───────────────────────────────────────────────────────┐
│  relay CLI  (packages/cli)                            │
│  Commander.js command router — thin, no business logic│
└───────────────────┬───────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────────────┐
│  @relay/core  (packages/core)                         │
│                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ Repo Scanner │  │ Git Delta    │  │ Semantic    │ │
│  │ (git ls-files│  │ Engine       │  │ State Store │ │
│  │  + file idx) │  │ (diff since  │  │ (GC / GC   │ │
│  └──────┬───────┘  │  base SHA)   │  │  preview)  │ │
│         │          └──────┬───────┘  └──────┬──────┘ │
│         │                 │                 │        │
│  ┌──────▼───────┐         │                 │        │
│  │ Hierarchical │         │                 │        │
│  │ Context Loader│         │                 │        │
│  │ (trunk +     │         │                 │        │
│  │  branches)   │         │                 │        │
│  └──────┬───────┘         │                 │        │
│         └────────┬────────┘                 │        │
│                  ▼                          │        │
│  ┌───────────────────────────────┐          │        │
│  │  Payload Builder              │◄─────────┘        │
│  │  STATIC_BLOCK → STATE_LAYER   │                   │
│  │  → DYNAMIC_INPUT              │                   │
│  │  (output filtered via RTK)    │                   │
│  └───────────────┬───────────────┘                   │
│                  │                                   │
│  ┌───────────────▼───────────────┐                   │
│  │  Token Budget Guardrails      │                   │
│  │  (estimate → check → gate)    │                   │
│  └───────────────┬───────────────┘                   │
└──────────────────┼────────────────────────────────────┘
                   │
                   ▼
         Provider Adapter  (ShellProvider)
                   │
                   │  stdin
                   ▼
         Configured provider CLI
         (claude, ollama, chatgpt-cli, ...)
```

---

## Prompt Zones

Every outbound prompt is assembled in this fixed order:

```
<STATIC_BLOCK>
  project rules, architecture notes, source snapshots
</STATIC_BLOCK>

<STATE_LAYER>
  semantic state JSON, file index, session summary
</STATE_LAYER>

<DYNAMIC_INPUT>
  current prompt, git diff, runtime output, ISO timestamp
</DYNAMIC_INPUT>
```

**Why this order matters:** Provider prompt caches are prefix-sensitive. By keeping stable content first and placing all volatile material last, Relay maximizes the chance that the static+state prefix is cached on the first call and reused on every subsequent call within the same session.

---

## Module Reference

### `packages/core/src/context/`

The three-zone payload builder. `payload-builder.ts` assembles zones in a fixed order by calling `static-block.ts`, `state-layer.ts`, and `dynamic-input.ts` in sequence. Zone type definitions live in `zones.ts`. `prefix-hash.ts` hashes the combined static + state content to produce a cache fingerprint used by `relay cache fingerprint` and `relay cache inspect`. `cache-diagnostics.ts` aggregates cache-relevant metadata for reporting.

`hierarchical-loader.ts` implements two-tier context loading. When `context.hierarchical = true`, `loadHierarchicalContext()` reads a slim `trunk.md` (~300 tokens) unconditionally and then lazy-loads per-domain `branches/*.md` files based on keyword scoring of the current prompt and diff text. Domains: `git`, `tokens`, `memory`, `providers`, `config`, `context`. The combined result replaces `sourceSnapshot` in `STATIC_BLOCK`.

### `packages/core/src/git/`

Git-anchored delta prompting. When `relay session start` runs, `snapshot.ts` records the current `HEAD` SHA as `base_git_sha` in `.relay/session.json`. On every subsequent `relay ask`, `delta-builder.ts` calls `git diff <base_git_sha>` and injects only the diff into `DYNAMIC_INPUT` — not the full file contents. `tracked-files.ts` calls `git ls-files` to enumerate the project file index placed in `STATE_LAYER`. `diff.ts` contains the raw diff execution logic. Both modules provide async variants (`getGitDiffSinceAsync`, `buildPrioritizedFileIndexAsync`) used by the `relay ask` handler to run the two git subprocess calls concurrently via `Promise.all`.

### `packages/core/src/memory/`

Semantic state and garbage collection. Raw session history accumulates in `.relay/memory/session.raw.md`. When `relay gc run` is called, `gc.ts` (`compactHistoryToState()`) sends a schema-constrained prompt to the configured GC command and collapses verbose history — often 10 000+ tokens — into a `SemanticState` struct of roughly 500 tokens. The result is written to `.relay/memory/semantic-state.json` and replaces raw history in the next prompt's `STATE_LAYER`. `semantic-state.ts` defines the `SemanticState` schema: `active_target`, `current_goal`, `runtime_errors`, `verified_hypotheses`, `rejected_hypotheses`, `next_actions`, `code_changes`.

### `packages/core/src/tokens/`

Token budgeting and safety. `tokenizer.ts` estimates token counts using `js-tiktoken` (`cl100k_base` encoding) with a `char/4` fallback for unsupported content; results are memoized in a process-lifetime two-level Map keyed on `(encodingName, correctionFactor) → text` to avoid re-encoding identical strings within a single invocation. `budget.ts` checks the assembled payload against three thresholds from config — `warningLimit`, `requireConfirmationAbove`, `hardLimit` — and returns a status of `ok`, `warning`, `requires_confirmation`, or `blocked`. `cost-estimator.ts` calculates cache-aware cost projections from explicit provider pricing inputs. `anomaly-detector.ts` reads `.relay/calls.json` and warns when more than 10 prompts are sent within 60 seconds.

### `packages/core/src/providers/`

Provider adapter layer. The `ProviderAdapter` interface (`provider.ts`) requires only `name: string` and `sendPrompt(payload: string): Promise<number>`. `ShellProvider` implements this by spawning the configured CLI command array and writing the assembled payload to its stdin. Relay handles all context construction upstream; the provider is responsible only for model execution.

### `packages/core/src/utils/`

Shared utilities. `fs.ts` provides `readOptional()` and file write helpers. `output-filter.ts` implements `filterOutput(raw, opts?)` — a deterministic middleware pipeline for noisy CLI/tool output. It strips ANSI codes, collapses blank lines, deduplicates consecutive identical lines, suppresses excess success/pass lines, and truncates to a line limit with head+tail strategy. Applied automatically inside `buildDynamicInput()` to the `runtimeOutput` field.

### `packages/core/src/config/`

Configuration loading and validation. `relay-config.ts` defines the `RelayConfigSchema` using Zod. Config is validated at load time; invalid configs surface as errors rather than silently falling back to defaults. The schema covers `provider`, `routing`, `gc`, `tokens`, `files`, `context` (hierarchical loading), `filter` (output filtering), and `audit` (event log) sections. See [`docs/CONFIGURATION.md`](CONFIGURATION.md) for the full schema reference.

### `packages/core/src/doctor.ts`

Workspace readiness diagnostics. The doctor checks git availability, `.relay/` initialization, config and session validity, semantic state integrity, token budget ordering, and provider/GC command availability. It prints structured JSON findings and exits non-zero only on blocking errors.

### `packages/core/src/workspace-context.ts`

Unified workspace snapshot. Aggregates all runtime state — config, session, semantic state, git delta, file index, token counts, cache fingerprint, and budget status — into a single `WorkspaceContext` object consumed by both the CLI commands and the MCP server.

---

## Cache Strategy

Provider prompt caches are usually prefix-sensitive. Relay optimizes for stable prefixes by applying these rules:

- Keep static project context first in every prompt.
- Keep state structure predictable and ordered.
- Move all volatile data — diffs, timestamps, logs, runtime output — to `DYNAMIC_INPUT` at the end.
- Hash the static and state zones together (`prefix-hash.ts`) to detect prefix drift between calls.
- Avoid timestamps, random IDs, absolute temporary paths, and unbounded raw history in the stable zones.

The `relay cache inspect` command reports the current prefix hash, zone token counts, and optionally estimates cost savings given explicit provider pricing.

---

## Git Delta Strategy

Recording a base SHA at session start means follow-up prompts contain only what changed, not the whole repository:

1. `relay session start` → `snapshot.ts` writes `base_git_sha` to `.relay/session.json`
2. `relay ask "..."` → `delta-builder.ts` runs `git diff <base_git_sha>` and injects the result into `DYNAMIC_INPUT`
3. The file index in `STATE_LAYER` lists tracked paths but not full file contents

This keeps follow-up context focused and token-efficient. Use `relay diff` to inspect the active delta at any time.

---

## Token Guardrails

Before sending a prompt to a provider, Relay applies these checks in order:

1. Estimate token count locally using `tokenizer.ts`
2. Break down the estimate by zone
3. Emit a warning to stderr if the total exceeds `warningLimit`
4. Require interactive confirmation if the total exceeds `requireConfirmationAbove`
5. Block execution entirely if the total exceeds `hardLimit`
6. Check `calls.json` for rapid repeated calls (anomaly detection)

Use `relay tokens inspect` to see the current zone-by-zone breakdown and budget status before running a prompt.

---

## Signature Mapping

`scripts/gen-sigmap.ts` (run with `pnpm sigmap`) uses TypeScript's compiler API to walk `packages/*/src/**/*.ts` and extract:

- Interface and type alias declarations (verbatim)
- Enum declarations (verbatim)
- Function declaration signatures without bodies
- Variable declarations with arrow/function values — signature only
- Class headers with method signatures, property bodies stripped

Output is written to `.relay/sigmap.md` in markdown with per-file code fences. Token cost is ~10–15% of the equivalent full source. Relay uses it as `sourceSnapshot` automatically when `.relay/memory/source-snapshot.md` is absent or is the default placeholder. Regenerate after structural changes.

---

## Local Runtime State

All runtime state lives in `.relay/` inside the managed repository and is intentionally not committed to git:

```
.relay/
├── config.json                      # RelayConfig (Zod-validated)
├── session.json                     # base_git_sha, prefix_hash, tracked_paths
├── calls.json                       # timestamp log for anomaly detection
├── sigmap.md                        # generated by pnpm sigmap
├── context/                         # generated by relay context build
│   ├── trunk.md                     # slim project overview (always loaded)
│   └── branches/                    # domain context files (lazy-loaded)
│       ├── git.md
│       ├── tokens.md
│       ├── memory.md
│       ├── providers.md
│       ├── config.md
│       └── context.md
└── memory/
    ├── semantic-state.json          # compacted SemanticState
    ├── semantic-state.snapshot.json # pre-GC backup (restored by relay gc restore)
    ├── session.raw.md               # raw history (append-only)
    └── session.compacted.md         # last compaction output
```
