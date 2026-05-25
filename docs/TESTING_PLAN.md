# RelayAI Testing Guide

This guide covers three testing levels in order of scope:

1. [Automated Tests](#1-automated-tests) — unit + integration via `pnpm run ci`
2. [Hook Verification](#2-hook-verification) — confirm lifecycle hooks fire in each supported agent
3. [Manual Integration Testing](#3-manual-integration-testing) — end-to-end validation against a real project

### 💡 Pro Tip — Autopopulating Session Data

Instead of manually typing token counts and SHAs, you can upload session files directly into the reviewer tool:
- **Relay metadata**: Drag and drop `.relay/session.json` or `.relay/config.json` to autopopulate SHAs, AI Provider, and date.
- **Codex sessions**: Locate your Codex log files under `~/.codex/sessions/` and upload the `.jsonl` files. The reviewer tool will display an interactive **Turn Selector** allowing you to select turns and import their token metrics automatically into either the **Baseline** or **Relay-Enabled** slots.
- **Export/Import State**: You can export the entire state of your results tracker as a JSON file at any time and upload it later to resume.

---

## 1. Automated Tests

### Prerequisites

```bash
# In the RelayAI repo
pnpm install
pnpm build
```

### Run the full local CI pipeline

```bash
pnpm run ci
```

This runs four steps in order:

| Step | Command | What it checks |
|---|---|---|
| Build | `pnpm build` | TypeScript compiles without errors |
| Typecheck | `pnpm typecheck` | Strict type checking (no `any` leaks, no missing types) |
| Test | `pnpm test` | All 133 unit + integration tests pass |
| Pack check | `pnpm pack:check` | Both packages are publishable (no missing files) |

**Expected result:** All steps exit 0. Test output should show `# pass 133, # fail 0`.

### Run a single test file

```bash
# Build first, then run one file
pnpm --filter @relay/core build
node --test packages/core/dist/tokens/budget.test.js
```

### Test inventory

| Package | Test files | Test count | Focus areas |
|---|---|---|---|
| `@relay/core` | 17 files | 90 | Config, context zones, git delta, tokens, GC, providers, output filter |
| `@relay/cli` | 1 file | 43 | E2E: init, session, ask, diff, cache, tokens, gc, MCP server |
| **Total** | **18 files** | **133** | — |

---

## 2. Hook Verification

RelayAI ships lifecycle hooks for three coding agents. Each hook set automates:

- **Session start** — `relay session start` (records base git SHA) + `pnpm sigmap` (builds structural skeleton)
- **Turn end / agent stop** — `relay gc run` (compacts session history into semantic state)
- **After file edits** — `pnpm sigmap` (keeps structural skeleton current)

### 2a. Claude Code — `.claude/settings.json`

**Trigger:** Open a Claude Code session in the RelayAI repo.

**Verification checklist:**

```
[ ] .relay/session.json created (sessionStart hook: relay session start)
[ ] .relay/sigmap.md written or updated (sessionStart hook: pnpm sigmap)
[ ] Edit any source file via Claude → .relay/sigmap.md timestamp updates (PostToolUse hook)
[ ] After Claude ends its turn → .relay/memory/semantic-state.json updated (Stop hook)
```

**Check session anchoring:**

```bash
cat .relay/session.json | grep base_git_sha
# Should match current git HEAD
git rev-parse HEAD
```

**Check prefix stability across prompts:**

```bash
relay cache inspect
# Run relay ask "..." twice and compare prefix_hash — should be identical
```

### 2b. Codex CLI — `.codex/hooks.json`

**Trigger:** Open a Codex CLI session in the RelayAI repo.

**Verification checklist:**

```
[ ] .relay/session.json created (SessionStart hook: relay session start)
[ ] .relay/sigmap.md written or updated (SessionStart hook: pnpm sigmap)
[ ] Edit any file via Codex → .relay/sigmap.md timestamp updates (PostToolUse hook)
[ ] After Codex ends its turn → .relay/memory/semantic-state.json updated (Stop hook)
```

**PostToolUse matcher:** `write_file|apply_patch` — if your Codex version uses different tool names for file writes, update the `matcher` field in `.codex/hooks.json`.

### 2c. GitHub Copilot — `.github/hooks/relay-lifecycle.json`

**Trigger:** Open a GitHub Copilot coding agent session on this repo.

**Verification checklist:**

```
[ ] .relay/session.json created (sessionStart hook: relay session start)
[ ] .relay/sigmap.md written or updated (sessionStart hook: pnpm sigmap)
[ ] Ask Copilot to edit a file → .relay/sigmap.md timestamp updates (postToolUse hook)
[ ] After Copilot ends its turn → .relay/memory/semantic-state.json updated (agentStop hook)
```

**PostToolUse matcher:** `create_file|edit_file|write_file|apply_patch` — update if needed to match actual Copilot tool names.

### Common hook troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `.relay/session.json` not created | `relay` not on PATH | Run `pnpm install -g @relay/cli` or use `node packages/cli/dist/index.js` |
| `sigmap.md` not updated | `pnpm` not on PATH in hook shell | Use absolute path: `$(which pnpm) --silent sigmap` |
| `semantic-state.json` not updated | No GC command configured | Set `gc.command` in `.relay/config.json` |
| Hook fires but errors silently | `2>/dev/null || true` suppresses output | Temporarily remove the suppression to see errors |

---

## 3. Manual Integration Testing

This phase validates RelayAI's effectiveness against a real project by comparing AI session quality, token usage, and context accuracy with and without Relay.

**Interactive tools** (open in browser):

| Tool | File | Purpose |
|---|---|---|
| Step-by-step guide | `docs/testing-plan.html` | Guided workflow with progress tracking and copy-paste commands |
| Session comparison | `docs/session-compare.html` | Upload two Codex session JSON files; auto-calculates metrics |
| Results tracker | `docs/relay-test-results.html` | Record per-prompt scores across baseline and Relay sessions |

### Setup

**Test project:** [`AgentFlow`](https://github.com/mrwalker511/AgentFlow)

```bash
# 1. Verify RelayAI CLI is functional
node packages/cli/dist/index.js --help

# 2. Clone the test project
git clone https://github.com/mrwalker511/AgentFlow.git
cd AgentFlow
npm install && npm run build && npm test

# 3. Record the current HEAD SHA (your baseline anchor)
git rev-parse HEAD
```

### Test prompts

Use the same 5 prompts in both the baseline and Relay-enabled rounds:

| # | Prompt |
|---|--------|
| P1 | `Explain the overall architecture of this project` |
| P2 | `Explain how the semantic-engine clusters events and determines risk levels` |
| P3 | `Add support for poetry run test to classifyCommand as a test_run` |
| P4 | `Summarize what has changed in the active diff` |
| P5 | `Write unit tests for the classifyCommand function in event-engine` |

### Phase 1 — Baseline (WITHOUT Relay)

1. Open a fresh coding session in your AI CLI (Claude Code, Copilot, or Codex).
2. Run each prompt directly — **do not use the `relay` CLI**.
3. For each prompt record: tokens sent, quality score (1–5), context accuracy (Yes/No/Partial), hallucinations, response time.
4. Repeat in a second fresh session for consistency.
5. Enter results in `docs/relay-test-results.html` → Baseline tab.

**Quality rubric:**

| Score | Meaning |
|---|---|
| 5 | Accurate, complete, referenced correct code |
| 4 | Mostly correct, minor gap |
| 3 | Partially correct, missing context |
| 2 | Wrong context, vague |
| 1 | Hallucinated or completely wrong |

### Phase 2 — Relay-Enabled (WITH Relay)

```bash
cd AgentFlow

# Initialize Relay
node /path/to/RelayAI/packages/cli/dist/index.js init
relay doctor           # all checks must pass before proceeding

# Start session (anchor to git HEAD)
relay session start
relay tokens inspect   # record initial zone breakdown

# Run each prompt
relay ask "<prompt>"
relay tokens inspect   # record zone breakdown after each prompt
relay cache inspect    # note prefix hash stability
```

After all prompts:

```bash
relay diff             # confirm only delta shown, not full files
relay gc preview       # confirm GC entries listed without error
```

Repeat in a second Relay session. Enter results in `docs/relay-test-results.html` → Relay tab.

### Phase 3 — Pass/Fail Verification

All 7 signals must be green before marking Relay as working:

| Signal | Command | Pass condition |
|---|---|---|
| CLI healthy | `relay doctor` | Exit 0, no errors |
| Session anchored | `relay session start` | SHA recorded in `.relay/session.json` |
| Token zones populated | `relay tokens inspect` | All 3 zones shown with counts |
| Cache prefix stable | `relay cache inspect` | Same prefix hash on prompts 2+ |
| Diff anchored | `relay diff` | Only delta shown, not full file contents |
| Follow-up prompts smaller | `relay tokens inspect` | Dynamic zone shrinks after prompt 1 |
| GC preview works | `relay gc preview` | Entries listed or empty, no error |

### Phase 4 — Metrics

The HTML tracker (`docs/relay-test-results.html`) calculates these automatically:

| Metric | Formula |
|---|---|
| Token Reduction % | `((Baseline avg − Relay avg) / Baseline avg) × 100` |
| Quality Improvement | `Relay avg quality − Baseline avg quality` |
| Context Accuracy Rate | `Correct responses / 5 prompts × 100` |
| Hallucination Rate | `Hallucination count / 5 prompts × 100` |
| Session Consistency | Did session 2 benefit from session 1 memory? (Y/N) |

---

## Quick Reference

```
# Automated tests (run this first)
pnpm run ci                  → all 133 tests must pass

# Hook verification (for each agent)
cat .relay/session.json      → base_git_sha should match git rev-parse HEAD
ls -la .relay/sigmap.md      → modified timestamp should be recent
cat .relay/memory/semantic-state.json  → non-empty after first Stop/agentStop

# Integration health check
relay doctor                 → all checks green
relay tokens inspect         → all 3 zones populated
relay cache inspect          → prefix hash stable across prompts
relay diff                   → only delta, not full files
```
