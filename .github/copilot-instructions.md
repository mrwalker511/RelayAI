# GitHub Copilot Workspace Instructions

## Project Overview

Relay is a local-first, model-agnostic context and prompt-cache optimizer for coding agents and model CLIs. It wraps provider commands, assembles deterministic prompt payloads from repository state, and structures content into stable zones so provider-side caching works more effectively across sessions.

Relay does **not** replace a model or coding agent. It gives them cleaner, repeatable, cache-optimized context.

## Repository Structure

```
RelayAI/
├── packages/
│   ├── core/        # Context engine, token guardrails, git delta logic, semantic memory
│   └── cli/         # Commander.js CLI router and MCP stdio server
├── docs/            # Architecture, command reference, MCP guide, configuration reference
├── .github/
│   ├── copilot-instructions.md   # This file
│   └── workflows/
│       ├── ci.yml                # CI: build → typecheck → test → pack:check
│       └── publish.yml           # npm publish triggered on v* tags
├── .codex/hooks.json             # OpenAI Codex lifecycle hooks
├── .claude/settings.json         # Claude Code lifecycle hooks
├── AGENTS.md                     # Coding agent guidance (also serves as Codex AGENTS.md)
└── README.md
```

## Commands

```bash
pnpm install                     # install all workspace dependencies
pnpm build                       # compile all packages (tsc) — required before testing
pnpm typecheck                   # strict TypeScript check, no emit
pnpm test                        # run ~207 tests across core + cli (build first)
pnpm run ci                      # full pipeline: build + typecheck + test + pack:check
pnpm sigmap                      # regenerate .relay/sigmap.md after structural changes
pnpm dev                         # run CLI via tsx without building
pnpm clean                       # remove packages/*/dist
relay completion bash|zsh|fish   # print shell completion script to stdout
```

Filter to a single package:

```bash
pnpm --filter @relay/core build
pnpm --filter @relay/cli dev
```

Run a single test file after building:

```bash
node --test packages/core/dist/tokens/budget.test.js
```

## Architecture

### Three-Zone Prompt Assembly (`packages/core/src/context/`)

Every prompt is assembled in a fixed order designed to maximize provider-side cache hit rates:

1. **`STATIC_BLOCK`** — project rules, architecture notes, source snapshots. Stable across requests so the provider can cache this prefix.
2. **`STATE_LAYER`** — semantic memory JSON, file index, session summary. Also stable and consistently ordered.
3. **`DYNAMIC_INPUT`** — current user prompt, git diff, runtime output, timestamp. All volatile content placed last to avoid busting the cached prefix.

Key files: `payload-builder.ts`, `zones.ts`, `static-block.ts`, `state-layer.ts`, `dynamic-input.ts`, `prefix-hash.ts`.

### Key Modules

| Module | Path | Purpose |
|--------|------|---------|
| Payload builder | `packages/core/src/context/payload-builder.ts` | Assembles three-zone prompt |
| Config | `packages/core/src/config/relay-config.ts` | Zod-validated `.relay/config.json` |
| Git delta | `packages/core/src/git/` | Records base SHA; diffs only on follow-up prompts. Async variants (`*Async`) parallelize `ls-files` + `diff` via `Promise.all` |
| Semantic GC | `packages/core/src/memory/gc.ts` | Compacts raw history into `SemanticState` |
| Token budget | `packages/core/src/tokens/budget.ts` | warning / confirmation / hard limit enforcement |
| Token cache | `packages/core/src/tokens/tokenizer.ts` | Process-lifetime memoization; avoids re-encoding identical text within an invocation |
| MCP server | `packages/cli/src/mcp-server.ts` | Six read-only MCP tools over stdio |
| CLI router | `packages/cli/src/index.ts` | Commander.js command routing |

### MCP Integration

`relay mcp` starts a read-only MCP stdio server exposing six tools:

- `get_prompt_payload` — full cache-optimized payload for a user prompt
- `get_project_context` — session metadata, file index, zone token counts, budget
- `get_git_delta` — diff since session base SHA (optional `max_chars` limit)
- `get_semantic_state` — compacted `SemanticState` from GC
- `get_token_budget` — zone-by-zone token counts and budget status
- `inspect_context_health` — structured health findings for config, session, prefix, budget, git

See `docs/MCP.md` for full setup and tool contract.

## Code Style

- **TypeScript strict mode** — `pnpm typecheck` is the lint step; no ESLint configured.
- **No comments** unless the WHY is genuinely non-obvious (hidden constraint, workaround for a specific bug, surprising invariant). Never add comments describing what the code does.
- **No docstrings** — well-named identifiers are self-documenting.
- **No unused code** — delete rather than rename or comment out.
- **Validation at boundaries** — use Zod for external input (config, MCP arguments). Trust internal invariants.
- **No new abstractions** beyond what the task requires. Prefer explicit repetition over premature generalization.

## Testing

Tests use Node's built-in test runner — no Jest, no Vitest. Always build before running tests:

```bash
pnpm build && pnpm test
```

Test files live alongside source as `*.test.ts` and compile to `*.test.js` in `dist/`. There are no mocks; tests exercise pure logic with controlled inputs. `pnpm run ci` matches the CI pipeline exactly.

## Local Runtime State

Relay creates `.relay/` in the working repository at `relay init` time. This directory is not committed to git. Key files agents may reference:

**Team config:** Set `RELAY_BASE_CONFIG=/path/to/base.json` to deep-merge a shared base configuration before the project-local `.relay/config.json`. Local values win on any conflict. See `docs/CONFIGURATION.md` for merge rules.

```
.relay/
├── config.json           # RelayConfig (Zod-validated)
├── session.json          # base_git_sha, prefix_hash, tracked_paths
├── sigmap.md             # structural skeleton of codebase (regenerated by pnpm sigmap)
└── memory/
    ├── semantic-state.json   # compacted SemanticState
    └── session.raw.md        # append-only raw session history
```
