# Relay CLI

Relay is a local-first context optimizer for engineers using coding agents and model CLIs.

It wraps your existing provider command, builds deterministic prompt payloads from your repository state, and keeps volatile details at the end of the prompt so provider-side prompt caching can work more effectively.

Relay does **not** replace your model or coding agent. It gives them cleaner, repeatable context.

## Why Relay

| Need | What Relay Provides |
| --- | --- |
| Lower repeated prompt cost | Stable prompt zones designed for provider cache reuse |
| Better continuity between sessions | Compact semantic memory stored in `.relay/` |
| Smaller follow-up prompts | Git-anchored diffs instead of resending full files |
| Safer large-context usage | Local token estimates, budget checks, and diagnostics |
| Provider flexibility | Shell-based adapters for any CLI that reads stdin |

## How It Works

Relay builds every outbound prompt in three ordered zones:

1. **Static Block**: project rules, architecture notes, and stable source context.
2. **State Layer**: semantic memory, file index, and session metadata.
3. **Dynamic Input**: the latest user request, git diff, runtime output, and timestamps.

The stable zones come first. The changing material goes last.

Relay also records a base git SHA when you start a session. Later prompts include the diff from that base, which keeps follow-up context focused on what changed.

## Quick Start

Install dependencies and build Relay:

```bash
pnpm install
pnpm build
```

Try the CLI from this checkout:

```bash
pnpm --filter @relay/cli relay --help
pnpm --filter @relay/cli relay init
pnpm --filter @relay/cli relay session start
pnpm --filter @relay/cli relay ask "Summarize this repository"
```

For a complete walkthrough, including using Relay from another repository, see [`docs/USER_INSTALLATION_GUIDE.md`](docs/USER_INSTALLATION_GUIDE.md).

## Everyday Commands

```bash
relay doctor                         # verify local Relay readiness
relay session start                  # anchor context to the current git SHA
relay ask "Review the active diff"   # print a Relay payload
relay ask "Review the active diff" --provider default
relay diff                           # inspect the session delta
relay context inspect                # inspect prompt-construction state
relay tokens inspect                 # inspect token usage by zone
relay cache inspect                  # inspect cache-relevant prefix metadata
relay gc preview                     # preview semantic memory compaction
relay gc run                         # compact session history
```

## Documentation

| Document | Purpose |
| --- | --- |
| [`docs/USER_INSTALLATION_GUIDE.md`](docs/USER_INSTALLATION_GUIDE.md) | Polished setup, provider configuration, daily workflow, and troubleshooting |
| [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) | Short local development quick start |
| [`docs/COMMANDS.md`](docs/COMMANDS.md) | CLI command reference |
| [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) | `.relay/config.json` reference |
| [`docs/PROVIDER_ADAPTERS.md`](docs/PROVIDER_ADAPTERS.md) | Provider command behavior |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Context construction architecture |

## Repository Structure

```txt
relay-cli/
├── packages/
│   ├── core/       # Context engine, token guardrails, git delta logic
│   └── cli/        # Terminal interface
├── docs/           # Product, architecture, and implementation docs
├── examples/       # Example config and semantic state files
└── .github/        # CI workflow
```

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

CI runs build, typecheck, tests, and package dry-run checks. Before preparing local package artifacts, run:

```bash
pnpm run ci
```

For package-only validation:

```bash
pnpm pack:check
```

## Status

This repository has implemented the MVP command surface described in `docs/MVP_ROADMAP.md`.

The current phase is dogfood readiness: runtime diagnostics, stricter local config validation, and documentation that matches the live CLI.

## Package Readiness

`pnpm pack:check` removes generated `dist` output, rebuilds both workspaces, and runs `npm pack --dry-run` for `@relay/core` and `@relay/cli` with npm cache data under `/tmp`. Package dry runs should include package metadata plus runtime `dist/**/*.js` and `dist/**/*.d.ts` files only.
