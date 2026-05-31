# Getting Started

This guide walks through installing, building, and running Relay locally for development. For a complete user-facing installation guide covering provider setup, daily workflow, and troubleshooting, see [`USER_INSTALLATION_GUIDE.md`](USER_INSTALLATION_GUIDE.md).

> **Just want to see it work?** Run `./examples/sample-project/try-relay.sh` for a
> one-command demo of measured token savings against the real OpenAI Codex CLI
> (requires `codex` on PATH and `codex login`), then read
> [`WALKTHROUGH.md`](WALKTHROUGH.md) for what each number means.

---

## Prerequisites

- Node.js 20+
- pnpm 9+
- git
- A local or remote LLM command-line tool for provider execution (optional for local development)

---

## Install Dependencies

```bash
pnpm install
```

---

## Build the Workspace

```bash
pnpm build
```

---

## Initialize Relay in a Repository

From the repository you want Relay to manage:

```bash
relay init
```

During local development from this checkout, use:

```bash
pnpm dev init
```

This creates:

```txt
.relay/
├── config.json
└── memory/
    ├── semantic-state.json
    ├── session.raw.md
    └── session.compacted.md
```

---

## Start a Session

```bash
relay session start
```

Relay records:

- Session ID
- Base git SHA
- Deterministic prefix hash
- Tracked paths
- Creation timestamp

---

## Ask Through Relay

```bash
relay ask "Fix the failing auth middleware test"
```

Without a provider, Relay prints the assembled payload. With `--provider <name>`, Relay sends the payload to the configured provider command. Use `--dry-run` to inspect the resolved provider command and payload without executing it.

---

## Measure Real Savings

Add `--measure` to capture the provider's actual reported token usage into the audit ledger, then report it:

```bash
relay ask --provider codex --measure "Fix the failing auth middleware test"
relay savings --input-cost-per-million 3 --cached-input-cost-per-million 0.3
```

With `--measure`, the `codex` builtin runs `codex exec --json -` and Relay reads usage from the final `turn.completed` event (Codex's `input_tokens` includes cached, which Relay normalizes to uncached input). `relay savings` then prints **MEASURED** cost vs. a no-cache baseline and a **PROJECTED** figure grounded in your measured prefix-stability rate. For providers that don't emit parseable usage, record it with `relay usage record`. See [`WALKTHROUGH.md`](WALKTHROUGH.md) for a full walkthrough.

---

## Check Workspace Readiness

```bash
relay doctor
```

`relay doctor` prints JSON diagnostics for git, `.relay` runtime files, config validity, session metadata, token budget ordering, and provider/GC command availability. Warnings do not fail the command; blocking errors do.

---

## Inspect Token Usage

```bash
relay tokens estimate "hello world"
relay tokens inspect
relay cache inspect
relay cache fingerprint
relay context inspect
```

---

## Recommended Development Flow

1. Open this repository in your editor.
2. Run `pnpm install`.
3. Run `pnpm build`.
4. Use `pnpm dev <command>` while iterating on the CLI, or `node packages/cli/dist/index.js <command>` after building.
5. Run `pnpm run ci` before treating package artifacts as ready.

---

## Next Steps

- **Try it end to end (no API key)**: [`WALKTHROUGH.md`](WALKTHROUGH.md)
- **Set up a provider**: [`USER_INSTALLATION_GUIDE.md`](USER_INSTALLATION_GUIDE.md)
- **Full command reference**: [`COMMANDS.md`](COMMANDS.md)
- **Configuration options**: [`CONFIGURATION.md`](CONFIGURATION.md)
- **MCP integration**: [`MCP.md`](MCP.md)
- **Architecture deep-dive**: [`ARCHITECTURE.md`](ARCHITECTURE.md)
