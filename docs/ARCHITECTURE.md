# Architecture

Relay is a local-first context engine for existing coding assistants.

## System Overview

```txt
Developer
   │
   ▼
relay CLI
   │
   ├── Repo Scanner
   ├── Static Context Builder
   ├── Semantic State Store
   ├── Token GC Engine
   ├── Git Delta Engine
   ├── Token Budget Guardrails
   └── Provider Adapter
          │
          ├── Codex CLI
          ├── Claude Code
          ├── GitHub Copilot CLI
          └── Raw API Provider
```

## Core Package

`@relay/core` owns deterministic context construction and local safety systems.

Important modules:

```txt
packages/core/src/context
packages/core/src/git
packages/core/src/memory
packages/core/src/tokens
packages/core/src/providers
packages/core/src/config
```

## CLI Package

`@relay/cli` exposes the user-facing terminal commands.

The CLI should stay thin. Business logic should live in `@relay/core`.

## Prompt Zones

Every request is built in this order:

```txt
<STATIC_BLOCK>
Stable project context
</STATIC_BLOCK>

<STATE_LAYER>
Structured session memory
</STATE_LAYER>

<DYNAMIC_INPUT>
Latest prompt, diff, logs, timestamps
</DYNAMIC_INPUT>
```

## Cache Strategy

Provider prompt caches are usually prefix-sensitive. Relay therefore optimizes for stable prefixes:

- Keep static project context first.
- Keep state structure predictable.
- Move volatile data to the end.
- Avoid timestamps, logs, and diffs in the prefix.
- Hash the static and state zones for inspection.

## Token GC Strategy

Relay should compact raw session history into developer state:

- Current goal
- Active target file
- Known errors
- Verified hypotheses
- Rejected hypotheses
- Code changes
- Next actions

The compacted representation should be short enough to remain cheap but explicit enough to resume work accurately.

## Git Delta Strategy

Relay records a base git SHA at session start.

After that point, Relay should prefer:

- `git diff <base_sha>`
- staged diff
- failing test output
- nearby symbols
- compact semantic state

over entire source files.

## Guardrails

Before sending a prompt to a provider, Relay should:

1. Estimate tokens locally.
2. Break down tokens by zone.
3. Warn above configured thresholds.
4. Block above hard limits.
5. Detect rapid repeated prompt loops.
6. Offer emergency compaction.
