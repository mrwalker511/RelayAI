# Configuration

Relay stores local configuration in `.relay/config.json`, created by `relay init`. The file is validated with Zod at load time. Invalid configs surface as errors — Relay does not silently fall back to defaults.

Run `relay doctor` at any time to validate config shape, token budget ordering, and provider/GC command availability.

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
| `commands` | `{ [name]: string[] }` | `{}` | Shell command arrays for named providers. Relay writes the prompt payload to the process stdin. |

Provider commands are arrays of arguments, not shell strings. Relay does not invoke a shell; it spawns the process directly.

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
