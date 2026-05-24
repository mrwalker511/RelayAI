# Relay MCP

Relay can run as a local MCP server so your existing AI coding tool can request deterministic project context without changing how you work.

Relay remains the context layer. Claude Code, Cursor, or another MCP-compatible host remains the interface. Relay adds cache-friendly payloads, git delta awareness, semantic memory, and token safety — invisibly.

---

## Prerequisites

Before the MCP server is useful, initialize Relay in your repository and start a session:

```bash
relay init
relay doctor
relay session start
```

The MCP server reads from `.relay/` — it will not function correctly without an initialized workspace and an active session.

---

## Setup

### Claude Code

Add Relay to your Claude Code MCP configuration. The config file is at `~/.claude/mcp_settings.json` (create it if it doesn't exist):

```json
{
  "mcpServers": {
    "relay": {
      "command": "relay",
      "args": ["mcp"]
    }
  }
}
```

If you're using the `relay` alias from a shell profile, replace `"relay"` with the full path to the built CLI:

```json
{
  "mcpServers": {
    "relay": {
      "command": "node",
      "args": ["/absolute/path/to/RelayAI/packages/cli/dist/index.js", "mcp"]
    }
  }
}
```

### Cursor

Add Relay to `.cursor/mcp.json` in your project root (or in Cursor's global config):

```json
{
  "mcpServers": {
    "relay": {
      "command": "relay",
      "args": ["mcp"]
    }
  }
}
```

### Generic MCP Host

Any MCP-compatible host can launch `relay mcp` over stdio:

```json
{
  "mcpServers": {
    "relay": {
      "command": "relay",
      "args": ["mcp"]
    }
  }
}
```

---

## Tools

Once connected, the host can call these read-only Relay tools:

### `get_prompt_payload`

Returns Relay's full cache-friendly prompt payload for a user prompt, assembled from the current static block, semantic state, file index, and git delta.

Call this before coding tasks, debugging sessions, code review, test planning, or repository explanations.

### `get_project_context`

Returns session metadata, prefix status, semantic state, file index, zone token counts, budget status, and git delta metadata — without the full payload.

Useful for light context checks that don't need the complete assembled prompt.

### `get_git_delta`

Returns the git diff since the Relay session base SHA.

Accepts an optional `max_chars` argument to limit the returned diff length.

### `get_semantic_state`

Returns Relay's compacted semantic memory (`SemanticState`) and validity metadata.

The `SemanticState` includes: `active_target`, `current_goal`, `runtime_errors`, `verified_hypotheses`, `rejected_hypotheses`, `next_actions`, and `code_changes`.

### `get_token_budget`

Returns zone-by-zone token counts and configured budget status for an optional prompt. Use this to check whether a prompt will be blocked or require confirmation before sending it.

### `inspect_context_health`

Returns structured health findings for config validity, session state, semantic state freshness, prefix drift, token budget, and git delta presence.

Useful as a quick sanity check before a coding session.

---

## Safety

The MCP server is **read-only**. MCP tools do not:

- Start or end sessions
- Run garbage collection
- Warm provider caches
- Call configured provider commands
- Write to `.relay/` files
- Execute shell commands

All mutating workflows must be run from the CLI:

```bash
relay session start
relay gc preview
relay gc run
relay cache warm --provider default
```

This boundary ensures the MCP server cannot interfere with session state or trigger unexpected provider calls.
