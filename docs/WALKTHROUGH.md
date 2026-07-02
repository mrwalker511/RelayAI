# Walkthrough: see RelayAI's savings for yourself

This guide takes you from a clean checkout to **measured** token savings against
the real [OpenAI Codex](https://github.com/openai/codex) CLI, using the bundled
[`examples/sample-project`](../examples/sample-project).

- **Fastest path:** [one command](#the-fast-path-one-command).
- **Understand each step:** [manual walkthrough](#the-manual-walkthrough).
- **Route to Copilot:** [the unmeasured provider](#routing-to-github-copilot).

> The token/cost numbers shown below are **illustrative** — they come from a
> representative Codex run. Your exact figures will differ, but the mechanics
> (a stable cached prefix, cached input growing across repeat calls) are the same.

---

## Prerequisites

- Node.js 20+, pnpm 9+, git
- From the repo root: `pnpm install && pnpm build`
- The [`codex`](https://github.com/openai/codex) CLI on your PATH, authenticated
  with `codex login`. The steps below make **real** Codex calls (network +
  tokens against your account).

---

## The fast path (one command)

```bash
./examples/sample-project/try-relay.sh
```

It checks that `codex` is installed, copies the sample project into a throwaway
git repo, wires up Codex as the measured provider, and runs the whole flow. As
Codex's prompt cache warms across calls you'll watch `cached_input_tokens` climb,
then see `relay savings` total up the real provider usage. Skip to
[reading the savings output](#step-5-read-the-measured-savings) for what the
numbers mean.

---

## The manual walkthrough

Run these yourself to understand each piece. We'll use the built CLI directly so
no global install is needed. From the repo root:

```bash
# A throwaway copy of the sample project as its own git repo
WORK="$(mktemp -d)"
cp -r examples/sample-project/. "$WORK"/
rm -f "$WORK"/try-relay.sh
cd "$WORK"
git init -q && git add -A && git commit -qm "init task-tracker"

# Point `relay` at the freshly built CLI
relay() { node "$OLDPWD/packages/cli/dist/index.js" "$@"; }
```

### Step 1: initialize Relay and install the Codex config

```bash
relay init
cp relay.config.json .relay/config.json   # pre-wired to Codex (measured) + Copilot
relay session start
```

`relay session start` anchors context to the current git SHA and records the
deterministic prefix hashes. Everything after this is a *diff since that base*,
not the whole repo.

### Step 2: see the three zones

```bash
relay cache inspect --input-cost-per-million 3 --cached-input-cost-per-million 0.3
```

```jsonc
"zones": { "static_block": 83, "state_layer": 120, "dynamic_input": 145, "total": 348 }
```

`static_block` + `state_layer` are the **stable, cacheable prefix**;
`dynamic_input` is the volatile tail (your prompt + the git diff). The stable
zones come first so a provider cache can reuse them across calls.

### Step 3: ask Codex, capturing real usage

```bash
relay ask --provider codex --measure "Explain how the priority sort works."
relay ask --provider codex --measure "Add a dueDate field to the Task type."
relay ask --provider codex --measure "Write a test for TaskStore.complete()."
```

`--measure` rewrites the command to `codex exec --json -`, tees Codex's output
(you still see it), and parses the final `turn.completed` event into the audit
ledger. Codex reports `input_tokens` **inclusive** of `cached_input_tokens`, so
Relay normalizes the *uncached* input as `input - cached` before recording it.
As the cached prefix is reused, the **first** call writes Codex's cache and later
calls read it back — `cached_input_tokens` grows accordingly.

### Step 4: inspect the per-call ledger

```bash
relay audit --event ask --tail 3
```

Each `ask` now records `prefix_hash`, per-zone token counts, the `tokenizer`
used, `prefix_stable` (did the cached prefix match the previous call), and the
measured `usage_*` tokens. Note `prefix_stable` is `false` on call 1 and `true`
afterward — that's the deterministic, *measured* cache-eligibility signal.

### Step 5: read the measured savings

```bash
relay savings --input-cost-per-million 3 --cached-input-cost-per-million 0.3 --output-cost-per-million 15
```

```text
MEASURED (from recorded provider/manual usage)
  calls with usage:    3
  input / cache-read:  945 / 48896 tokens
  cache-write / output:0 / 244 tokens
  actual vs baseline:  $0.0186 vs $0.1495
  saved:               $0.1309  (aggregate over the run is the honest figure)

PROJECTED FROM HISTORY (measured prefix-stability rate × zone estimator)
  prefix-stability:    100.0% over 3 ask(s)
  avg zones (S/St/D):  83 / 120 / 152 tokens
  projected/call saved:$0.0005  (PROJECTION, not measured)
```

> These figures are **illustrative** of a representative Codex run — your numbers
> will vary with prompt size, the model, and how much of the prefix Codex caches.

What the two sections mean:

- **MEASURED** is real: actual cost (Codex's cached input is billed cheap, output
  included) vs. a no-cache baseline where every input token is billed full price.
  The win grows with every repeat call as more of the prefix is served from
  cache, which is why the **aggregate** is the honest number. (Codex has no
  separate cache-*write* surcharge in its usage, so `cache-write` reads as 0.)
- **PROJECTED FROM HISTORY** feeds your **measured** prefix-stability rate (here
  100%) into the zone estimator. It's a projection, not a measurement — clearly
  labeled as such.

> The dollar figures here are tiny because the sample project is tiny. On a real
> codebase the cacheable prefix is far larger, so the same mechanics produce much
> bigger savings — see the estimate below.

### Step 6 (optional): estimated comparison vs. a naive file dump

From the **RelayAI repo root** (this tool resolves the workspace package, so run
it there):

```bash
pnpm run compare -- --prompt "Explain the priority sort"
```

It prints first-call (cold cache) **and** amortized repeat-call (warm cache) size
versus naively dumping every file into the prompt. On the RelayAI repo itself
that's roughly **−92% first call, −98% on cached repeats**.

---

## Routing to GitHub Copilot

The sample config also wires up GitHub Copilot as a routable provider:

```jsonc
"commands": { "copilot": ["copilot", "-p", "{prompt}"] }
```

The `{prompt}` placeholder tells Relay to deliver the assembled payload as the
`-p` **argument** (Copilot doesn't read the prompt from stdin). Route to it with:

```bash
relay ask --provider copilot "Explain how the priority sort works."
```

Copilot exposes token usage only via OpenTelemetry, not on stdout, so it
**cannot** be auto-measured. If you want measured savings through Copilot,
capture the numbers from your telemetry and record them manually:

```bash
relay usage record --input 1200 --cached-input 8000 --cache-creation 300 --output 450
```

`relay savings` includes both provider-measured (Codex) and manually recorded usage.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `codex: command not found` | Install the Codex CLI (`npm i -g @openai/codex`) and run `codex login`. The demo's preflight checks for this. |
| `relay: command not found` | Use the built CLI: `node packages/cli/dist/index.js …`, or define the `relay()` shell function shown above. |
| `--measure: could not parse provider usage` | The provider didn't emit a usage envelope on stdout. Use the `codex` (or `claude`) builtin, or record usage with `relay usage record`. Copilot can't be auto-measured. |
| `savings` shows no MEASURED section | No usage recorded yet — run `relay ask --provider codex --measure` or `relay usage record` first. |
| `compare` errors on `@relay-cache/core` | Run it from the RelayAI repo root, not from the sample copy. |

See also: [`COMMANDS.md`](COMMANDS.md) · [`GETTING_STARTED.md`](GETTING_STARTED.md) · [`TESTING_PLAN.md`](TESTING_PLAN.md)
