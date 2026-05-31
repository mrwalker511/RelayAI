# task-tracker — RelayAI sample project

A tiny in-memory task tracker used to try **RelayAI** end to end. It exists so
you have a small-but-real codebase (a few TypeScript modules with structure and
git history) to point RelayAI at.

## One-command demo (real OpenAI Codex)

From the **RelayAI repo root**:

```bash
./examples/sample-project/try-relay.sh
```

> **Requires** the [`codex`](https://github.com/openai/codex) CLI on your PATH
> and an authenticated session (`codex login`). The demo makes **real** Codex
> calls (network + tokens against your account).

This copies the project into a throwaway git repo, wires up **Codex** as the
measured provider, and runs the full flow so you can watch measured token
savings build up:

1. `relay cache inspect` — shows the three prompt zones (stable prefix first).
2. `relay ask --provider codex --measure` ×3 — runs `codex exec --json -` and
   parses each `turn.completed` usage event; as Codex's prompt cache warms,
   `cached_input_tokens` climbs across calls.
3. `relay savings` — aggregates the **real** provider usage into dollars saved.
4. `relay audit --event ask` — the per-call ledger Relay recorded.

For the step-by-step manual version (and what each number means), see
[`docs/WALKTHROUGH.md`](../../docs/WALKTHROUGH.md).

## What's in here

| File | Purpose |
|---|---|
| `src/` | The sample library: `types.ts`, `priority.ts`, `task-store.ts`, `index.ts` |
| `relay.config.json` | Relay config pre-wired to Codex (measured) and Copilot (routable) — copy to `.relay/config.json` |
| `try-relay.sh` | The one-command demo above |

## Providers

- **OpenAI Codex (measured).** Configured as `["codex", "exec", "-"]` — Relay
  pipes the assembled prompt to Codex on **stdin**. With `--measure`, Relay runs
  `codex exec --json -` and reads usage from the final `turn.completed` event.
  Codex reports `input_tokens` **inclusive** of `cached_input_tokens`, so Relay
  normalizes uncached input as `input - cached` for accurate accounting.
- **GitHub Copilot (routable, not measured).** Configured as
  `["copilot", "-p", "{prompt}"]` — Relay substitutes the assembled prompt into
  the `{prompt}` argv placeholder (no shell, so it's injection-safe). Copilot
  exposes token usage only via OpenTelemetry, not stdout, so it can't be
  auto-measured; route to it with `relay ask --provider copilot "…"`.

To use a different provider, edit `.relay/config.json` and point
`provider.commands.<name>` at your model CLI. The `{prompt}` placeholder selects
argument delivery; omit it to deliver the prompt on stdin. For `--measure`, the
`claude` builtin auto-adds `--output-format json` and `codex` auto-adds `--json`.
