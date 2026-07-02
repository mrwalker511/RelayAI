# Contributing to RelayAI

## Dev Setup

**Requirements:** Node 20+, pnpm 9+

```bash
git clone https://github.com/mrwalker511/relayai
cd relayai
pnpm install
pnpm build
pnpm test
```

## Project Structure

```
packages/
  core/   # @relay-cache/core — context engine, git, tokens, memory, providers
  cli/    # @relay-cache/cli  — Commander.js command router, MCP server
docs/     # User-facing markdown guides
```

## Common Commands

| Command | Purpose |
|---------|---------|
| `pnpm build` | Compile TypeScript in all packages |
| `pnpm typecheck` | Type-check without emitting |
| `pnpm test` | Run all tests |
| `pnpm audit --audit-level=high` | Check for known CVEs |
| `pnpm pack:check` | Verify publishable package shape |

`pnpm test` automatically builds before running tests. You can run it directly from a fresh clone without a separate `pnpm build` step.

## Making Changes

- **Bug fixes** — open a PR against `main` with a test that reproduces the bug
- **Features** — open an issue first to discuss; PRs without prior discussion may be declined
- **Tests** — use Node's built-in `node:test` runner; no external test frameworks
- **TypeScript** — strict mode is required; no `any` unless truly unavoidable with a comment explaining why

## Adding a Provider Adapter

See [`docs/PROVIDER_ADAPTERS.md`](docs/PROVIDER_ADAPTERS.md) for the full guide. In short:

1. Add a default command entry to `PROVIDER_DEFAULTS` in `packages/core/src/providers/shell-provider.ts`
2. Ensure the command array contains no shell metacharacters (validated automatically for user-configured commands)
3. Add a test in `packages/core/src/providers/shell-provider.test.ts`

## Commit Message Format

```
<type>: <short summary>

Types: fix, feat, refactor, test, docs, chore
```

Keep the summary under 72 characters. Reference issues as `Fixes #123` in the body.

## PR Guidelines

- One logical change per PR
- All tests must pass (`pnpm test`)
- Typecheck must pass (`pnpm typecheck`)
- `pnpm audit --audit-level=high` must exit 0
