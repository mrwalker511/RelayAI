# AGENTS.md

This file provides guidance to coding agents working with this repository. It serves as the primary instruction source for OpenAI Codex and is also referenced by other coding agents.

---

## Codex Integration

This file is read automatically by OpenAI Codex as the repository's agent instruction source. The `.codex/hooks.json` file configures lifecycle automation that runs alongside Codex sessions:

| Hook | Trigger | Commands |
|------|---------|----------|
| `SessionStart` | When a Codex session begins | `relay session start` — anchors context to the current git SHA<br>`pnpm sigmap` — regenerates the structural signature map |
| `Stop` | When a Codex session ends | `relay gc run` — compacts verbose session history into `SemanticState` |
| `PostToolUse` | After `write_file` or `apply_patch` | `pnpm sigmap` — keeps the signature map current after file changes |

These hooks ensure Relay's context layer is always synchronized with the active Codex session. If you are adapting these hooks for a different agent, see `.claude/settings.json` for the Claude Code equivalent (which uses `Edit|Write|MultiEdit` as the PostToolUse matcher).

For MCP integration — allowing an agent to request Relay context directly via tool calls — see [`docs/MCP.md`](docs/MCP.md).

---

## Commands

```bash
pnpm install          # install all workspace dependencies
pnpm build            # compile all packages (tsc)
pnpm typecheck        # type-check all packages without emitting
pnpm test             # run tests across all packages (must build first)
pnpm dev              # run CLI via tsx without building
pnpm sigmap           # generate .relay/sigmap.md (structural skeleton of the codebase)
pnpm clean            # remove packages/*/dist
relay completion bash|zsh|fish   # print shell completion script; source it in your shell profile
```

Filter to a single package:

```bash
pnpm --filter @relay/core build
pnpm --filter @relay/cli dev
```

Tests run against compiled output via Node's built-in test runner. Always build before testing:

```bash
pnpm build && pnpm test      # full suite (~207 tests across core + cli)
pnpm run ci                  # build + typecheck + test + pack:check (matches CI)
```

Run a single test file:

```bash
pnpm --filter @relay/core build
node --test packages/core/dist/tokens/budget.test.js
```

There is no ESLint. `pnpm typecheck` (strict TypeScript) is the lint step.

For full testing instructions — including hook verification for Claude Code, Codex CLI, and GitHub Copilot, and manual integration testing — see [`docs/TESTING_PLAN.md`](docs/TESTING_PLAN.md).

## Architecture

Relay is a deterministic context construction engine for model- and LLM-agnostic coding workflows. Every outbound prompt is assembled through three stable zones to maximize prompt-cache hit rates where the selected provider supports them.

### Three-zone prompt construction (`packages/core/src/context/`)

`payload-builder.ts` assembles zones in a fixed order:

1. **`STATIC_BLOCK`** — project rules, architecture notes, source snapshots (or hierarchical domain context). Kept stable across requests so provider caches this prefix on the first call.
2. **`STATE_LAYER`** — semantic state JSON, file index, session summary. Also kept stable and ordered.
3. **`DYNAMIC_INPUT`** — current user prompt, git diff, runtime output (automatically filtered), ISO timestamp. All volatile data goes here, placed last so changes don't bust the cache for zones 1 and 2.

Zone types are defined in `zones.ts`; each zone has its own builder (`static-block.ts`, `state-layer.ts`, `dynamic-input.ts`). The `prefix-hash.ts` module hashes zones 1+2 together to produce a cache fingerprint for diagnostics.

### Hierarchical Context (`packages/core/src/context/hierarchical-loader.ts`)

An opt-in two-tier loading strategy for `STATIC_BLOCK`. When `context.hierarchical = true` in `.relay/config.json`:

- A slim `trunk.md` (~300 tokens) is always loaded as the base snapshot.
- Per-domain `branches/{domain}.md` files are lazy-loaded only when the current prompt+diff text matches domain keywords (scored by `DOMAIN_PATTERNS` regex matching).
- Domains: `git`, `tokens`, `memory`, `providers`, `config`, `context`.
- The `loadHierarchicalContext()` function returns a `HierarchicalContext` with `trunk`, `branches`, and `loaded` (combined string).

Generate the initial context files with `relay context build`. This reads `docs/ARCHITECTURE.md` and scaffolds `.relay/context/trunk.md` and `branches/*.md`.

### Async git operations (`packages/core/src/git/`)

`getGitDiffSinceAsync` and `buildPrioritizedFileIndexAsync` run `git diff` and `git ls-files` concurrently via `Promise.all` in the `relay ask` handler, avoiding sequential subprocess blocking. Sync variants remain available for contexts where async is not needed.

### Tokenizer memoization (`packages/core/src/tokens/tokenizer.ts`)

`estimateTokens` caches results in a process-lifetime two-level Map keyed on `(encodingName, correctionFactor) → text → TokenEstimate`. Prevents re-encoding the same large text (git diffs, zone content) multiple times per invocation.

### Team configuration (`RELAY_BASE_CONFIG`)

Set `RELAY_BASE_CONFIG=/path/to/base.json` to load a shared base configuration before project-local `.relay/config.json`. Deep-merged using `deepMerge` in `packages/core/src/utils/merge.ts` (which guards against prototype pollution via `UNSAFE_KEYS`). Useful for team-wide provider or token defaults. See `docs/CONFIGURATION.md` for the full merge rules.

### Signature Mapping (`scripts/gen-sigmap.ts`, `pnpm sigmap`)

Generates `.relay/sigmap.md` — a lightweight structural skeleton of the codebase. Uses TypeScript's compiler API (`ts.createSourceFile`) to extract interfaces, type aliases, enums, and function/method signatures while stripping implementation bodies. Token cost is ~10–15% of full source.

Relay automatically uses `.relay/sigmap.md` as `sourceSnapshot` when `.relay/memory/source-snapshot.md` is absent or contains the default placeholder text. Run `pnpm sigmap` whenever the codebase structure changes.

### Output Filtering (`packages/core/src/utils/output-filter.ts`)

`filterOutput(raw, opts?)` is a deterministic middleware function applied automatically to `runtimeOutput` inside `buildDynamicInput()`. It runs a pipeline:

1. Strip ANSI escape codes
2. Collapse consecutive blank lines (max 1)
3. Deduplicate consecutive identical lines → `[×N repeated]` annotation
4. Suppress excess success/pass lines beyond `maxSuccessOccurrences` (default 3) → suppression note
5. Truncate to `maxLines` (default 300) with head-60%/tail-40% strategy

Disable per-call with `outputFilterOptions: { enabled: false }`. Tune globally via `filter.*` in `.relay/config.json`.

### Git-anchored delta prompting (`packages/core/src/git/`)

When a session starts (`relay session start`), `snapshot.ts` records the current git SHA as `base_git_sha` in `.relay/session.json`. All subsequent `relay ask` calls inject only `git diff <base_git_sha>` rather than resending full file contents. `delta-builder.ts` composes this into the `DYNAMIC_INPUT` zone. `tracked-files.ts` calls `git ls-files` to enumerate the file index placed in `STATE_LAYER`.

### Token garbage collection (`packages/core/src/memory/gc.ts`)

Raw session history accumulates in `.relay/memory/session.raw.md`. `compactHistoryToState()` shells out to the configured GC command with a schema-constrained JSON extraction prompt. The result collapses verbose history (often 10k+ tokens) into a `SemanticState` struct (~500 tokens) written to `.relay/memory/semantic-state.json`. This compacted state replaces raw history in the next prompt's `STATE_LAYER`. The `SemanticState` schema tracks: `active_target`, `current_goal`, `runtime_errors`, `verified_hypotheses`, `rejected_hypotheses`, `next_actions`, `code_changes`.

### Provider adapters (`packages/core/src/providers/`)

The `ProviderAdapter` interface requires only `name` and `sendPrompt(payload: string): Promise<number>`. `ShellProvider` implements this by spawning the configured CLI command with the payload. Relay handles all context construction upstream and leaves model execution to the configured provider.

### Token budgeting (`packages/core/src/tokens/`)

`tokenizer.ts` estimates tokens using js-tiktoken (`cl100k_base` encoding) with a `char/4` fallback. `budget.ts` checks the assembled payload against three thresholds from config: `warningLimit`, `requireConfirmationAbove`, `hardLimit` — returning a status of `ok`, `warning`, `requires_confirmation`, or `blocked`. `anomaly-detector.ts` reads `.relay/calls.json` and warns if more than 10 prompts are sent within 60 seconds.

### Configuration (`packages/core/src/config/relay-config.ts`)

Config is validated with Zod at load time. The schema covers: `provider`, `routing`, `gc`, `tokens`, `files`, `context` (hierarchical loading), and `filter` (output filtering). Config is stored at `.relay/config.json` and created with defaults by `relay init`.

### Local runtime state (`.relay/`)

Created by `relay init`. Not committed to git.

```
.relay/
├── config.json                      # RelayConfig (Zod-validated)
├── session.json                     # base_git_sha, prefix_hash, tracked_paths
├── calls.json                       # timestamp log for anomaly detection
├── sigmap.md                        # generated by pnpm sigmap (structural skeleton)
├── context/                         # generated by relay context build
│   ├── trunk.md                     # slim always-loaded project overview
│   └── branches/                    # domain-specific context, lazy-loaded
│       ├── git.md
│       ├── tokens.md
│       ├── memory.md
│       ├── providers.md
│       ├── config.md
│       └── context.md
└── memory/
    ├── semantic-state.json          # compacted SemanticState
    ├── semantic-state.snapshot.json # pre-gc backup
    ├── session.raw.md               # raw history (append-only)
    └── session.compacted.md         # last compaction output
```

### CLI (`packages/cli/src/index.ts`)

Thin Commander.js router. All business logic lives in `@relay/core`; the CLI only parses arguments and calls core functions. Key command groups: `session`, `ask`, `diff`, `cache`, `tokens`, `gc`, `context` (includes `inspect` and `build`).
