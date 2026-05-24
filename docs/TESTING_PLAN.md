# RelayAI Testing Plan

> **This plan has moved to an interactive HTML guide.**
>
> Open **`docs/testing-plan.html`** in your browser for the step-by-step Codex CLI workflow with progress tracking and copy-paste commands.
>
> After testing, upload your two Codex session files to **`docs/session-compare.html`** to get automatic comparison metrics — no manual recording required.

---

**Test Project:** [`matt-mcp`](https://github.com/mrwalker511/matt-mcp)  
**Purpose:** Validate RelayAI effectiveness for leadership reporting — compare AI coding session quality, token usage, and context accuracy with and without Relay.  
**Primary tool:** Open `docs/testing-plan.html` in your browser.  
**Results tool:** Open `docs/session-compare.html` to upload Codex session files and view the comparison.

---

## Pre-Test Setup

### Step 1 — Prepare RelayAI

```bash
# In the RelayAI repo
pnpm install
pnpm build
```

Verify the CLI is functional:

```bash
node packages/cli/dist/index.js --help
```

### Step 2 — Prepare the Test Project

```bash
# In matt-mcp repo
git clone https://github.com/mrwalker511/matt-mcp.git
cd matt-mcp
npm install
npm run build
```

Confirm it builds cleanly and `npm test` passes before any testing begins. Record the current HEAD SHA:

```bash
git rev-parse HEAD
# Save this as your Baseline SHA
```

### Step 3 — Define Your 5 Test Prompts

Use the same prompts for BOTH baseline and Relay-enabled rounds. Suggested prompts for matt-mcp:

| # | Prompt |
|---|--------|
| P1 | `Explain the overall architecture of this project` |
| P2 | `Review the auth flow and identify any security risks` |
| P3 | `Add input validation to the generate tool command` |
| P4 | `Summarize what has changed in the active diff` |
| P5 | `Write unit tests for the register command` |

You may substitute your own prompts — just keep them identical across both test rounds.

---

## Phase 1 — Baseline (WITHOUT RelayAI)

> Run these steps first. Do NOT use the `relay` CLI in this phase.

### Step 4 — Open a fresh coding session in your AI CLI (Claude Code, Copilot, etc.)

Do not carry context from any prior session.

### Step 5 — Run each prompt and record results

For each of the 5 prompts:

1. Send the prompt to your AI coding CLI directly
2. Record the **total tokens sent** (check CLI output or provider usage dashboard)
3. Score **response quality** (1–5 scale, see rubric below)
4. Mark **context accuracy** — did the model reference the correct files/functions? (Yes / No / Partial)
5. Note any **hallucinations** — wrong filenames, nonexistent functions, fabricated behavior
6. Record **response time** (rough estimate in seconds)

**Quality Rubric:**

| Score | Meaning |
|-------|---------|
| 5 | Accurate, complete, referenced the right code |
| 4 | Mostly correct, minor gap |
| 3 | Partially correct, missing important context |
| 2 | Wrong context, vague answer |
| 1 | Hallucinated or completely wrong |

### Step 6 — Repeat in a second fresh session

Run all 5 prompts again in a brand-new session (close and reopen the CLI). This captures **session-to-session consistency**.

Enter all results into `docs/relay-test-results.html` under the **Baseline** section.

---

## Phase 2 — Relay-Enabled (WITH RelayAI)

### Step 7 — Initialize Relay in the matt-mcp directory

```bash
cd matt-mcp
node /path/to/RelayAI/packages/cli/dist/index.js init
```

Verify Relay is ready:

```bash
relay doctor
```

✅ All checks must pass before proceeding. Fix any errors reported.

### Step 8 — Start a Relay session

```bash
relay session start
```

Record the **Session Base SHA** that Relay anchors to. It should match your Baseline SHA from Step 2.

### Step 9 — Inspect token baseline before sending any prompt

```bash
relay tokens inspect
```

Record the **initial zone breakdown**: Static Block tokens, State Layer tokens, Dynamic Input tokens.

### Step 10 — Run each prompt through Relay

For each of the 5 prompts:

```bash
relay ask "<your prompt here>"
```

After each prompt:

```bash
relay tokens inspect     # Record zone breakdown
relay cache inspect      # Note whether cache prefix is stable
```

Record the same metrics as Phase 1: total tokens, quality score, context accuracy, hallucinations, response time.

**Also record Relay-specific signals:**
- Cache prefix stable? (Yes / No)
- Correct zone separation seen in token output? (Yes / No)
- Dynamic zone smaller on prompt 2+ vs prompt 1? (Yes / No)

### Step 11 — Inspect session diff after prompts

```bash
relay diff
```

Confirm it shows only the delta from the base SHA — not full file contents. Record: **Diff Anchored?** (Yes / No)

### Step 12 — Repeat in a second Relay session

Close and restart. Run `relay session start` again, then repeat all 5 prompts. This measures **Relay's cross-session continuity**.

Enter all results into `docs/relay-test-results.html` under the **Relay-Enabled** section.

---

## Phase 3 — Pass / Fail Verification

After completing both phases, run through each signal below. All signals must be **green** to confirm Relay is working correctly.

| Signal | Command | Pass Condition |
|--------|---------|----------------|
| CLI healthy | `relay doctor` | Exit 0, no errors |
| Session anchored | `relay session start` | SHA recorded |
| Token zones populated | `relay tokens inspect` | All 3 zones shown with counts |
| Cache prefix stable | `relay cache inspect` | Same prefix hash on prompt 2+ |
| Diff anchored (not full files) | `relay diff` | Only delta shown |
| Follow-up prompts smaller | `relay tokens inspect` | Dynamic zone shrinks |
| GC preview works | `relay gc preview` | Entries listed or empty without error |

**If any signal fails:** Note it in the HTML tracker. Do NOT mark Relay as working until all 7 pass.

---

## Phase 4 — Calculate Metrics

Compute these for the leadership report. The HTML tracker calculates these automatically.

| Metric | Formula |
|--------|---------|
| Token Reduction % | `((Baseline avg − Relay avg) / Baseline avg) × 100` |
| Quality Improvement | `Relay avg quality − Baseline avg quality` |
| Context Accuracy Rate | `Correct responses / 5 prompts × 100` |
| Hallucination Rate | `Hallucination count / 5 prompts × 100` |
| Session Consistency | Did session 2 benefit from session 1 memory? (Y/N) |

---

## Phase 5 — Leadership Summary

Once results are recorded in the HTML tracker, export or screenshot the **Summary Dashboard** tab and include in your report.

Key points to cover:

1. **Token Cost Delta** — % reduction with dollar estimate at your provider rate
2. **Context Accuracy Improvement** — before vs. after scores
3. **Session Continuity** — does Relay maintain memory across restarts?
4. **Pass/Fail Signal Results** — confirm all 7 checks passed
5. **Recommendation** — based on results, proceed to broader rollout / continue tuning / not ready

---

## Quick Reference — Is It Working?

```
relay doctor           → errors?          → Fix before proceeding
relay session start    → SHA captured?    → If no, check git repo init
relay tokens inspect   → zones populated? → If no, context engine not loading files
relay cache inspect    → prefix stable?   → If no, check AGENTS.md/static config
relay diff             → only delta?      → If full files shown, session not anchored
follow-up smaller?     → No?             → Session memory not persisting
relay gc preview       → works?          → If error, semantic store corrupted
```

**All green = RelayAI is working. Proceed to metrics and reporting.**
