# Getting Started

This guide walks through installing, building, and running Relay locally for development. For a complete user-facing installation guide covering provider setup, daily workflow, and troubleshooting, see [`USER_INSTALLATION_GUIDE.md`](USER_INSTALLATION_GUIDE.md).

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

- **Set up a provider**: [`USER_INSTALLATION_GUIDE.md`](USER_INSTALLATION_GUIDE.md)
- **Full command reference**: [`COMMANDS.md`](COMMANDS.md)
- **Configuration options**: [`CONFIGURATION.md`](CONFIGURATION.md)
- **MCP integration**: [`MCP.md`](MCP.md)
- **Architecture deep-dive**: [`ARCHITECTURE.md`](ARCHITECTURE.md)
