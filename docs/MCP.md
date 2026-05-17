# Relay MCP

Relay can run as a local MCP server so your existing AI coding tool can ask Relay for deterministic project context.

Relay remains the context layer. Codex, Claude Code, Cursor, or another MCP-compatible host remains the interface.

## Setup

Initialize Relay in the repository and start a session:

```bash
relay init
relay session start
```

Add Relay to your MCP host configuration:

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

After that, use your agent normally. The host launches `relay mcp` over stdio and calls Relay tools when it needs project context.

## Tools

`get_prompt_payload`

Returns Relay's full cache-friendly prompt payload for a user prompt. Agents should call this before coding tasks, debugging, code review, test planning, or repository explanations.

`get_project_context`

Returns session metadata, prefix status, semantic state, file index, zone token counts, budget status, and git delta metadata without the full payload.

`get_git_delta`

Returns the git diff since the Relay session base SHA. Accepts `max_chars` to limit the returned diff text.

`get_semantic_state`

Returns Relay's compacted semantic memory and validity metadata.

`get_token_budget`

Returns zone token counts and configured budget status for an optional prompt.

`inspect_context_health`

Returns agent-friendly health findings for config, session, semantic state, prefix drift, token budget, and git delta.

## Safety

The MCP server is read-only in this version. MCP tools do not start sessions, run GC, warm caches, call providers, execute shell commands, or write `.relay` files.

Run mutating Relay workflows yourself from the CLI:

```bash
relay session start
relay gc preview
relay gc run
relay cache warm --provider default
```
