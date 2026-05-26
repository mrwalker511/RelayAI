# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed
- TypeScript build: added `"types": ["node"]` to `tsconfig.base.json` so `node:*` imports resolve correctly
- CI: `pnpm install --frozen-lockfile` now enforced (was `--frozen-lockfile=false`)
- GC compaction: JSON extraction now handles markdown code fences from model output (`\`\`\`json ... \`\`\``)
- Output filtering: failure lines (`Error:`, `FAILED`, `AssertionError`) are now preserved unconditionally and never dropped by truncation
- Shell provider: user-configured `provider.commands` are validated for shell metacharacters before being passed to `spawn()`
- Git operations: silent failures now emit a warning to stderr before returning empty fallbacks

### Added
- `LICENSE` file (MIT)
- `SECURITY.md` with vulnerability reporting policy
- `CONTRIBUTING.md` with dev setup and PR guidelines
- `CHANGELOG.md` (this file)
- `.github/dependabot.yml` for weekly npm dependency updates
- CI: Node 20 added to test matrix (alongside Node 22)
- CI: `pnpm audit --audit-level=high` step added
- Tests: markdown-fence GC extraction cases in `gc.test.ts`
- Tests: failure-line preservation cases in `output-filter.test.ts`
- Tests: shell provider command allowlist validation in `shell-provider.test.ts`

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
