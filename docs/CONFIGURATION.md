# Configuration

Relay stores local configuration in:

```txt
.relay/config.json
```

## Default Configuration

```json
{
  "provider": {
    "default": "codex"
  },
  "gc": {
    "enabled": true,
    "historyTokenLimit": 12000,
    "targetSummaryTokens": 500,
    "preserveErrors": true,
    "preserveDecisions": true,
    "preserveCodeChanges": true
  },
  "tokens": {
    "provider": "openai",
    "model": "gpt-4.1",
    "hardLimit": 100000,
    "warningLimit": 50000,
    "requireConfirmationAbove": 75000
  }
}
```

## Provider Strategy

Relay should not automatically switch providers. The user should choose a provider explicitly or rely on the configured default.

Future provider config example:

```json
{
  "providers": {
    "codex": {
      "command": "codex",
      "args": ["-"]
    },
    "claude": {
      "command": "claude",
      "args": []
    }
  }
}
```

## Cache Stability Rules

Avoid adding these to static or state zones unless absolutely necessary:

- timestamps
- terminal logs
- absolute temporary paths
- random IDs
- unbounded raw history
- frequently changing diffs

Put volatile material in the dynamic zone.
