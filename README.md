# Relay CLI

[![CI](https://github.com/mrwalker511/relayai/actions/workflows/ci.yml/badge.svg)](https://github.com/mrwalker511/relayai/actions/workflows/ci.yml)
[![Node.js ≥ 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![pnpm](https://img.shields.io/badge/pnpm-9-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)

> Local-first context and prompt-cache optimizer for coding agents and model CLIs.

Relay wraps your existing provider command, builds deterministic prompt payloads from your repository state, and keeps volatile details at the end of the prompt so provider-side caching can work more effectively.

Relay does **not** replace your model or coding agent. It gives them cleaner, repeatable context.

---

## Why Relay

| Need | What Relay Provides |
| --- | --- |
| Lower repeated prompt cost | Stable prompt zones designed for provider cache reuse |
| Better continuity between sessions | Compact semantic memory stored in `.relay/` |
| Smaller follow-up prompts | Git-anchored diffs instead of resending full files |
| Safer large-context usage | Local token estimates, budget checks, and anomaly detection |
| Provider flexibility | Shell-based adapters for any CLI that reads stdin |

---

## How It Works

Relay assembles every outbound prompt in three ordered zones:

```
┌─────────────────────────────────────────┐
│  STATIC_BLOCK                           │  ← project rules, architecture notes,
│  (stable across requests)               │    source snapshots
├─────────────────────────────────────────┤
│  STATE_LAYER                            │  ← semantic memory, file index,
│  (stable, structured)                   │    session summary
├─────────────────────────────────────────┤
│  DYNAMIC_INPUT                          │  ← current prompt, git diff,
│  (volatile, always last)                │    runtime output, timestamp
└─────────────────────────────────────────┘
          │
          ▼
   configured provider CLI  (stdin)
```

The stable zones come first so provider caches hit on repeat calls. Volatile data goes last so it never busts the cached prefix. Relay also records a base git SHA at session start — follow-up prompts include only the diff since that base, not the whole repository.

---

## Prerequisites

- **Node.js 20 or newer**
- **pnpm 9** — `npm install -g pnpm`
- **git**
- A model or coding-agent CLI that can read a prompt from stdin (Claude, Ollama, ChatGPT CLI, etc.)

---

## Installation

```bash
npm install -g @relay/cli
```

After installing, the `relay` command is available globally:

```bash
relay --help
```

Or run without installing using `npx`:

```bash
npx @relay/cli --help
```

---

## Local Development

To work on Relay itself, clone the repository and build from source:

```bash
git clone https://github.com/mrwalker511/relayai.git RelayAI
cd RelayAI
pnpm install
pnpm build
```

Confirm the CLI works:

```bash
node packages/cli/dist/index.js --help
```

Create a shell alias so you can use `relay` from any repository:

```bash
alias relay='node /absolute/path/to/RelayAI/packages/cli/dist/index.js'
```

Replace `/absolute/path/to/RelayAI` with your actual clone path. Add the alias to your shell profile (`.bashrc`, `.zshrc`, etc.) once you've confirmed it works.

---

## Quick Start

Run these commands inside the repository you want Relay to manage:

```bash
relay init                          # create .relay/ with config and memory files
relay doctor                        # verify workspace readiness
relay session start                 # anchor context to the current git SHA
relay ask "Summarize this repo"     # print the assembled prompt payload
```

Without `--provider`, `relay ask` prints the payload between `---BEGIN RELAY PAYLOAD---` and `---END RELAY PAYLOAD---`. Once you have a provider configured, add `--provider default` to route the payload to your model.

For a complete walkthrough including provider setup, see [`docs/USER_INSTALLATION_GUIDE.md`](docs/USER_INSTALLATION_GUIDE.md).

---

## Everyday Commands

```bash
relay doctor                                      # verify Relay readiness
relay session start                               # anchor context to the current git SHA
relay ask "Review the active diff"                # print a Relay payload
relay ask "Review the active diff" --provider default  # send to configured provider
relay diff                                        # inspect the session delta
relay context inspect                             # inspect prompt-construction state
relay tokens inspect                              # inspect token usage by zone
relay cache inspect                               # inspect cache-relevant prefix metadata
relay gc preview                                  # preview semantic memory compaction
relay gc run                                      # compact session history
relay mcp                                         # expose Relay context to MCP agents
```

See [`docs/COMMANDS.md`](docs/COMMANDS.md) for the full command reference.

---

## MCP Integration

Relay can run as a read-only MCP context server so any MCP-compatible agent (Claude Code, Cursor, etc.) can request deterministic project context without leaving its normal workflow.

```bash
relay mcp   # starts the MCP stdio server
```

See [`docs/MCP.md`](docs/MCP.md) for setup instructions and the full tool contract.

---

## Documentation

| Document | Purpose |
| --- | --- |
| [`docs/USER_INSTALLATION_GUIDE.md`](docs/USER_INSTALLATION_GUIDE.md) | Setup, provider configuration, daily workflow, and troubleshooting |
| [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) | Short local development quick start |
| [`docs/COMMANDS.md`](docs/COMMANDS.md) | Full CLI command reference |
| [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) | `.relay/config.json` schema reference |
| [`docs/PROVIDER_ADAPTERS.md`](docs/PROVIDER_ADAPTERS.md) | Provider command examples and adapter design |
| [`docs/MCP.md`](docs/MCP.md) | MCP setup and tool contract for agent integrations |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Context construction architecture and module reference |

---

## Repository Structure

```
RelayAI/
├── packages/
│   ├── core/       # Context engine, token guardrails, git delta logic, semantic memory
│   └── cli/        # Terminal interface and MCP server
├── docs/           # Product, architecture, and implementation docs
├── examples/       # Example config and semantic state files
├── AGENTS.md       # Guidance for coding agents working with this repo
└── README.md
```

---

## Development

```bash
pnpm install        # install all workspace dependencies
pnpm build          # compile all packages
pnpm typecheck      # type-check without emitting
pnpm test           # run tests (build first)
pnpm dev            # run CLI via tsx without building
pnpm run ci         # full CI: build + typecheck + test + pack:check
pnpm pack:check     # validate package artifacts (dry run)
```

Filter commands to a single package:

```bash
pnpm --filter @relay/core build
pnpm --filter @relay/cli dev
```

CI runs on every push and pull request to `main`. The pipeline runs `build`, `typecheck`, `test`, and `pack:check` on Node.js 22.
