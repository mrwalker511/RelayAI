# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## Commands

```bash
pnpm install          # install all workspace dependencies
pnpm build            # compile all packages (tsc)
pnpm typecheck        # type-check all packages without emitting
pnpm test             # run tests across all packages (must build first)
pnpm dev              # run CLI via tsx without building
pnpm clean            # remove packages/*/dist
```

Filter to a single package:

```bash
pnpm --filter @relay/core build
pnpm --filter @relay/cli dev
```

Tests run against compiled output via Node's built-in test runner. Always build before testing:

```bash
cd packages/core && pnpm build && node --test dist/path/to/file.test.js
```

There is no ESLint. `pnpm typecheck` (strict TypeScript) is the lint step. CI runs `pnpm build` then `pnpm typecheck`.

## Architecture

Relay is a deterministic context construction engine for model- and LLM-agnostic coding workflows. Every outbound prompt is assembled through three stable zones to maximize prompt-cache hit rates where the selected provider supports them.

### Three-zone prompt construction (`packages/core/src/context/`)

`payload-builder.ts` assembles zones in a fixed order:

1. **`STATIC_BLOCK`** — project rules, architecture notes, source snapshots. Kept stable across requests so provider caches this prefix on the first call.
2. **`STATE_LAYER`** — semantic state JSON, file index, session summary. Also kept stable and ordered.
3. **`DYNAMIC_INPUT`** — current user prompt, git diff, runtime output, ISO timestamp. All volatile data goes here, placed last so changes don't bust the cache for zones 1 and 2.

Zone types are defined in `zones.ts`; each zone has its own builder (`static-block.ts`, `state-layer.ts`, `dynamic-input.ts`). The `prefix-hash.ts` module hashes zones 1+2 together to produce a cache fingerprint for diagnostics.

### Git-anchored delta prompting (`packages/core/src/git/`)

When a session starts (`relay session start`), `snapshot.ts` records the current git SHA as `base_git_sha` in `.relay/session.json`. All subsequent `relay ask` calls inject only `git diff <base_git_sha>` rather than resending full file contents. `delta-builder.ts` composes this into the `DYNAMIC_INPUT` zone. `tracked-files.ts` calls `git ls-files` to enumerate the file index placed in `STATE_LAYER`.

### Token garbage collection (`packages/core/src/memory/gc.ts`)

Raw session history accumulates in `.relay/memory/session.raw.md`. `compactHistoryToState()` shells out to the configured GC command with a schema-constrained JSON extraction prompt. The result collapses verbose history (often 10k+ tokens) into a `SemanticState` struct (~500 tokens) written to `.relay/memory/semantic-state.json`. This compacted state replaces raw history in the next prompt's `STATE_LAYER`. The `SemanticState` schema tracks: `active_target`, `current_goal`, `runtime_errors`, `verified_hypotheses`, `rejected_hypotheses`, `next_actions`, `code_changes`.

### Provider adapters (`packages/core/src/providers/`)

The `ProviderAdapter` interface requires only `name` and `sendPrompt(payload: string): Promise<number>`. `ShellProvider` implements this by spawning the configured CLI command with the payload. Relay handles all context construction upstream and leaves model execution to the configured provider.

### Token budgeting (`packages/core/src/tokens/`)

`tokenizer.ts` estimates tokens using js-tiktoken (`cl100k_base` encoding) with a `char/4` fallback. `budget.ts` checks the assembled payload against three thresholds from config: `warningLimit`, `requireConfirmationAbove`, `hardLimit` — returning a status of `ok`, `warning`, `requires_confirmation`, or `blocked`. `anomaly-detector.ts` reads `.relay/calls.json` and warns if more than 10 prompts are sent within 60 seconds.

### Configuration (`packages/core/src/config/relay-config.ts`)

Config is validated with Zod at load time. The schema has three sections: `provider` (default provider name + command overrides), `gc` (history token limit, target summary size, what to preserve), and `tokens` (hard/warning/confirmation limits). Config is stored at `.relay/config.json` and created with defaults by `relay init`.

### Local runtime state (`.relay/`)

Created by `relay init`. Not committed to git.

```
.relay/
├── config.json                      # RelayConfig (Zod-validated)
├── session.json                     # base_git_sha, prefix_hash, tracked_paths
├── calls.json                       # timestamp log for anomaly detection
└── memory/
    ├── semantic-state.json          # compacted SemanticState
    ├── semantic-state.snapshot.json # pre-gc backup
    ├── session.raw.md               # raw history (append-only)
    └── session.compacted.md         # last compaction output
```

### CLI (`packages/cli/src/index.ts`)

Thin Commander.js router. All business logic lives in `@relay/core`; the CLI only parses arguments and calls core functions. Key command groups: `session`, `ask`, `diff`, `cache`, `tokens`, `gc`, `context`.
