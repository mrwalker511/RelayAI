# Getting Started

This guide walks through installing, building, and running Relay locally.

## Prerequisites

- Node.js 20+
- pnpm 9+
- git
- An existing coding CLI such as Codex CLI, Claude Code, or GitHub Copilot CLI

## Install Dependencies

```bash
pnpm install
```

## Build the Workspace

```bash
pnpm build
```

## Initialize Relay in a Repository

From the repository you want Relay to manage:

```bash
relay init
```

During local development from this scaffold, use:

```bash
pnpm --filter @relay/cli relay init
```

This creates:

```txt
.relay/
├── config.json
└── memory/
    ├── semantic-state.json
    ├── session.raw.md
    └── session.compacted.md
```

## Start a Session

```bash
relay session start
```

Relay records:

- Session ID
- Base git SHA
- Deterministic prefix hash
- Tracked paths
- Creation timestamp

## Ask Through Relay

```bash
relay ask "Fix the failing auth middleware test"
```

The MVP prints the assembled payload instead of sending it automatically. This is intentional for early development because it makes prompt structure inspectable.

## Inspect Token Usage

```bash
relay tokens estimate "hello world"
relay cache inspect
relay cache fingerprint
```

## Recommended Development Flow with Codex

1. Open this repository in your editor.
2. Run `pnpm install`.
3. Run `pnpm build`.
4. Ask Codex to implement one feature at a time from `docs/MVP_ROADMAP.md`.
5. Keep generated changes small and inspect `relay diff` frequently.

## First Implementation Targets

Start with:

1. Durable config loading from `.relay/config.json`.
2. Real `relay context inspect` output.
3. Interactive token-budget prompts.
4. Real Context GC compaction.
5. Provider adapters for Codex CLI and Claude Code.
