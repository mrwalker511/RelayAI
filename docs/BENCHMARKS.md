# Benchmarks

First recorded benchmark results for Relay, produced with the repository's own
tooling on 2026-07-16. Two tiers: a **synthetic** benchmark anyone can re-run in
seconds with no API key, and a **live measured** run against a real provider
with real billed token counts.

Target repository for both tiers: RelayAI itself at commit `a1d7850`
(107 tracked source files, ~148,600 tokens when naively concatenated).
Prompts: the five fixed prompts from [`bench-prompts.md`](bench-prompts.md).

---

## Headline results

| Metric | Result |
| --- | --- |
| Measured cache hit rate (live provider, 7 calls) | **89.3%** |
| Measured cost vs the same calls uncached | **$1.46 vs $5.34 — 72.7% saved** |
| Prefix-hash stability across all bench turns | **100%** (both tiers) |
| Synthetic 5-turn session vs naive baseline | **97.4–99.5% fewer effective input tokens** |

---

## Tier 1 — Synthetic (no API key, reproducible)

Runs the five bench prompts through Relay's payload assembly and models a
five-turn session. The baseline is the naive strategy: concatenate every
tracked source file into every call and pay full input price each time.
Relay pays full price on turn 1, then the cache-eligible prefix
(`STATIC_BLOCK` + `STATE_LAYER`) at 0.1× (Anthropic's cache-read ratio) on
turns 2–5, with only `DYNAMIC_INPUT` at full price.

```bash
pnpm build
relay init && relay session start
pnpm sigmap        # optional: structural snapshot for the static zone
pnpm run bench
```

### Mode A — hierarchical context (`context.hierarchical: true`)

Trunk summary in `STATIC_BLOCK`; prompt-selected domain branches ride in
`DYNAMIC_INPUT` so they never bust the prefix.

| Turn | STATIC | STATE | DYNAMIC | Relay total | Baseline |
| --- | --- | --- | --- | --- | --- |
| 1 | 435 | 1,022 | 37 | 1,494 | 148,588 |
| 2 | 435 | 1,022 | 44 | 1,501 | 148,595 |
| 3 | 435 | 1,022 | 45 | 1,502 | 148,596 |
| 4 | 435 | 1,022 | 41 | 1,498 | 148,592 |
| 5 | 435 | 1,022 | 1,482 | 2,939 | 148,596 |

Prefix stable across all 5 turns: **yes**.
Five-turn session: baseline **742,967** vs Relay **3,689** effective
full-price tokens — **99.5% less**.

### Mode B — sigmap snapshot (`context.hierarchical: false` + `pnpm sigmap`)

The full structural signature map (33 modules, ~50 KB) sits in
`STATIC_BLOCK`, giving the model deep codebase context that is paid for
once and then read from cache.

| Turn | STATIC | STATE | DYNAMIC | Relay total | Baseline |
| --- | --- | --- | --- | --- | --- |
| 1 | 12,849 | 1,022 | 37 | 13,908 | 148,588 |
| 2 | 12,849 | 1,022 | 44 | 13,915 | 148,595 |
| 3 | 12,849 | 1,022 | 45 | 13,916 | 148,596 |
| 4 | 12,849 | 1,022 | 41 | 13,912 | 148,592 |
| 5 | 12,849 | 1,022 | 45 | 13,916 | 148,596 |

Prefix stable across all 5 turns: **yes**.
Five-turn session: baseline **742,967** vs Relay **19,631** effective
full-price tokens — **97.4% less**.

---

## Tier 2 — Live measured (real provider, real billed tokens)

The flow from the [testing plan](TESTING_PLAN.md): a Relay session in Mode B
(12,849-token stable static block), one warm-up call plus the five bench
prompts sent through `relay ask --provider claude --measure`, usage captured
from the provider's JSON envelope into the audit ledger, then read back with
`relay savings` at Claude Sonnet pricing ($3/M input, $0.30/M cache read,
$15/M output).

Provider: Claude Code CLI in headless mode (agentic — the model reads files
with tools, so each turn makes several API iterations; every iteration
re-reads the conversation prefix, which is exactly where a stable cached
prefix pays off).

```text
MEASURED (from recorded provider usage)
  calls with usage:     7
  cache hit rate:       89.3%
  input / cache-read:   301 / 1,486,755 tokens
  cache-write / output: 177,600 / 23,032 tokens

  cost breakdown:
    uncached input:     $0.0009
    cache reads:        $0.4460
    cache writes:       $0.6660
    output:             $0.3455
    actual total:       $1.4584
    baseline (no cache):$5.3394
    saved:              $3.8810  (72.7%)

PROJECTED FROM HISTORY (Relay zone estimator)
  prefix-stability:     100.0% over 7 ask(s)
  avg zones (S/St/D):  12849 / 1003 / 39 tokens
```

**Reading the numbers:** across the session the provider billed 1.49M tokens
as cache reads at 0.1× price and only 301 tokens as full-price input — an
89.3% hit rate. The identical work with caching disabled would have cost
$5.34; it actually cost $1.46. Relay's contribution is the 100% prefix
stability: the payload never changed shape between calls, so nothing Relay
composed ever invalidated the cache.

---

## Caveats — read before quoting

- **The synthetic baseline is deliberately naive.** Real coding agents don't
  concatenate the whole repo; they read files selectively. The synthetic
  comparison isolates what Relay's *assembly strategy* saves versus
  brute-force context stuffing, not versus a tuned agent.
- **The measured run includes provider overhead.** The Claude Code CLI adds
  its own system prompt and tool definitions to every call; those tokens are
  in the measured totals (and also benefit from the stable prefix). The
  measured 72.7% is savings from caching on the session as a whole, with
  Relay keeping its share of the prefix 100% stable.
- **Token counts are estimator-based in Tier 1** (js-tiktoken via
  `estimateTokens`); provider tokenizers will differ by a few percent.
- **Single repository, single session.** These are first numbers, not a
  study: one target repo (~4,500 LOC), five fixed prompts, one live session.
  Re-run `pnpm run bench` on your own repos — results scale with repo size.
