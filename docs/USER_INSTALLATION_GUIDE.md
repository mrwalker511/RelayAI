# Relay User and Installation Guide

Relay is a local-first context construction layer for coding agents and model CLIs. It prepares deterministic, cache-friendly prompts from your repository state, git diff, and compact session memory, then either prints the assembled payload or sends it to a configured provider command.

Relay does not replace your model CLI. It sits in front of it.

## Who This Guide Is For

Use this guide if you want to install Relay from this repository and use it in another local codebase. If you are changing Relay itself, also read the development commands in the root `README.md`.

## Requirements

- Node.js 20 or newer
- pnpm 9
- git
- A git repository where you want Relay to manage context
- Optional: a model or agent CLI that can read a prompt from stdin

Relay stores all runtime state in a local `.relay/` directory inside the repository where you run it. That directory is intended to stay uncommitted.

## Install Relay From Source

Clone this repository, install dependencies, and build the workspace:

```bash
git clone <relay-repository-url>
cd RelayAI
pnpm install
pnpm build
```

From the Relay checkout, confirm the CLI works:

```bash
node packages/cli/dist/index.js --help
```

To use Relay from other repositories, define a shell alias that points to the built CLI entrypoint while preserving your current working directory:

```bash
alias relay='node /absolute/path/to/RelayAI/packages/cli/dist/index.js'
```

Replace `/absolute/path/to/RelayAI` with the path to your local Relay checkout. Add the alias to your shell profile only after confirming it works in a new terminal.

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

`relay doctor` prints JSON diagnostics. Fix blocking errors before using Relay for provider execution.

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
- Run `pnpm run ci` in the Relay checkout before preparing package artifacts or publishing changes.

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

Confirm the workspace command works:

```bash
node /absolute/path/to/RelayAI/packages/cli/dist/index.js --help
```

If it works, fix your shell alias and open a new terminal.

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

## Reference Docs

- `docs/COMMANDS.md` lists every CLI command.
- `docs/CONFIGURATION.md` describes `.relay/config.json`.
- `docs/PROVIDER_ADAPTERS.md` explains provider command behavior.
- `docs/ARCHITECTURE.md` explains Relay's three-zone context model.
