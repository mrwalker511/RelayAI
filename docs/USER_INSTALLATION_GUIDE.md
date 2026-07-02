# Relay User and Installation Guide

Relay is a local-first context construction layer for coding agents and model CLIs. It prepares deterministic, cache-friendly prompts from your repository state, git diff, and compact session memory, then either prints the assembled payload or sends it to a configured provider command.

Relay does not replace your model CLI. It sits in front of it.

## Who This Guide Is For

Use this guide if you want to install Relay and use it in your own codebase. If you are changing Relay itself, read [`docs/GETTING_STARTED.md`](GETTING_STARTED.md) instead.

## Requirements

- Node.js 20 or newer
- git

## Install

```bash
npm install -g @relay-cache/cli
```

If `relay --help` prints the command list, the install succeeded.

Or run without installing:

```bash
npx @relay-cache/cli --help
```

## Before You Initialize a Project

Confirm the following before running `relay init`:

- [ ] Node.js 20 or newer: `node --version`
- [ ] You are inside a git repository with at least one commit: `git log --oneline -1`
- [ ] A provider CLI is installed (e.g. `claude --version`, `codex --version`, `ollama --version`). Optional for first install; required to route prompts.

Relay stores all runtime state in a local `.relay/` directory inside the repository where you run it. That directory is intended to stay uncommitted.

## Initialize a Project

Change into the repository you want Relay to manage:

```bash
cd /path/to/your/project
relay init
```

Relay creates:

```txt
.relay/
├── config.json
└── memory/
    ├── semantic-state.json
    ├── session.raw.md
    └── session.compacted.md
```

Run the readiness check:

```bash
relay doctor
```

`relay doctor` checks: git repository presence, `.relay/` structure, `config.json` validity, session metadata, token budget ordering, and provider command availability.

- `"status": "ok"` — ready
- `"status": "warning"` — degraded but functional (e.g. no session started yet)
- `"status": "error"` — blocking issue; the `message` field explains what to fix

## Shell Tab Completion (Optional)

To enable tab completion for `relay` subcommands and flags:

```bash
source <(relay completion bash)   # bash — add to ~/.bashrc
source <(relay completion zsh)    # zsh — add to ~/.zshrc
relay completion fish | source    # fish — add to ~/.config/fish/config.fish
```

## Start a Session

Start a git-anchored session from the project repository:

```bash
relay session start
```

Relay records the current git SHA as the session base. Later prompts include the git diff since that base instead of resending the whole repository.

Check session metadata at any time:

```bash
relay session status
```

## First Prompt

To inspect the payload Relay would send to a model:

```bash
relay ask "Summarize this repository"
```

Without `--provider`, Relay prints the assembled payload between `---BEGIN RELAY PAYLOAD---` and `---END RELAY PAYLOAD---`.

To inspect a configured provider route without executing it:

```bash
relay ask "Summarize this repository" --provider default --dry-run
```

## Configure a Provider

Edit `.relay/config.json` in the project where you initialized Relay.

Example:

```json
{
  "provider": {
    "default": "local-agent",
    "commands": {
      "local-agent": ["your-agent-cli"]
    }
  },
  "gc": {
    "enabled": true,
    "command": ["your-agent-cli"],
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

Provider commands are arrays of command arguments. Relay sends the assembled prompt to the provider process on stdin.

### Claude CLI

```json
{
  "provider": {
    "default": "claude",
    "commands": { "claude": ["claude", "--dangerously-skip-permissions"] }
  }
}
```

> **Warning:** `--dangerously-skip-permissions` bypasses Claude's interactive confirmation prompts — Claude will run tools (file writes, shell commands) without asking. Only use this in automated pipelines where you control the prompt content. See [`docs/PROVIDER_ADAPTERS.md`](PROVIDER_ADAPTERS.md) for the full guidance.

### OpenAI Codex

```json
{
  "provider": {
    "default": "codex",
    "commands": { "codex": ["codex", "exec", "-"] }
  }
}
```

For more provider configurations (Ollama, Copilot, multi-provider), see [`docs/PROVIDER_ADAPTERS.md`](PROVIDER_ADAPTERS.md).

Validate the configuration:

```bash
relay doctor
```

Send a prompt through the default provider:

```bash
relay ask "Review the current diff and identify risky changes" --provider default
```

Or send through a named provider:

```bash
relay ask "Write focused tests for the changed files" --provider local-agent
```

## Daily Workflow

Use this loop inside the project you are working on:

```bash
relay doctor
relay session start
relay ask "Plan the next change" --provider default
relay diff
relay context inspect
relay tokens inspect
```

Recommended habits:

- Start a new Relay session when you begin a distinct task or after rebasing.
- Use `relay diff` to confirm the active delta is what you expect.
- Use `relay context inspect` when prompt contents or cache behavior look surprising.
- Use `relay tokens inspect` before sending a large prompt.
- Keep `.relay/` out of git.

## Cache and Token Tools

Relay separates prompt construction into stable and dynamic zones so providers with prompt caching can reuse the stable prefix.

Inspect cache-relevant metadata:

```bash
relay cache inspect
relay cache fingerprint
```

Warm a provider-side prompt cache:

```bash
relay cache warm --provider default
```

Preview the warmup payload without executing the provider:

```bash
relay cache warm --provider default --dry-run
```

Estimate token usage for ad hoc text:

```bash
relay tokens estimate "short prompt text"
relay tokens budget
relay tokens inspect
```

## Compact Session Memory

Relay appends prompt history to `.relay/memory/session.raw.md`. When that history gets large, compact it into structured semantic state:

```bash
relay gc preview
relay gc run
```

`relay gc preview` shows the compacted state without writing changes. `relay gc run` writes `.relay/memory/semantic-state.json`, clears raw history, and saves a snapshot for rollback.

Restore the previous semantic state snapshot:

```bash
relay gc restore
```

GC requires either `gc.command` or a configured default provider command in `.relay/config.json`.

## Troubleshooting

### `relay` command not found

Re-run `npm install -g @relay-cache/cli`, then verify `npm bin -g` is on your PATH:

```bash
npm bin -g   # should print a directory — confirm it's in your PATH
```

### `.relay/config.json is invalid`

Run:

```bash
relay doctor
```

Then compare your config with the example in this guide. Provider commands must be arrays, not strings.

### No active session found

Run:

```bash
relay session start
```

### Provider command fails

First inspect without execution:

```bash
relay ask "test prompt" --provider default --dry-run
```

Then run `relay doctor` to confirm the provider command is available.

### Prompt is too large

Inspect token usage and compact history:

```bash
relay tokens inspect
relay gc preview
relay gc run
```

## Building From Source (Contributors)

If you want to modify Relay itself rather than just use it:

```bash
git clone https://github.com/mrwalker511/relayai.git RelayAI
cd RelayAI
pnpm install   # requires pnpm 9 — npm install -g pnpm
pnpm build
node packages/cli/dist/index.js --help
```

During development, use `pnpm dev` to run the CLI without rebuilding:

```bash
pnpm dev --help
pnpm dev ask "test prompt"
```

See [`docs/GETTING_STARTED.md`](GETTING_STARTED.md) for the full contributor workflow.

## Reference Docs

- `docs/COMMANDS.md` lists every CLI command.
- `docs/CONFIGURATION.md` describes `.relay/config.json`.
- `docs/PROVIDER_ADAPTERS.md` explains provider command behavior.
- `docs/ARCHITECTURE.md` explains Relay's three-zone context model.
