# Walkthrough: see RelayAI's savings for yourself

This guide takes you from a clean checkout to **measured** token savings in a few
minutes — with **no API key and no network**, using the bundled
[`examples/sample-project`](../examples/sample-project) and a mock provider.

- **Fastest path:** [one command](#the-fast-path-one-command).
- **Understand each step:** [manual walkthrough](#the-manual-walkthrough).
- **Use a real provider:** [swap in your model CLI](#using-a-real-provider).

---

## Prerequisites

- Node.js 20+, pnpm 9+, git
- From the repo root: `pnpm install && pnpm build`

---

## The fast path (one command)

```bash
./examples/sample-project/try-relay.sh
```

It copies the sample project into a throwaway git repo, wires up the mock
provider, and runs the whole flow. You'll watch the first call **write** the
cache and later calls **read** it, then see `relay savings` total up the real
provider usage. Skip to [reading the savings output](#step-5-read-the-measured-savings)
for what the numbers mean.

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

### Step 1: initialize Relay and install the mock-provider config

```bash
relay init
cp relay.config.json .relay/config.json   # pre-wired to the mock provider
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

### Step 3: ask through the mock provider, capturing real usage

```bash
relay ask --provider mock --measure "Explain how the priority sort works."
relay ask --provider mock --measure "Add a dueDate field to the Task type."
relay ask --provider mock --measure "Write a test for TaskStore.complete()."
```

Watch the mock's stderr: the **first** call is `cache MISS — writing cache`, the
next two are `cache HIT — reading cached prefix`. `--measure` tees the provider's
output (you still see it) and parses the usage envelope into the audit ledger.

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
  input / cache-read:  156 / 596 tokens
  cache-write / output:297 / 660 tokens
  actual vs baseline:  $0.0117 vs $0.0130
  saved:               $0.0014  (negative on a first/cache-creating call is expected; aggregate is the honest figure)

PROJECTED FROM HISTORY (measured prefix-stability rate × zone estimator)
  prefix-stability:    100.0% over 3 ask(s)
  avg zones (S/St/D):  83 / 120 / 152 tokens
  projected/call saved:$0.0005  (PROJECTION, not measured)
```

What the two sections mean:

- **MEASURED** is real: actual cost (cache reads are cheap, the one-time cache
  *write* carries a 1.25× surcharge, output included) vs. a no-cache baseline
  where every input token is billed full price. The win grows with every repeat
  call — a single first call can even be negative, which is why the **aggregate**
  is the honest number.
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

## Using a real provider

Swap the mock for any model CLI in `.relay/config.json`:

```jsonc
"provider": { "default": "claude", "commands": { "claude": ["claude"] } }
```

Then `relay ask --provider claude --measure "…"`. For the `claude` builtin,
`--measure` auto-adds `--output-format json` so usage is captured automatically.
For providers that don't emit a parseable usage envelope, capture the numbers
from their output and record them manually:

```bash
relay usage record --input 1200 --cached-input 8000 --cache-creation 300 --output 450
```

`relay savings` includes both provider-measured and manually recorded usage.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `relay: command not found` | Use the built CLI: `node packages/cli/dist/index.js …`, or define the `relay()` shell function shown above. |
| `--measure: could not parse provider usage` | The provider didn't emit a usage envelope. Use the `claude` builtin, or record usage with `relay usage record`. |
| `savings` shows no MEASURED section | No usage recorded yet — run `relay ask --measure` or `relay usage record` first. |
| `compare` errors on `@relay/core` | Run it from the RelayAI repo root, not from the sample copy. |

See also: [`COMMANDS.md`](COMMANDS.md) · [`GETTING_STARTED.md`](GETTING_STARTED.md) · [`TESTING_PLAN.md`](TESTING_PLAN.md)
