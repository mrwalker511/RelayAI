# Benchmark Prompts

Use these five fixed prompts for every comparison run. Running the same prompts in both the baseline session (without Relay) and the Relay-enabled session ensures the results are comparable across runs, repositories, and team members.

---

## Setup

Before running either session:

1. Clone or use your target repository (a codebase with at least 10 source files and a recent git history works best).
2. Start a fresh coding-agent session so there is no prior context in the baseline.
3. Record the exact session file or token count for each prompt before moving to the next one.

For the Relay-enabled session:

```bash
relay init
relay session start
```

Run the same five prompts through `relay ask "..."` (or via the MCP server if you are using an agent integration).

---

## The Five Prompts

Run these in order, one per exchange. Do not follow up or ask clarifying questions between prompts — each should be a standalone turn.

### 1 — Repository overview

```
Summarize this codebase: its purpose, the main packages or modules, and what a new contributor should read first.
```

### 2 — Entry points and data flow

```
Trace the data flow from the primary entry point to the first I/O operation (file, network, or subprocess). List the functions or methods involved in order.
```

### 3 — Error handling survey

```
Identify the three most common error-handling patterns in this codebase. For each pattern, give one representative code location and explain what happens when the error occurs.
```

### 4 — Test coverage gap

```
Which source modules or files have the weakest test coverage? List up to five, explain why each matters, and suggest one test case for each.
```

### 5 — Refactoring opportunity

```
Identify the single most impactful refactoring you would make to improve maintainability. Describe the current state, the proposed change, and the risk of making the change.
```

---

## Recording Results

For each prompt, record:

| Field | What to capture |
|---|---|
| Input tokens | From the provider's usage output or session file |
| Output tokens | From the provider's usage output or session file |
| Response quality | 1–5: 1 = hallucinated / irrelevant, 3 = correct but vague, 5 = precise and actionable |

Enter these into `docs/relay-test-results.html` (baseline tab) and then run the Relay-enabled session and enter results in the Relay tab.

To compare token counts directly without a live provider, run:

```bash
pnpm run compare -- --prompt "Summarize this codebase..."
```

This prints the Relay payload size vs the naive file-dump baseline without making any API call.
