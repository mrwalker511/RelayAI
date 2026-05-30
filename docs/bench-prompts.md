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

This prints the Relay payload size vs the naive file-dump baseline (first-call and amortized repeat-call) without making any API call.

## Automated measured bench (no manual transcription)

Instead of copying usage numbers into HTML by hand, let Relay record them:

```bash
# 1. Capture real provider usage on each prompt (Claude shown; auto-adds --output-format json)
relay ask --provider claude --measure "Give a one-paragraph overview of this repository."
relay ask --provider claude --measure "Where are the entry points and how does data flow?"
# ...repeat for the five prompts...

# 2. Read measured + projected savings straight from the audit ledger
relay savings --input-cost-per-million 3 --cached-input-cost-per-million 0.3 --output-cost-per-million 15
```

For a provider whose CLI does not emit a usage envelope, capture the numbers from its output and ingest them:

```bash
relay usage record --input 1200 --cached-input 8000 --cache-creation 300 --output 450
```

The MEASURED section is real billed cost vs a no-cache baseline; the PROJECTED section uses your **measured** prefix-stability rate. Run the prompts in a session (`relay session start`) so repeat calls share a stable cached prefix — that is where the savings show up.

### Prove it locally without an API

Configure a fake `claude` provider that prints a Claude-style usage envelope, then run the flow above:

```bash
node -e 'const fs=require("fs"),f=".relay/config.json",c=JSON.parse(fs.readFileSync(f));c.provider={default:"claude",commands:{claude:[process.execPath,"-e","process.stdin.resume();process.stdin.on(\"end\",()=>{process.stdout.write(JSON.stringify({type:\"result\",usage:{input_tokens:1200,cache_read_input_tokens:8000,cache_creation_input_tokens:300,output_tokens:450}}));process.exit(0)})"]}};fs.writeFileSync(f,JSON.stringify(c,null,2))'
relay ask --provider claude --measure "summarize"
relay savings --input-cost-per-million 3 --cached-input-cost-per-million 0.3 --output-cost-per-million 15
```
