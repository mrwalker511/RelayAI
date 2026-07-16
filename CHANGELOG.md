# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed
- CI: realigned `@types/node`, `tsx`, and `typescript` specifiers in `package.json` with `pnpm-lock.yaml` — a bad merge resolution on the July dependabot PRs dropped the manifest bumps and broke `pnpm install --frozen-lockfile`
- CI/publish: the `pnpm audit` step is temporarily non-blocking — npm retired the legacy audit endpoint on 2026-07-15 and every `pnpm audit` call now fails with HTTP 410 until pnpm migrates to the bulk advisory endpoint (pnpm/pnpm#11265)

## [0.1.1] — 2026-07-07

### Added
- `relay doctor` now prints a human-readable checklist (`✓` / `!` / `✗`) with inline fix hints instead of raw JSON. Use `--json` to restore machine-readable output.
- `relay savings` now shows cache hit rate %, an itemized cost breakdown (uncached input / cache reads / cache writes / output), savings percentage, and a note explaining why the projected figure is smaller than measured savings.
- npm publish provenance (`--provenance`) added to the publish workflow — each release is cryptographically linked to the GitHub Actions run that built it.
- Tests added for `context/static-block`, `context/state-layer`, `memory/semantic-state`, and `utils/fs` modules; extended coverage for `audit/savings` sessionId filtering and cost breakdown fields.

### Changed
- npm scope renamed from `@relay/*` to `@relay-cache/*` in the package manifests (`@relay` was unavailable). Publication to the npm registry is pending; Relay is installed from source. The `relay` command name is unchanged.

### Fixed
- TypeScript build: added `"types": ["node"]` to `tsconfig.base.json` so `node:*` imports resolve correctly
- CI: `pnpm install --frozen-lockfile` now enforced (was `--frozen-lockfile=false`)
- GC compaction: JSON extraction now handles markdown code fences from model output (`\`\`\`json ... \`\`\``)
- Output filtering: failure lines (`Error:`, `FAILED`, `AssertionError`) are now preserved unconditionally and never dropped by truncation
- Shell provider: user-configured `provider.commands` are validated for shell metacharacters before being passed to `spawn()`
- Git operations: silent failures now emit a warning to stderr before returning empty fallbacks
- Lockfile drift: `@types/node` version aligned between `package.json` and `pnpm-lock.yaml`

### Added (infrastructure)
- `LICENSE` file (MIT)
- `SECURITY.md` with vulnerability reporting policy
- `CONTRIBUTING.md` with dev setup and PR guidelines
- `.github/dependabot.yml` for weekly npm dependency updates
- CI: Node 20 added to test matrix (alongside Node 22)
- CI: `pnpm audit --audit-level=high` step added

## [0.1.0] — 2025-01-01

### Added
- Three-zone prompt payload construction (STATIC_BLOCK → STATE_LAYER → DYNAMIC_INPUT)
- Git delta prompting: only sends diffs after `relay session start`
- Session lifecycle: `relay session start` / `relay session end`
- Semantic state compaction: `relay gc run` / `relay gc preview`
- Cache diagnostics: `relay cache inspect` / `relay cache warm`
- Token budget inspection: `relay tokens inspect` / `relay tokens budget`
- Context inspection: `relay context inspect` / `relay context build`
- MCP server: `relay mcp` exposes read-only tools for agent integration
- Provider-neutral shell adapter with built-in defaults for Claude, OpenAI, Ollama, Aider
- Zod schema validation for all configuration
- Doctor command: `relay doctor`
- Hierarchical context loading
- Output filtering with success-line suppression and truncation
- Anomaly detection for prompt-loop prevention
