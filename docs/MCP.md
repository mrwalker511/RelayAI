# Relay MCP Server

Relay can run as a local, read-only MCP server so any MCP-compatible coding agent can request deterministic, cache-optimized project context without changing how it works.

Relay remains the context layer. Claude Code, Cursor, Windsurf, or any other MCP-compatible host remains the interface. Relay contributes cache-friendly payloads, git delta awareness, semantic memory, and token safety — transparently.

---

## How It Works

```
┌─────────────────────────────────────────┐
│  MCP Host (Claude Code, Cursor, etc.)   │
│                                         │
│  agent calls: get_prompt_payload(...)   │
└────────────────┬────────────────────────┘
                 │ stdio (MCP protocol)
                 ▼
┌─────────────────────────────────────────┐
│  relay mcp  (local stdio process)       │
│                                         │
│  reads .relay/ — no mutations           │
│  assembles three-zone payload           │
│  returns cache_control hints            │
└─────────────────────────────────────────┘
```

The MCP server is a thin read-only projection of your `.relay/` workspace state. It does not start sessions, run garbage collection, call providers, or write files. All mutating operations remain in the CLI.

---

## Prerequisites

The MCP server reads from `.relay/` — it will not function correctly without an initialized workspace and an active session. Run these commands in the repository you want Relay to manage before connecting any MCP host:

```bash
relay init            # create .relay/ with config and memory files
relay doctor          # verify workspace readiness
relay session start   # anchor context to the current git SHA
```

Confirm your workspace is healthy before proceeding to host configuration.

---

## Host Configuration

### Claude Code

Add Relay to your Claude Code MCP settings at `~/.claude/mcp_settings.json` (create the file if it does not exist):

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

If `relay` is not on your PATH (for example, when running from a local development clone), use the full path to the compiled CLI:

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

Add Relay to `.cursor/mcp.json` in your project root (or Cursor's global MCP config):

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

### Windsurf

Add Relay to your Windsurf MCP configuration (global or workspace-level):

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

### Continue (VS Code / JetBrains)

Add Relay as a subprocess MCP provider in your Continue config:

```json
{
  "mcpServers": [
    {
      "name": "relay",
      "command": "relay",
      "args": ["mcp"]
    }
  ]
}
```

### Generic MCP Host

Any host that supports the MCP stdio transport can connect to Relay:

```json
{
  "mcpServers": {
    "relay": {
      "command": "relay",
      "args": ["mcp"],
      "transport": "stdio"
    }
  }
}
```

The process must be launched with the working directory set to the repository where `.relay/` lives, or the server will read no workspace state.

---

## Tool Reference

Once connected, the host can call six read-only tools. All tools set `readOnlyHint: true` and `destructiveHint: false` in their MCP annotations.

---

### `get_prompt_payload`

Assembles Relay's full cache-optimized prompt payload for a user prompt.

| Field | Value |
|-------|-------|
| **Input** | `prompt` (string, required) — the user's task or question |
| **Returns** | Three `text` content blocks (STATIC_BLOCK, STATE_LAYER, DYNAMIC_INPUT). STATIC_BLOCK and STATE_LAYER include `cache_control: { type: "ephemeral" }` hints for Anthropic prompt caching. Returns a JSON error object if the token budget is exceeded. |
| **When to use** | Before any coding task, debugging session, code review, test planning, or repository explanation. This is the primary tool for most agent workflows. |
| **Notes** | When `budget.status === "blocked"`, the payload is not returned. Run `relay gc run` in the CLI to compact memory, then retry. |

**Example call:**
```json
{ "prompt": "Refactor the token budget module to support soft limits" }
```

**Example response shape (unblocked):**
```
content[0]: { type: "text", text: "<STATIC_BLOCK>...", cache_control: { type: "ephemeral" } }
content[1]: { type: "text", text: "<STATE_LAYER>...", cache_control: { type: "ephemeral" } }
content[2]: { type: "text", text: "<DYNAMIC_INPUT>..." }
```

---

### `get_project_context`

Returns a structured overview of the current Relay workspace state without assembling the full payload.

| Field | Value |
|-------|-------|
| **Input** | None |
| **Returns** | JSON object with `cwd`, `relay_dir`, `config` (valid/path/error), `session` (id, base_git_sha, prefix_hash, created_at, tracked_path_count), `prefix`, `state` (semantic_state_path, exists, valid_json, parsed), `files` (tracked/included counts, included paths), `zones` (token counts per zone), `budget` (tokens, status, limits), `git` (base_ref, diff_present, diff_tokens) |
| **When to use** | Light context checks before deciding whether to call `get_prompt_payload`. Useful for health dashboards, debugging, or when you need metadata without the full payload. |
| **Notes** | Cheaper than `get_prompt_payload` because it does not assemble zone content. |

---

### `get_git_delta`

Returns the git diff since the Relay session base SHA.

| Field | Value |
|-------|-------|
| **Input** | `max_chars` (integer, optional) — maximum diff characters to return. Defaults to 120,000; capped at 500,000. |
| **Returns** | JSON object with `base_ref` (SHA), `diff` (string), `diff_tokens` (estimate), `truncated` (boolean), `original_chars`, `returned_chars` |
| **When to use** | When you need the raw diff for custom analysis, code review prompts, or change summaries without the full Relay payload overhead. |
| **Notes** | The diff covers all changes since `relay session start`. To reset the base, run `relay session start` in the CLI. |

**Example call:**
```json
{ "max_chars": 50000 }
```

---

### `get_semantic_state`

Returns Relay's compacted semantic memory.

| Field | Value |
|-------|-------|
| **Input** | None |
| **Returns** | JSON object with `semantic_state_path`, `exists`, `valid_json`, `error`, and `semantic_state` — the parsed `SemanticState` struct |
| **When to use** | When you need to inspect what Relay's GC has recorded about the current work session: goals, errors, hypotheses, next actions, and code changes. |
| **Notes** | `semantic_state` will be `null` if no GC has been run yet. Run `relay gc run` in the CLI to generate or refresh the state. |

**`SemanticState` schema:**
```typescript
{
  active_target: string;          // repository or module being worked on
  current_goal: string;           // most recent high-level objective
  runtime_errors: string[];       // observed errors not yet resolved
  verified_hypotheses: string[];  // confirmed causes or fixes
  rejected_hypotheses: string[];  // ruled-out approaches
  next_actions: string[];         // planned next steps
  code_changes: string[];         // summary of changes made this session
}
```

---

### `get_token_budget`

Computes token usage for an optional prompt without sending anything to a provider.

| Field | Value |
|-------|-------|
| **Input** | `prompt` (string, optional) — prompt to include in the dynamic input zone. Defaults to a placeholder if omitted. |
| **Returns** | JSON object with `zones` (token counts per zone: static_block, state_layer, dynamic_input, total) and `budget` (tokens, status, message, warning_limit, confirmation_threshold, hard_limit) |
| **When to use** | Before large context requests. Check whether a prompt will hit `warning`, `requires_confirmation`, or `blocked` status before calling `get_prompt_payload`. |
| **Budget statuses:** | `ok` — within all limits; `warning` — approaching limit; `requires_confirmation` — above confirmation threshold; `blocked` — exceeds hard limit |

**Example call:**
```json
{ "prompt": "Rewrite the entire core package with a new architecture" }
```

---

### `inspect_context_health`

Returns structured health findings for the full Relay workspace.

| Field | Value |
|-------|-------|
| **Input** | None |
| **Returns** | JSON object with health findings array (each with `level`, `area`, `message`, `action`), plus `session`, `budget`, and `git` summaries |
| **When to use** | At the start of a coding session, when context looks stale, after pulling new changes, or when other tools return unexpected results. |
| **Health areas checked:** | Config validity, session state, semantic state freshness, prefix drift (has the codebase changed since the last session start?), token budget, git delta presence |

---

## Recommended Agent Workflow

A well-integrated agent should follow this call sequence:

```
1. inspect_context_health()
   └─ Check for warnings or errors before proceeding.
      If session is missing → run `relay session start` in CLI.
      If semantic state is stale → run `relay gc run` in CLI.

2. get_token_budget({ prompt })
   └─ Confirm the prompt fits within budget.
      If status is "blocked" → run `relay gc run` in CLI, then retry.

3. get_prompt_payload({ prompt })
   └─ Use as the full context for the coding task.
      STATIC_BLOCK and STATE_LAYER carry cache_control hints — the
      host should pass these through to the model API unchanged.
```

For lightweight checks (monitoring, status dashboards, pre-flight checks):

```
get_project_context()   — overview without full assembly cost
get_semantic_state()    — inspect current GC memory
get_git_delta()         — inspect raw changes since session start
```

---

## Cache Behavior

`get_prompt_payload` returns three MCP content blocks. The first two carry `cache_control: { type: "ephemeral" }` hints:

```
content[0]  STATIC_BLOCK   cache_control: { type: "ephemeral" }   ← cache this
content[1]  STATE_LAYER     cache_control: { type: "ephemeral" }   ← cache this
content[2]  DYNAMIC_INPUT   (no cache_control)                      ← volatile
```

When a host passes these hints to the Anthropic API (Claude), the provider caches the stable prefix on the first call. Subsequent calls with the same STATIC_BLOCK and STATE_LAYER hit the cache rather than reprocessing the entire context. Relay's three-zone architecture is specifically designed so the stable zones change infrequently — only when you run `relay gc run` or `relay session start`.

---

## Safety Guarantees

The MCP server is **read-only**. MCP tool calls do not:

- Start or end sessions
- Run or trigger garbage collection
- Warm provider caches
- Call configured provider commands
- Write to any `.relay/` files
- Execute shell commands beyond reading git state

All mutating workflows must be run from the CLI:

```bash
relay session start          # anchor context to current git SHA
relay gc preview             # preview what GC will compact
relay gc run                 # compact session history into SemanticState
relay cache warm             # warm the provider's prompt cache
```

This boundary is intentional — it ensures the MCP server cannot interfere with session state or trigger unexpected provider calls, regardless of what the connected agent requests.

---

## Troubleshooting

### `relay: command not found`

The `relay` binary is not on the PATH seen by the MCP host process. Use the full path form:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/RelayAI/packages/cli/dist/index.js", "mcp"]
}
```

Or install the package globally: `npm install -g @relay/cli`.

### Tools return empty or invalid session data

No active session. Run `relay session start` in your repository. The MCP server cannot create sessions — it only reads them.

### `get_prompt_payload` returns `blocked`

The assembled payload exceeds the configured hard token limit. Compact session memory:

```bash
relay gc run
```

Then call `get_prompt_payload` again.

### Context looks stale after recent code changes

The session base SHA may be outdated. Reset:

```bash
relay session start
```

This re-anchors the git delta to HEAD and refreshes the file index.

### `inspect_context_health` reports prefix drift

The codebase has changed significantly since the last session start, causing the stable zones to diverge from the session's recorded prefix hash. Run `relay session start` to re-anchor.

### General diagnostics

Run `relay doctor` in your repository to check workspace configuration, session state, and file validity. The output maps directly to what `inspect_context_health` surfaces via MCP.
