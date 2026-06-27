# Command Reference

## `relay init`

Initializes `.relay/` in the current repository, creating `config.json` and the `memory/` directory with default files.

---

## `relay doctor`

Checks whether the current workspace is ready for Relay usage. Prints JSON diagnostics and exits non-zero only when a blocking error is present.

Doctor checks include:
- Git availability
- `.relay/` initialization
- Config and session validity
- Semantic state validity
- Token budget ordering (`warningLimit < requireConfirmationAbove < hardLimit`)
- Provider and GC command availability

---

## `relay session start`

Creates a session anchored to the current git SHA. Records the session ID, base SHA, prefix hash, tracked paths, and creation timestamp in `.relay/session.json`.

Start a new session when beginning a distinct task or after rebasing.

## `relay session status`

Prints current session metadata from `.relay/session.json`.

---

## `relay ask <prompt>`

Builds a deterministic three-zone prompt payload.

Without a provider, Relay prints the assembled payload between `---BEGIN RELAY PAYLOAD---` and `---END RELAY PAYLOAD---`.

**Options:**

| Flag | Description |
| --- | --- |
| `--provider <name>` | Route the payload to the named provider command and propagate the exit code. The payload is written to stdin, or substituted into a `{prompt}` argv placeholder if the command template uses one. |
| `--dry-run` | Print the resolved provider command and payload without executing the provider. |
| `--staged` | Use staged diff instead of the full session diff. |
| `--diff-mode <mode>` | Diff rendering: `full`, `summarized`, or `auto` (default). `auto` summarizes diffs above 8 000 tokens. |
| `--include-timestamp` | Include ISO timestamp in the `DYNAMIC_INPUT` zone. |
| `--measure` | Capture the provider's reported token usage into the audit ledger for **measured** savings. Tees provider stdout (you still see it) and parses usage; the `claude` builtin auto-adds `--output-format json` and the `codex` builtin auto-adds `--json`. Codex reports `input_tokens` inclusive of cached, which Relay normalizes to uncached input. Providers that don't emit parseable usage (e.g. Copilot): record it with `relay usage record`. |

Every `relay ask` also writes per-call ledger fields to the audit log — `prefix_hash`, per-zone token counts, the `tokenizer` used, and `prefix_stable` (whether the cacheable prefix matched the previous call). These power `relay savings`.

---

## `relay usage record`

Manually record measured provider token usage (for providers whose CLI doesn't emit a parseable usage envelope).

**Options:** `--input <n>` (required), `--cached-input <n>`, `--cache-creation <n>`, `--output <n>`, `--session <id>`. Appends a `usage` audit event with `usage_source: "manual"`.

---

## `relay savings`

Reports prompt-cache savings from the audit log in two clearly-labeled sections:

- **MEASURED** — actual cost vs a no-cache baseline, computed from recorded provider/manual usage (includes the cache-creation surcharge and output). A single first/cache-creating call can show negative savings; the session aggregate is the honest figure.
- **PROJECTED FROM HISTORY** — the **measured** prefix-stability rate (fraction of repeat calls whose cacheable prefix was unchanged) fed into the zone estimator. A projection, not a measurement.

**Options:** `--input-cost-per-million <n>`, `--cached-input-cost-per-million <n>`, `--cache-creation-cost-per-million <n>` (default: input × 1.25), `--output-cost-per-million <n>` (default: 0), `--session <id>`, `--json`.

---

## `relay diff`

Prints the git diff since the current session base SHA.

---

## `relay context inspect`

Prints context-construction diagnostics, including session metadata, prefix hash comparison, zone token counts, semantic state validity, and git diff presence.

## `relay context build`

Scaffolds hierarchical context files at `.relay/context/` by parsing `docs/ARCHITECTURE.md` and `AGENTS.md`. Generates:

- `.relay/context/trunk.md` — slim project overview (~300 tokens, always loaded)
- `.relay/context/branches/{domain}.md` — domain-specific details (lazy-loaded when prompt/diff matches)

After running, enable with `"context": { "hierarchical": true }` in `.relay/config.json`.

---

## `relay tokens estimate [text...]`

Estimates the token count for the provided text using the configured tokenizer.

## `relay tokens budget`

Prints the current token budget configuration (`warningLimit`, `requireConfirmationAbove`, `hardLimit`).

## `relay tokens inspect`

Prints zone-by-zone token counts for the current session context and reports the configured budget status (`ok`, `warning`, `requires_confirmation`, or `blocked`).

---

## `relay cache fingerprint`

Prints the hash of the combined static block and state layer. Use this to detect prefix drift between sessions.

## `relay cache inspect`

Prints cache-relevant prefix diagnostics: prefix hash, static and state zone token counts, and the inputs that affect the prefix.

**Options:**

| Flag | Description |
| --- | --- |
| `--input-cost-per-million <number>` | Per-million-token cost for uncached input (e.g. `3.00`) |
| `--cached-input-cost-per-million <number>` | Per-million-token cost for cached input (e.g. `0.30`) |
| `--expected-cache-hit-rate <number>` | Expected cache hit rate as a decimal (e.g. `0.8` for 80%) — a guess |
| `--use-recorded-history` | Use the **measured** prefix-stability rate from the audit log instead of guessing `--expected-cache-hit-rate`. The output reports `recorded_stability_rate` and `cache_hit_rate_source`. |

Relay only calculates cost estimates from explicit inputs and does not infer provider pricing. For ground-truth numbers, prefer `relay ask --measure` + `relay savings`.

## `relay cache warm`

Sends a stable prefix-shaped payload to a configured provider to prime provider-side prompt caching.

**Options:**

| Flag | Description |
| --- | --- |
| `--provider <name>` | Provider command to use for warming. |
| `--dry-run` | Print the resolved command and warmup payload without executing the provider. |

---

## `relay gc status`

Prints the current garbage collection configuration from `.relay/config.json`.

## `relay gc preview`

Previews the compacted semantic state without writing changes. Useful for checking what GC would produce before committing.

## `relay gc run`

Compacts raw session history into semantic state. Sends a schema-constrained prompt to `gc.command`, or to the configured default provider when `gc.command` is omitted.

Writes `.relay/memory/semantic-state.json`, clears raw history, and saves a snapshot for rollback.

## `relay gc restore`

Restores the semantic state snapshot written before the last `relay gc run`.

---

## `relay mcp`

Runs Relay as a read-only MCP context server over stdio.

Configure an MCP-compatible coding agent to launch this command. Relay exposes project context, git delta, semantic memory, token budget, and prompt payload as MCP tools without mutating `.relay/` state.

See [`docs/MCP.md`](MCP.md) for setup instructions and the full tool contract.

---

## `relay completion <shell>`

Prints a shell completion script for `bash`, `zsh`, or `fish` to stdout.

Source it directly in your current shell:

```bash
source <(relay completion bash)   # bash
source <(relay completion zsh)    # zsh
relay completion fish | source    # fish
```

To make it permanent, add the source line to your shell profile (`.bashrc`, `.zshrc`, or `~/.config/fish/config.fish`). The command prints installation instructions to stderr on first use.

---

## `pnpm sigmap`

_(Root workspace script, not a relay CLI command)_

Generates `.relay/sigmap.md` — a structural skeleton of the codebase using TypeScript's compiler API. Extracts interfaces, type aliases, enums, and function signatures while stripping implementation bodies. Token cost is ~10–15% of full source.

Relay automatically uses this file as `sourceSnapshot` when `.relay/memory/source-snapshot.md` is absent or contains the default placeholder.
