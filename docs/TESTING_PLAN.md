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
| Test | `pnpm test` | All 186 unit + integration tests pass |
| Pack check | `pnpm pack:check` | Both packages are publishable (no missing files) |

**Expected result:** All steps exit 0. Test output should show `# pass 137` (core) and `# pass 49` (cli), `# fail 0`.

### Run a single test file

```bash
# Build first, then run one file
pnpm --filter @relay/core build
node --test packages/core/dist/tokens/budget.test.js
```

### Test inventory

| Package | Test files | Test count | Focus areas |
|---|---|---|---|
| `@relay/core` | 20 files | 137 | Config, context zones, git delta, tokens, GC, providers, usage parser (Claude + Codex), savings, output filter |
| `@relay/cli` | 1 file | 49 | E2E: init, session, ask, `--measure` (claude + codex), `{prompt}` routing, usage record, savings, diff, cache, tokens, gc, MCP server |
| **Total** | **21 files** | **186** | — |

### End-to-end smoke test (real Codex)

To validate the full assemble → ask → measure → report loop against a real
provider, run the bundled sample project. This requires the [`codex`](https://github.com/openai/codex)
CLI on your PATH and `codex login` (it makes real Codex calls):

```bash
./examples/sample-project/try-relay.sh
```

**Expected:** exit 0, and the output shows
- three `ask --provider codex --measure` calls, with `cached_input_tokens` growing across calls as Codex's prompt cache warms,
- `prefix_stable` flipping `false → true` in the audit ledger,
- a `relay savings` **MEASURED** section with `calls with usage: 3` and a **PROJECTED** section at `100.0%` prefix-stability.

This exercises `--measure` capture, the Codex usage parser (normalizing cached-inclusive input), the per-call ledger, and the `savings` math. See [`WALKTHROUGH.md`](WALKTHROUGH.md) for the annotated manual version. (The automated suite covers the same parse → ledger → savings path with a fixture, so no Codex account is needed for `pnpm test`.)

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
| `sigmap.md` not updated | `pnpm` / `node` not on PATH in hook shell | Hooks now fall back to `npx tsx scripts/gen-sigmap.ts`. Alternatively, use absolute path: `$(which pnpm) --silent sigmap` |
| `semantic-state.json` not updated | No GC command configured | Set `gc.command` in `.relay/config.json` |
| Hook fires but errors silently | `2>/dev/null || true` suppresses output | Temporarily remove the suppression to see errors |

---

## 3. Manual Integration Testing (Codex vs. Codex + RelayAI)

This phase validates RelayAI's effectiveness by comparing a Codex session without Relay (Baseline) against a Codex session with Relay (Relay-Enabled). We use the live project [`AgentFlow`](https://github.com/mrwalker511/AgentFlow).

---

### Step 1: Initial Setup

1. **Verify RelayAI CLI is functional**:
   Make sure you are in the `RelayAI` directory:
   ```bash
   cd /home/matthew/projects/RelayAI
   pnpm install
   pnpm build
   node packages/cli/dist/index.js --help
   ```

2. **Prepare the AgentFlow project**:
   Ensure you have the `AgentFlow` project cloned and built:
   ```bash
   cd /home/matthew/projects
   # If not already cloned:
   # git clone https://github.com/mrwalker511/AgentFlow.git
   cd AgentFlow
   npm install
   npm run build
   npm test
   ```
   *Note: Ensure all tests pass before proceeding.*

3. **Record the baseline git SHA**:
   Record the current Git HEAD SHA of AgentFlow. This will act as the baseline anchor:
   ```bash
   git rev-parse HEAD
   ```

---

### Step 2: Phase 1 — Baseline (Codex WITHOUT Relay)

In this phase, we run Codex without any help from Relay to establish a baseline.

1. **Open a fresh Codex session in AgentFlow**:
   Make sure you are in the `AgentFlow` directory, and start Codex. Do **NOT** have Relay configured in your Codex MCP config yet.
   ```bash
   cd /home/matthew/projects/AgentFlow
   codex
   ```

2. **Run the 5 test prompts**:
   Enter the following 5 prompts in order. Wait for Codex to finish responding to each before entering the next.
   - **P1**: `Explain the overall architecture of this project`
   - **P2**: `Explain how the semantic-engine clusters events and determines risk levels`
   - **P3**: `Add support for poetry run test to classifyCommand as a test_run`
   - **P4**: `Summarize what has changed in the active diff`
   - **P5**: `Write unit tests for the classifyCommand function in event-engine`

3. **Locate and save the session file**:
   Codex CLI automatically saves session JSON logs to `~/.codex/sessions/`.
   - List files to find the latest session JSON:
     ```bash
     ls -lt ~/.codex/sessions/ | head -5
     ```
   - Copy and rename this file to a safe location:
     ```bash
     cp ~/.codex/sessions/<latest-uuid>.json ~/relay-test-baseline.json
     ```

---

### Step 3: Phase 2 — Setup Relay in AgentFlow

Now, initialize and configure Relay in the `AgentFlow` project directory to prepare for the Relay-enabled Codex run.

1. **Initialize Relay**:
   Run the `init` command in the `AgentFlow` directory using your locally built Relay CLI:
   ```bash
   cd /home/matthew/projects/AgentFlow
   node /home/matthew/projects/RelayAI/packages/cli/dist/index.js init
   ```

2. **Verify Relay Health**:
   Ensure all setup checks pass:
   ```bash
   node /home/matthew/projects/RelayAI/packages/cli/dist/index.js doctor
   ```

3. **Start the Relay session**:
   Anchor Relay to the baseline Git SHA you recorded in Step 1:
   ```bash
   node /home/matthew/projects/RelayAI/packages/cli/dist/index.js session start
   ```

---

### Step 4: Phase 3 — Configure Codex to use Relay MCP

To allow Codex to communicate with Relay, register Relay as an MCP server.

1. **Edit the Codex configuration**:
   Open `~/.codex/config.json` (create it if it doesn't exist) and add the `relay` MCP server pointing to your local Relay CLI build:
   ```json
   {
     "mcpServers": {
       "relay": {
         "command": "node",
         "args": ["/home/matthew/projects/RelayAI/packages/cli/dist/index.js", "mcp"]
       }
     }
   }
   ```

---

### Step 5: Phase 4 — Relay-Enabled (Codex WITH Relay)

In this phase, we run Codex with Relay active. Relay will automatically inject high-quality hierarchical context (trunk and domain branches), semantic memory state, and git delta diffs.

1. **Open a fresh Codex session in AgentFlow**:
   Start Codex. It will automatically detect the configuration in `~/.codex/config.json` and start the Relay MCP server:
   ```bash
   cd /home/matthew/projects/AgentFlow
   codex
   ```
   *Verify: When Codex starts, ensure it lists the Relay MCP tools (such as `get_prompt_payload`).*

2. **Run the same 5 prompts**:
   Enter the exact same prompts as in the baseline phase, in the same order:
   - **P1**: `Explain the overall architecture of this project`
   - **P2**: `Explain how the semantic-engine clusters events and determines risk levels`
   - **P3**: `Add support for poetry run test to classifyCommand as a test_run`
   - **P4**: `Summarize what has changed in the active diff`
   - **P5**: `Write unit tests for the classifyCommand function in event-engine`

3. **Locate and save the session file**:
   - List the latest sessions:
     ```bash
     ls -lt ~/.codex/sessions/ | head -5
     ```
   - Copy and rename this session file:
     ```bash
     cp ~/.codex/sessions/<latest-uuid>.json ~/relay-test-enabled.json
     ```

---

### Step 6: Phase 5 — Comparison and Metrics Analysis

1. **Open the Results Tracker**:
   Open `docs/relay-test-results.html` in your browser. Fill in the baseline and Relay-enabled metrics manually, or use the comparison tool to parse logs automatically.

2. **Open the Session Compare tool**:
   Open `docs/session-compare.html` in your browser.
   - Upload `~/relay-test-baseline.json` as the Baseline session.
   - Upload `~/relay-test-enabled.json` as the Relay-Enabled session.

3. **Observe the Metrics**:
   Review the calculated fields:
   - **Token Reduction %**: Relay's cache-friendly dynamic zone should produce significant token savings on follow-up prompts.
   - **Quality Improvement**: Relay's hierarchical context (trunk + branches) and semantic memory should lead to more accurate answers.
   - **Context Accuracy & Hallucination Rate**: Note whether Codex was able to correctly reference event clustering and risk engine files in AgentFlow without hallucinating paths.

---

### Step 7: Pass/Fail Verification Checklist

All signals must pass before marking the Relay integration as successful:

| Signal | Command | Pass Condition |
|---|---|---|
| CLI healthy | `relay doctor` | Exits with code 0, all diagnostics are green. |
| Session anchored | `relay session start` | Base git SHA is correctly recorded in `.relay/session.json`. |
| Token zones populated | `relay tokens inspect` | `STATIC_BLOCK`, `STATE_LAYER`, and `DYNAMIC_INPUT` are all populated. |
| Cache prefix stable | `relay cache inspect` | The prefix hash remains identical across prompts 2+. |
| Diff anchored | `relay diff` | Only git delta/diff changes are shown in context, not full file contents. |
| Follow-up prompts smaller | `relay tokens inspect` | The context size on prompts P2–P5 is smaller than prompt P1 due to cache optimization. |
| GC preview works | `relay gc preview` | History compacted successfully into `.relay/memory/semantic-state.json`. |

---

## Quick Reference

```
# Automated tests (run this first)
pnpm run ci                  → all 186 tests must pass

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
