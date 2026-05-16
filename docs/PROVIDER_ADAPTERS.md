# Provider Adapters

Relay should integrate with existing coding assistants without replacing them.

## Design Principle

Provider adapters should be small wrappers around external commands or raw APIs.

Relay owns:

- context construction
- token budgeting
- semantic state
- git delta prompting
- cache diagnostics

Providers own:

- model execution
- code generation
- tool usage
- provider-specific authentication

## Adapter Interface

```ts
export interface ProviderAdapter {
  name: string;
  sendPrompt(payload: string): Promise<number>;
}
```

## Initial Providers

### Codex CLI

Expected usage:

```bash
relay ask --provider codex "Fix the failing test"
```

### Claude Code

Expected usage:

```bash
relay ask --provider claude "Refactor this module"
```

### GitHub Copilot CLI

Expected usage:

```bash
relay ask --provider copilot "Explain this error"
```

## No Automated Model Switching

Relay should not silently switch models or providers to optimize cost. That would undermine developer predictability.

Instead, Relay should reduce token consumption by:

- deterministic prefix pinning
- prompt-cache optimization
- context compaction
- git deltas
- local budget enforcement
