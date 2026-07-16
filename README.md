# Relay CLI

[![CI](https://github.com/mrwalker511/RelayAI/actions/workflows/ci.yml/badge.svg)](https://github.com/mrwalker511/RelayAI/actions/workflows/ci.yml)
[![Node.js ≥ 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Local-first context and prompt-cache optimizer for coding agents and model CLIs.

Relay wraps your existing provider command, builds deterministic prompt payloads from your repository state, and structures content into stable zones so provider-side caching can work more effectively across sessions.

Relay does **not** replace your model or coding agent. It gives them cleaner, repeatable, cache-optimized context.

| Need                               | What Relay Provides                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| Lower repeated prompt cost         | Stable prompt zones designed for provider cache reuse                           |
| Better continuity between sessions | Compact semantic memory stored in `.relay/`                                     |
| Smaller follow-up prompts          | Git-anchored diffs instead of resending full files                              |
| Safer large-context usage          | Local token estimates, budget checks, and anomaly detection                     |
| Provider flexibility               | Shell-based adapters for any CLI that reads stdin                               |
| Native agent integration           | Read-only MCP server gives agents deterministic context via standard tool calls |

## Benchmarks

First recorded results on this repository (5 fixed prompts, details and caveats in [docs/BENCHMARKS.md](docs/BENCHMARKS.md)):

- **Measured, live provider:** 89.3% cache hit rate; $1.46 actual vs $5.34 uncached — **72.7% saved**, with 100% prefix stability across the session.
- **Synthetic, no API key** (`pnpm run bench`): a five-turn session costs **97.4–99.5% fewer** effective input tokens than naively resending the repository every call.

---

## Install

**Requirements:** Node.js 20+, git, pnpm 9 (`npm install -g pnpm`), and a model or coding-agent CLI that reads a prompt from stdin (Claude, Codex, Ollama, etc.).

Relay installs from source (npm publication is pending). Clone, build, and link — after this, `relay` is a real command in any directory, no alias needed:

```bash
git clone https://github.com/mrwalker511/relayai.git RelayAI
cd RelayAI
pnpm install && pnpm build
cd packages/cli && pnpm link --global
relay --help
```

If `pnpm link --global` reports `Unable to find the global bin directory`, run `pnpm setup` once, restart your shell, and re-run the link command.

<details>
<summary>Prefer not to link globally? Use a shell alias instead.</summary>

From the repository root:

```bash
alias relay="node $(pwd)/packages/cli/dist/index.js"
```

Add the line to your shell profile (`~/.bashrc`, `~/.zshrc`) to make it permanent.

</details>

---

## Quickstart

Run these commands inside any git repository you want Relay to manage:

```bash
relay init                               # create .relay/ with config and memory files
relay doctor                             # verify workspace readiness
relay session start                      # anchor context to the current git SHA
relay ask "Summarize the active diff"    # print the assembled, cache-optimized payload

# wire up to your provider
relay ask "Review this diff" --provider claude   # pipe payload to the claude CLI

# tab completion (optional)
source <(relay completion bash)          # or zsh / fish
```

Without `--provider`, `relay ask` prints the payload between `---BEGIN RELAY PAYLOAD---` and `---END RELAY PAYLOAD---` so you can inspect exactly what would be sent. Add `--measure` to track real token savings, `relay gc run` to compact history, and `relay audit` to inspect the event log.

For a complete walkthrough including provider setup, see [`docs/USER_INSTALLATION_GUIDE.md`](docs/USER_INSTALLATION_GUIDE.md).

### See it work (real OpenAI Codex)

```bash
pnpm install && pnpm build
./examples/sample-project/try-relay.sh
```

This runs RelayAI against the bundled [sample project](examples/sample-project) using the real OpenAI Codex CLI as the measured provider, and prints **measured** token savings building up across calls. It requires the [`codex`](https://github.com/openai/codex) CLI on your PATH and `codex login` (it makes real Codex calls). The annotated version is in [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md).

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

- **Estimated** — local token math from the bundled tokenizer (`relay tokens inspect`, `relay cache inspect`, `pnpm run compare`). Useful and offline, but a model of cost, not a bill. `compare` shows both the first-call (cold-cache) size and the amortized repeat-call (warm-cache) cost, because savings accrue on repeat calls — a single call on a small repo can cost _more_.
- **Measured** — the provider's actual reported usage. `relay ask --measure` captures it (e.g. Claude's `cache_read_input_tokens`) into the audit ledger; `relay usage record` ingests it for providers that don't emit it; `relay savings` then reports real cost vs a no-cache baseline (cache-creation surcharge and output included). Even without measured usage, `relay savings` grounds its projection in the **measured prefix-stability rate** from your call history rather than a guess.

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

## MCP Integration

Relay can run as a local, read-only MCP context server so any MCP-compatible agent (Claude Code, Cursor, Windsurf, Continue, etc.) can request deterministic, cache-optimized project context without leaving its normal workflow.

```bash
relay mcp   # starts the MCP stdio server over stdio transport
```

Once connected, the agent has access to six read-only tools: `get_prompt_payload`, `get_project_context`, `get_git_delta`, `get_semantic_state`, `get_token_budget`, and `inspect_context_health`. The payload tool returns content blocks with `cache_control` hints so Anthropic-hosted models can cache stable context across repeated calls.

See [`docs/MCP.md`](docs/MCP.md) for host configuration, the full tool reference, recommended agent workflow, and troubleshooting.

---

## Documentation

| Document                                                             | Purpose                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md)                         | Hands-on walkthrough proving measured savings on the sample project with real OpenAI Codex |
| [`docs/USER_INSTALLATION_GUIDE.md`](docs/USER_INSTALLATION_GUIDE.md) | Setup, provider configuration, daily workflow, and troubleshooting                         |
| [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md)                 | Short local development quick start                                                        |
| [`docs/COMMANDS.md`](docs/COMMANDS.md)                               | Full CLI command reference                                                                 |
| [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md)                     | `.relay/config.json` schema reference                                                      |
| [`docs/PROVIDER_ADAPTERS.md`](docs/PROVIDER_ADAPTERS.md)             | Provider command examples and adapter design                                               |
| [`docs/MCP.md`](docs/MCP.md)                                         | MCP server setup, tool reference, agent workflow, and troubleshooting                      |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                       | Context construction architecture and module reference                                     |
| [`AGENTS.md`](AGENTS.md)                                             | Coding agent guidance, Codex integration, and hook documentation                           |
| [`.github/copilot-instructions.md`](.github/copilot-instructions.md) | GitHub Copilot workspace instructions                                                      |

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

To work on Relay itself, see [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md). During development, run the CLI via `pnpm dev` instead of the linked command so changes take effect without rebuilding:

```bash
pnpm dev --help
pnpm dev ask "test prompt"
```

Common workspace scripts:

```bash
pnpm install        # install all workspace dependencies
pnpm build          # compile all packages
pnpm typecheck      # type-check without emitting
pnpm test           # run tests
pnpm run coverage   # run tests with coverage report
pnpm dev            # run CLI via tsx without building
pnpm run ci         # full CI: build + typecheck + test + pack:check
pnpm pack:check     # validate package artifacts (dry run)
```

Filter commands to a single package:

```bash
pnpm --filter @relay-cache/core build
pnpm --filter @relay-cache/cli dev
```

CI runs on every push and pull request to `main`. The pipeline runs `build`, `typecheck`, `test`, and `pack:check` on Node.js 20 and 22.
