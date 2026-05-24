# Provider Adapters

Relay integrates with model and coding-agent CLIs without replacing them. A provider adapter is a small wrapper around a configured shell command. Relay assembles the prompt payload and writes it to the provider process on stdin; the provider owns model execution, code generation, and authentication.

---

## Design Principle

Relay owns:

- Context construction (three-zone payload)
- Token budgeting and guardrails
- Semantic state and garbage collection
- Git delta prompting
- Cache diagnostics and fingerprinting

Providers own:

- Model execution
- Code generation and tool use
- Provider-specific authentication and rate limiting

Relay does not switch providers silently to optimize cost. That would undermine predictability. Instead, Relay reduces token consumption through deterministic prefix pinning, context compaction, git deltas, and local budget enforcement.

---

## Adapter Interface

```ts
export interface ProviderAdapter {
  name: string;
  sendPrompt(payload: string): Promise<number>;
}
```

`ShellProvider` implements this interface by spawning the configured command array and writing the assembled payload to stdin. The provider's exit code is propagated back to the caller.

---

## Configuring Providers

Provider commands are defined in `.relay/config.json` as arrays of command arguments. Relay spawns the process directly — no shell interpolation.

```json
{
  "provider": {
    "default": "my-provider",
    "commands": {
      "my-provider": ["command", "arg1", "arg2"]
    }
  }
}
```

Send a prompt to the default provider:

```bash
relay ask "Explain the active diff" --provider default
```

Send to a named provider:

```bash
relay ask "Write tests for the changed files" --provider my-provider
```

Inspect the resolved command without executing it:

```bash
relay ask "Review this change" --provider default --dry-run
```

---

## Examples

### Claude CLI

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

The `claude` CLI reads the prompt from stdin and responds in the terminal. The `--dangerously-skip-permissions` flag allows Claude to run tools without interactive confirmation — appropriate for scripted use where you control the prompt.

### Ollama (local model)

```json
{
  "provider": {
    "default": "ollama",
    "commands": {
      "ollama": ["ollama", "run", "mistral"]
    }
  },
  "gc": {
    "command": ["ollama", "run", "mistral"],
    "historyTokenLimit": 8000,
    "targetSummaryTokens": 400
  },
  "tokens": {
    "provider": "ollama",
    "model": "mistral"
  }
}
```

Ollama reads from stdin when piped. This config also uses Ollama for garbage collection to keep all inference local.

### Ollama with a larger model

```json
{
  "provider": {
    "default": "ollama-large",
    "commands": {
      "ollama-large": ["ollama", "run", "llama3.3"],
      "ollama-fast": ["ollama", "run", "llama3.2"]
    }
  },
  "routing": {
    "gc": "ollama-fast"
  },
  "tokens": {
    "provider": "ollama",
    "model": "llama3.3"
  }
}
```

### Custom shell script

Any executable that reads stdin works as a provider:

```json
{
  "provider": {
    "default": "my-script",
    "commands": {
      "my-script": ["/path/to/my-llm-wrapper.sh"]
    }
  }
}
```

The script receives the full assembled Relay payload on stdin. It should write its response to stdout and exit with code 0 on success.

### Multi-provider setup

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
  }
}
```

This routes regular prompts to Claude but uses a local Ollama model for garbage collection, reducing cost for the frequent compaction operation.

---

## No Automated Model Switching

Relay never silently switches models or providers to optimize cost. All routing decisions are explicit in `.relay/config.json`. This keeps prompt behavior predictable and ensures token budget estimates reflect the actual provider being used.

To inspect the current routing before executing:

```bash
relay ask "test prompt" --provider default --dry-run
relay doctor
```
