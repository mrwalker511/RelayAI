# task-tracker — RelayAI sample project

A tiny in-memory task tracker used to try **RelayAI** end to end. It exists so
you have a small-but-real codebase (a few TypeScript modules with structure and
git history) to point RelayAI at.

## One-command demo (no API key, no network)

From the **RelayAI repo root**:

```bash
./examples/sample-project/try-relay.sh
```

This copies the project into a throwaway git repo, wires up a **mock provider**,
and runs the full flow so you can watch measured token savings build up:

1. `relay cache inspect` — shows the three prompt zones (stable prefix first).
2. `relay ask --provider mock --measure` ×3 — the first call writes the cache
   (a MISS), the next two read it (HITs).
3. `relay savings` — aggregates the **real** provider usage into dollars saved.
4. `relay audit --event ask` — the per-call ledger Relay recorded.

For the step-by-step manual version (and what each number means), see
[`docs/WALKTHROUGH.md`](../../docs/WALKTHROUGH.md).

## What's in here

| File | Purpose |
|---|---|
| `src/` | The sample library: `types.ts`, `priority.ts`, `task-store.ts`, `index.ts` |
| `relay.config.json` | Relay config pre-wired to the mock provider — copy to `.relay/config.json` |
| `mock-provider.js` | Fake LLM that emits Claude-style usage envelopes and simulates a prompt cache |
| `try-relay.sh` | The one-command demo above |

## The mock provider

`mock-provider.js` ignores the prompt's meaning and prints a Claude
`--output-format json` usage envelope on stdout. It tracks a marker file so the
**first** call reports `cache_creation_input_tokens` (writing the cache) and
later calls report `cache_read_input_tokens` (reading it) — exactly the pattern
RelayAI is built to exploit. That makes the measured-savings numbers honest:
the first call costs a little more, every call after is much cheaper.

To use a **real** provider instead, edit `.relay/config.json` and point
`provider.commands.<name>` at your model CLI (e.g. `["claude"]`). For the
`claude` builtin, `relay ask --measure` auto-adds `--output-format json`.
