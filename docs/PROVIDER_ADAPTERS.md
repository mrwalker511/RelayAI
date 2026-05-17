# Provider Adapters

Relay integrates with model and coding-agent CLIs without replacing them.

## Design Principle

Provider adapters should be small wrappers around configured shell commands.

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

## Initial Provider

### Shell Provider

Expected usage:

```bash
relay ask --provider local-llm "Fix the failing test"
```

## No Automated Model Switching

Relay should not silently switch models or providers to optimize cost. That would undermine developer predictability.

Instead, Relay should reduce token consumption by:

- deterministic prefix pinning
- prompt-cache optimization
- context compaction
- git deltas
- local budget enforcement
