# Configuration

Relay stores local configuration in `.relay/config.json`, created by `relay init`. The file is validated with Zod at load time. Invalid configs surface as errors — Relay does not silently fall back to defaults.

Run `relay doctor` at any time to validate config shape, token budget ordering, and provider/GC command availability.

---

## Team / Shared Base Configuration

Set the `RELAY_BASE_CONFIG` environment variable to a file path containing a shared base config. Relay deep-merges it with the local `.relay/config.json`, with local values winning on any conflict.

```bash
# In your shell profile or CI environment
export RELAY_BASE_CONFIG=/path/to/team/relay-base.json
```

**Merge rules:**
- Nested objects are merged (local keys override base keys, base keys not present locally are preserved)
- Arrays are replaced entirely by local values (not concatenated)
- Missing keys in local config inherit from the base config

**Example:** A team-shared base config at `~/dotfiles/relay-base.json`:
```json
{
  "tokens": {
    "provider": "anthropic",
    "model": "claude-sonnet-4",
    "hardLimit": 170000
  },
  "gc": {
    "command": ["claude", "-p", "--output-format", "text"]
  },
  "audit": {
    "enabled": true,
    "maxLines": 50000
  }
}
```

Individual developers can still override specific values in their `.relay/config.json` without needing to repeat the full team config.

If `RELAY_BASE_CONFIG` points to a missing file, Relay logs a warning and continues with the local config only.

---

## Default Configuration

This is what `relay init` writes:

```json
{
  "provider": {
    "default": "default"
  },
  "routing": {},
  "gc": {
    "enabled": true,
    "historyTokenLimit": 12000,
    "targetSummaryTokens": 500,
    "preserveErrors": true,
    "preserveDecisions": true,
    "preserveCodeChanges": true
  },
  "tokens": {
    "provider": "generic",
    "model": "default",
    "hardLimit": 100000,
    "warningLimit": 50000,
    "requireConfirmationAbove": 75000
  },
  "files": {
    "maxIndex": 200
  },
  "context": {
    "hierarchical": false,
    "contextDir": ".relay/context",
    "maxBranches": 3
  },
  "filter": {
    "enabled": true,
    "maxLines": 300,
    "maxSuccessOccurrences": 3,
    "dedupConsecutive": true,
    "collapseBlankLines": true
  }
}
```

---

## Full Schema Reference

### `provider`

Controls which provider commands Relay uses when routing prompts.

```json
"provider": {
  "default": "my-agent",
  "commands": {
    "my-agent": ["claude", "--dangerously-skip-permissions"],
    "local-llm": ["ollama", "run", "mistral"]
  }
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `default` | string | `"default"` | Name of the provider used when `--provider` is omitted |
| `commands` | `{ [name]: string[] }` | `{}` | Shell command arrays for named providers. By default Relay writes the prompt payload to the process stdin. |

Provider commands are arrays of arguments, not shell strings. Relay does not invoke a shell; it spawns the process directly.

**Prompt delivery.** By default the assembled payload is written to the provider's stdin. If any element of the command array contains the literal token `{prompt}`, Relay instead substitutes the payload into those elements and leaves stdin empty — use this for CLIs that take the prompt as an argument. Substitution happens after the array is spawned directly (no shell), so the prompt is injection-safe regardless of its contents.

```json
"commands": {
  "codex": ["codex", "exec", "-"],
  "copilot": ["copilot", "-p", "{prompt}"]
}
```

---

### `routing`

Optional per-command provider overrides. When set, the named command uses the specified provider instead of `provider.default`.

```json
"routing": {
  "ask": "my-agent",
  "gc": "local-llm",
  "diff": "my-agent",
  "summarize": "local-llm"
}
```

| Field | Type | Description |
| --- | --- | --- |
| `ask` | string? | Provider used for `relay ask` |
| `gc` | string? | Provider used for `relay gc run` and `relay gc preview` |
| `diff` | string? | Provider used for diff-related commands |
| `summarize` | string? | Provider used for summarization commands |

All fields are optional. Omitting a field falls back to `provider.default`.

---

### `gc`

Controls semantic memory compaction. When raw session history grows beyond `historyTokenLimit`, `relay gc run` compacts it into a structured `SemanticState`.

```json
"gc": {
  "enabled": true,
  "command": ["ollama", "run", "mistral"],
  "historyTokenLimit": 12000,
  "targetSummaryTokens": 500,
  "preserveErrors": true,
  "preserveDecisions": true,
  "preserveCodeChanges": true
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Whether GC compaction is active |
| `command` | string[]? | — | Shell command to use for GC. Omit to use `provider.default` (or `routing.gc` if set). |
| `historyTokenLimit` | number | `12000` | Token count above which compaction is recommended |
| `targetSummaryTokens` | number | `500` | Target size of the compacted semantic state |
| `preserveErrors` | boolean | `true` | Retain runtime errors in compacted state |
| `preserveDecisions` | boolean | `true` | Retain architectural decisions in compacted state |
| `preserveCodeChanges` | boolean | `true` | Retain code change records in compacted state |

---

### `tokens`

Controls local token estimation and budget enforcement. Relay estimates token counts before sending prompts and gates execution based on these thresholds.

```json
"tokens": {
  "provider": "anthropic",
  "model": "claude-sonnet-4",
  "hardLimit": 170000,
  "warningLimit": 100000,
  "requireConfirmationAbove": 140000
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `provider` | string | `"generic"` | Token estimator profile. Known values: `generic`, `anthropic`, `openai`, `ollama`, `copilot`. When a known provider + model combination is set, Relay auto-scales limits as a fraction of the model's context window. |
| `model` | string | `"default"` | Model name for context window lookup. See `packages/core/src/config/relay-config.ts` for the full list of known models. |
| `hardLimit` | number | `100000` | Blocks prompt execution above this token count |
| `warningLimit` | number | `50000` | Emits a stderr warning above this token count |
| `requireConfirmationAbove` | number | `75000` | Requires interactive confirmation above this token count |

**Budget order requirement:** `warningLimit < requireConfirmationAbove < hardLimit`. `relay doctor` flags violations.

When `provider` and `model` are set to known values, Relay auto-scales the default limits to a fraction of the model's context window: hard limit at 85%, confirmation at 70%, warning at 50%. Explicit values in config always take precedence over auto-scaling.

---

### `files`

Controls repository file indexing.

```json
"files": {
  "maxIndex": 200
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `maxIndex` | number | `200` | Maximum number of files included in the `STATE_LAYER` file index. Repositories with more tracked files will have the index truncated. |

---

### `context`

Controls hierarchical context loading — a two-tier strategy that reduces `STATIC_BLOCK` token spend by lazy-loading domain-specific context only when the prompt/diff text matches domain keywords.

```json
"context": {
  "hierarchical": true,
  "contextDir": ".relay/context",
  "maxBranches": 3
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `hierarchical` | boolean | `false` | When `true`, load `trunk.md` + matching branch files instead of the full `source-snapshot.md` |
| `contextDir` | string | `".relay/context"` | Directory containing `trunk.md` and `branches/*.md`. Resolved relative to the workspace root. |
| `maxBranches` | number | `3` | Maximum number of domain branch files to load per request |

Run `relay context build` to scaffold the context directory from `docs/ARCHITECTURE.md`. Domains: `git`, `tokens`, `memory`, `providers`, `config`, `context`.

---

### `filter`

Controls automatic output filtering applied to `runtimeOutput` before it is added to `DYNAMIC_INPUT`. Prevents noisy tool output (ANSI codes, duplicate log lines, verbose test passes) from inflating the prompt.

```json
"filter": {
  "enabled": true,
  "maxLines": 300,
  "maxSuccessOccurrences": 3,
  "dedupConsecutive": true,
  "collapseBlankLines": true
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Master switch. Set to `false` to pass `runtimeOutput` through unmodified. |
| `maxLines` | number | `300` | Maximum lines in filtered output. Overflow is handled with head-60%/tail-40% truncation and a count note. |
| `maxSuccessOccurrences` | number | `3` | Lines matching success patterns (`PASS`, `ok`, `✓`, etc.) beyond this count are suppressed with a note. Set to `0` to suppress all. |
| `dedupConsecutive` | boolean | `true` | Collapse consecutive identical lines into `[×N repeated]` annotations. |
| `collapseBlankLines` | boolean | `true` | Reduce runs of blank lines to a single blank line. |

The filter settings in config apply when callers of `buildDynamicInput()` pass `outputFilterOptions` derived from `config.filter`. ANSI stripping is always on by default regardless of config (it can be disabled per-call with `outputFilterOptions: { stripAnsi: false }`).

---

## Cache Stability Rules

To keep the `STATIC_BLOCK` and `STATE_LAYER` prefix stable across requests (so provider caches hit), avoid putting these in the stable zones:

- Timestamps
- Terminal logs or command output
- Absolute temporary paths
- Random or generated IDs
- Unbounded raw session history
- Frequently-changing diffs

All of the above belong in `DYNAMIC_INPUT`. Relay places them there automatically.

---

## Signature Map Integration

Run `pnpm sigmap` to generate `.relay/sigmap.md` — a structural skeleton of the codebase (interfaces, types, function signatures without bodies) that costs ~10–15% of the tokens of full source. Relay automatically uses it as `sourceSnapshot` when `.relay/memory/source-snapshot.md` is absent or contains the default placeholder text. Regenerate after major structural changes.

---

## Example: Minimal Provider Setup

```json
{
  "provider": {
    "default": "claude",
    "commands": {
      "claude": ["claude", "--dangerously-skip-permissions"]
    }
  },
  "gc": {
    "enabled": true
  }
}
```

With this config, `relay ask "prompt" --provider default` sends the assembled payload to Claude CLI on stdin. GC uses the same provider since no `gc.command` override is set.

---

## Example: Multi-Provider Setup

```json
{
  "provider": {
    "default": "claude",
    "commands": {
      "claude": ["claude", "--dangerously-skip-permissions"],
      "local": ["ollama", "run", "mistral"]
    }
  },
  "routing": {
    "gc": "local"
  },
  "gc": {
    "enabled": true,
    "historyTokenLimit": 8000,
    "targetSummaryTokens": 400
  },
  "tokens": {
    "provider": "anthropic",
    "model": "claude-sonnet-4"
  }
}
```

This routes most work to Claude but uses a local Ollama model for garbage collection to reduce cost.

---

## Example: Full Token Optimization Setup

```json
{
  "provider": {
    "default": "claude",
    "commands": {
      "claude": ["claude", "--dangerously-skip-permissions"]
    }
  },
  "context": {
    "hierarchical": true,
    "maxBranches": 3
  },
  "filter": {
    "enabled": true,
    "maxLines": 200,
    "maxSuccessOccurrences": 2
  },
  "tokens": {
    "provider": "anthropic",
    "model": "claude-sonnet-4"
  }
}
```

With this config:
- `STATIC_BLOCK` loads trunk + up to 3 matching domain branches instead of the full snapshot
- `runtimeOutput` in `DYNAMIC_INPUT` is filtered to 200 lines with noisy success suppression
- Token limits auto-scale to Anthropic Claude Sonnet 4 context window fractions

After setting up, run:
```bash
pnpm sigmap              # generate .relay/sigmap.md
relay context build      # scaffold .relay/context/ from docs
```
