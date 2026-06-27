# Relay CLI

[![CI](https://github.com/mrwalker511/RelayAI/actions/workflows/ci.yml/badge.svg)](https://github.com/mrwalker511/RelayAI/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@relay/cli)](https://www.npmjs.com/package/@relay/cli)
[![Node.js ≥ 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Local-first context and prompt-cache optimizer for coding agents and model CLIs.

Relay wraps your existing provider command, builds deterministic prompt payloads from your repository state, and structures content into stable zones so provider-side caching can work more effectively across sessions.

Relay does **not** replace your model or coding agent. It gives them cleaner, repeatable, cache-optimized context.

---

## Install

```bash
npm install -g @relay/cli
```

Or run without installing:

```bash
npx @relay/cli --help
```

**Requirements:** Node.js 20+, git.

---

## 5-minute quickstart

```bash
# inside any git repository
relay init                               # create .relay/ workspace
relay doctor                             # verify setup
relay session start                      # anchor context to current git SHA
relay ask "Summarize the active diff"    # print cache-optimized payload

# wire up to your provider
relay ask "Review this diff" --provider claude   # pipe payload to claude CLI

# tab completion (optional)
source <(relay completion bash)          # or zsh / fish
```

That's it. Add `--measure` to track real token savings, `relay gc run` to compact history, and `relay audit` to inspect the event log.

---

| Need | What Relay Provides |
| --- | --- |
| Lower repeated prompt cost | Stable prompt zones designed for provider cache reuse |
| Better continuity between sessions | Compact semantic memory stored in `.relay/` |
| Smaller follow-up prompts | Git-anchored diffs instead of resending full files |
| Safer large-context usage | Local token estimates, budget checks, and anomaly detection |
| Provider flexibility | Shell-based adapters for any CLI that reads stdin |
| Native agent integration | Read-only MCP server gives agents deterministic context via standard tool calls |

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

### See it work (real OpenAI Codex)

```bash
pnpm install && pnpm build
./examples/sample-project/try-relay.sh
```

This runs RelayAI against the bundled [sample project](examples/sample-project) using the real OpenAI Codex CLI as the measured provider, and prints **measured** token savings building up across calls. It requires the [`codex`](https://github.com/openai/codex) CLI on your PATH and `codex login` (it makes real Codex calls). The annotated version is in [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md).

### Use it on your own repo

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
relay ask "..." --provider codex --measure        # capture the provider's real token usage
relay savings --input-cost-per-million 3          # report measured + projected cache savings
relay gc preview                                  # preview semantic memory compaction
relay gc run                                      # compact session history
relay mcp                                         # expose Relay context to MCP agents
```

See [`docs/COMMANDS.md`](docs/COMMANDS.md) for the full command reference.

### Estimated vs. measured savings

Relay distinguishes two kinds of numbers, and labels them as such:

- **Estimated** — local token math from the bundled tokenizer (`relay tokens inspect`, `relay cache inspect`, `pnpm run compare`). Useful and offline, but a model of cost, not a bill. `compare` shows both the first-call (cold-cache) size and the amortized repeat-call (warm-cache) cost, because savings accrue on repeat calls — a single call on a small repo can cost *more*.
- **Measured** — the provider's actual reported usage. `relay ask --measure` captures it (e.g. Claude's `cache_read_input_tokens`) into the audit ledger; `relay usage record` ingests it for providers that don't emit it; `relay savings` then reports real cost vs a no-cache baseline (cache-creation surcharge and output included). Even without measured usage, `relay savings` grounds its projection in the **measured prefix-stability rate** from your call history rather than a guess.

---

## MCP Integration

Relay can run as a local, read-only MCP context server so any MCP-compatible agent (Claude Code, Cursor, Windsurf, Continue, etc.) can request deterministic, cache-optimized project context without leaving its normal workflow.

```bash
relay mcp   # starts the MCP stdio server over stdio transport
```

Once connected, the agent has access to six read-only tools: `get_prompt_payload`, `get_project_context`, `get_git_delta`, `get_semantic_state`, `get_token_budget`, and `inspect_context_health`. The payload tool returns content blocks with `cache_control` hints so Anthropic-hosted models can cache stable context across repeated calls.

See [`docs/MCP.md`](docs/MCP.md) for host configuration, the full tool reference, recommended agent workflow, and troubleshooting.

---

## Documentation

| Document | Purpose |
| --- | --- |
| [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md) | Hands-on walkthrough proving measured savings on the sample project with real OpenAI Codex |
| [`docs/USER_INSTALLATION_GUIDE.md`](docs/USER_INSTALLATION_GUIDE.md) | Setup, provider configuration, daily workflow, and troubleshooting |
| [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) | Short local development quick start |
| [`docs/COMMANDS.md`](docs/COMMANDS.md) | Full CLI command reference |
| [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) | `.relay/config.json` schema reference |
| [`docs/PROVIDER_ADAPTERS.md`](docs/PROVIDER_ADAPTERS.md) | Provider command examples and adapter design |
| [`docs/MCP.md`](docs/MCP.md) | MCP server setup, tool reference, agent workflow, and troubleshooting |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Context construction architecture and module reference |
| [`AGENTS.md`](AGENTS.md) | Coding agent guidance, Codex integration, and hook documentation |
| [`.github/copilot-instructions.md`](.github/copilot-instructions.md) | GitHub Copilot workspace instructions |

---

## Repository Structure

```
RelayAI/
├── packages/
│   ├── core/       # Context engine, token guardrails, git delta logic, semantic memory
│   └── cli/        # Commander.js router and MCP stdio server
├── docs/           # Architecture, command reference, MCP guide, walkthrough
├── examples/
│   ├── sample-project/   # Runnable demo project + try-relay.sh (real OpenAI Codex)
│   └── *.example.json    # Example config and semantic state files
├── .github/
│   └── copilot-instructions.md   # GitHub Copilot workspace instructions
├── .codex/
│   └── hooks.json                # OpenAI Codex lifecycle hooks
├── .claude/
│   └── settings.json             # Claude Code lifecycle hooks
├── AGENTS.md       # Coding agent guidance (also serves as Codex AGENTS.md)
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
