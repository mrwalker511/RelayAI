# Relay CLI

Relay is a local-first, model- and LLM-agnostic context optimizer for software engineers using coding agents or model CLIs.

Relay does **not** replace your model or coding agent. It wraps configured provider commands with a deterministic context-management layer that reduces repeated prompt submission, preserves useful project state across sessions, and helps maximize prompt caching where supported.

## Core Goals

- Reduce token costs and repeated context submission.
- Preserve useful project and session context across coding sessions.
- Make it easy to resume work without re-explaining the project.
- Provide a consistent context layer across model and coding-agent CLIs.
- Maximize prompt-cache hit rates through deterministic prompt construction.

## Key Features

### 1. Deterministic Prefix Pinning

Relay builds every outbound prompt in three strict zones:

1. **Static Block** — stable project rules, architecture notes, environment settings, and selected source snapshots.
2. **State Layer** — structured session memory, file index, active task state, and previous summaries.
3. **Dynamic Input** — latest user prompt, git diff, runtime output, and timestamps.

The first two zones are kept stable in order and structure to maximize provider prompt-cache reuse.

### 2. Token Garbage Collection

Relay compacts noisy local session history into a concise semantic state map before sending context to a model.

Instead of resending verbose chat history, Relay keeps durable developer state such as:

```json
{
  "active_target": "auth_middleware.py",
  "runtime_errors": ["403 Forbidden on line 24"],
  "verified_hypotheses": ["JWT extraction succeeds, validation fails"]
}
```

### 3. Git-Anchored Delta Prompting

Relay uses git snapshots and diffs to avoid resending full files after the initial session context has been established.

Subsequent prompts include only relevant changed lines, active files, failing test output, and compact semantic state.

### 4. Local Token-Budgeting Guardrails

Relay estimates token usage locally before sending a prompt to a provider. If the outbound payload exceeds the configured budget, Relay can halt, inspect, compact, or continue with confirmation.

## Quick Start

```bash
pnpm install
pnpm build
pnpm --filter @relay/cli relay init
pnpm --filter @relay/cli relay session start
pnpm --filter @relay/cli relay ask "Summarize this repository"
```

For detailed setup instructions, see [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md).

## Example CLI Commands

```bash
relay init
relay session start
relay ask "Fix this failing auth test"
relay context inspect
relay cache inspect
relay cache fingerprint
relay gc run
relay gc status
relay tokens estimate
relay diff
```

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

## Status

This repository has implemented the MVP command surface described in `docs/MVP_ROADMAP.md`.

The current phase is dogfood readiness: runtime diagnostics, stricter local config validation, and documentation that matches the live CLI.
