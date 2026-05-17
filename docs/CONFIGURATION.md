# Configuration

Relay stores local configuration in:

```txt
.relay/config.json
```

## Default Configuration

```json
{
  "provider": {
    "default": "default"
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
    "provider": "generic",
    "model": "default",
    "hardLimit": 100000,
    "warningLimit": 50000,
    "requireConfirmationAbove": 75000
  }
}
```

## Provider Strategy

Relay is model-agnostic. Provider commands are configured as shell command templates, and Relay passes the assembled payload on stdin.

Provider command override example:

```json
{
  "provider": {
    "default": "local-llm",
    "commands": {
      "local-llm": ["your-llm-cli"]
    }
  },
  "gc": {
    "command": ["your-llm-cli"]
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
