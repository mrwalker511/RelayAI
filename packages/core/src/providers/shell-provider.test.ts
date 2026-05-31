import test from "node:test";
import assert from "node:assert/strict";
import { createShellProvider, ShellProvider } from "./shell-provider.js";
import type { RelayConfig } from "../config/relay-config.js";

const baseConfig: RelayConfig = {
  provider: { default: "default" },
  routing: {},
  gc: {
    enabled: true,
    historyTokenLimit: 12000,
    targetSummaryTokens: 500,
    preserveErrors: true,
    preserveDecisions: true,
    preserveCodeChanges: true,
  },
  tokens: {
    provider: "generic",
    model: "default",
    hardLimit: 100000,
    warningLimit: 50000,
    requireConfirmationAbove: 75000,
  },
  files: { maxIndex: 200 },
  context: { hierarchical: false, contextDir: ".relay/context", maxBranches: 3 },
  filter: { enabled: true, maxLines: 300, maxSuccessOccurrences: 3, dedupConsecutive: true, collapseBlankLines: true },
  audit: { enabled: true, maxLines: 10000 },
};

test("createShellProvider resolves a configured provider command", () => {
  const provider = createShellProvider("local-llm", {
    ...baseConfig,
    provider: {
      default: "local-llm",
      commands: {
        "local-llm": ["llm", "--model", "dev"],
      },
    },
  });

  assert.equal(provider.name, "local-llm");
  assert.equal(provider.commandLine, "llm --model dev");
});

test("createShellProvider rejects unknown providers not in built-in defaults or config", () => {
  assert.throws(() => createShellProvider("missing", baseConfig), /Unknown provider 'missing'/);
});

test("createShellProvider resolves claude from built-in defaults", () => {
  const provider = createShellProvider("claude", baseConfig);
  assert.equal(provider.name, "claude");
  assert.equal(provider.commandLine, "claude");
});

test("createShellProvider error message lists built-in provider names", () => {
  assert.throws(() => createShellProvider("missing", baseConfig), /Built-in providers: claude, openai/);
});

test("ShellProvider.sendPrompt pipes payload to stdin and returns exit code 0", async () => {
  // cat reads stdin and exits 0 — verifies payload is written without hanging
  const provider = new ShellProvider("cat", "cat", []);
  const result = await provider.sendPrompt("hello relay");
  assert.equal(result.exitCode, 0);
});

test("ShellProvider.sendPrompt returns non-zero exit code from process", async () => {
  const provider = new ShellProvider("false", "/bin/sh", ["-c", "cat >/dev/null; exit 42"]);
  const result = await provider.sendPrompt("test payload");
  assert.equal(result.exitCode, 42);
});

test("ShellProvider.sendPrompt captures stdout when capture is enabled", async () => {
  const provider = new ShellProvider("printer", "/bin/sh", ["-c", "cat >/dev/null; printf 'hello-out'"]);
  const result = await provider.sendPrompt("x", { capture: true });
  assert.equal(result.exitCode, 0);
  assert.equal(result.capturedOutput, "hello-out");
});

test("ShellProvider.sendPrompt does not capture stdout by default", async () => {
  const provider = new ShellProvider("printer", "/bin/sh", ["-c", "cat >/dev/null; printf 'hi'"]);
  const result = await provider.sendPrompt("x");
  assert.equal(result.capturedOutput, undefined);
});

test("withMeasure: claude appends json, codex inserts --json after exec, others are no-ops", () => {
  const claude = new ShellProvider("claude", "claude", []);
  assert.equal(claude.withMeasure().commandLine, "claude --output-format json");
  // already configured → unchanged
  const preset = new ShellProvider("claude", "claude", ["--output-format", "stream-json"]);
  assert.equal(preset.withMeasure().commandLine, "claude --output-format stream-json");

  // codex → --json inserted right after exec, idempotent
  const codex = new ShellProvider("codex", "codex", ["exec", "-"]);
  assert.equal(codex.withMeasure().commandLine, "codex exec --json -");
  assert.equal(codex.withMeasure().withMeasure().commandLine, "codex exec --json -");
  const codexPreset = new ShellProvider("codex", "codex", ["exec", "--json", "-"]);
  assert.equal(codexPreset.withMeasure().commandLine, "codex exec --json -");

  // non-claude/codex → unchanged
  const other = new ShellProvider("llm", "llm", ["--model", "dev"]);
  assert.equal(other.withMeasure().commandLine, "llm --model dev");
});

test("ShellProvider delivers {prompt} as a substituted argv element, not via stdin", async () => {
  // printf %s "<payload>" — the payload arrives as an argument, printed verbatim;
  // printf never reads stdin, so this also proves stdin delivery was not required.
  const provider = new ShellProvider("printf", "printf", ["%s", "{prompt}"]);
  const payload = "hello relay placeholder";
  const result = await provider.sendPrompt(payload, { capture: true });
  assert.equal(result.exitCode, 0);
  assert.equal(result.capturedOutput, payload);
});

test("ShellProvider.sendPrompt rejects when command is not found", async () => {
  const provider = new ShellProvider("nonexistent", "relay-nonexistent-command-xyz", []);
  await assert.rejects(() => provider.sendPrompt("test"), /not found in PATH/);
});

test("createShellProvider rejects user-configured command with shell metacharacters", () => {
  assert.throws(
    () => createShellProvider("evil", {
      ...baseConfig,
      provider: {
        default: "evil",
        commands: { evil: ["sh; rm -rf /"] },
      },
    }),
    /forbidden shell characters/
  );
});

test("createShellProvider rejects user-configured command with pipe character", () => {
  assert.throws(
    () => createShellProvider("piped", {
      ...baseConfig,
      provider: {
        default: "piped",
        commands: { piped: ["cmd | malicious"] },
      },
    }),
    /forbidden shell characters/
  );
});

test("createShellProvider allows user-configured command without metacharacters", () => {
  const provider = createShellProvider("safe", {
    ...baseConfig,
    provider: {
      default: "safe",
      commands: { safe: ["my-llm-cli", "--model", "fast"] },
    },
  });
  assert.equal(provider.name, "safe");
  assert.equal(provider.commandLine, "my-llm-cli --model fast");
});

test("createShellProvider does not validate built-in defaults for metacharacters", () => {
  // Built-in defaults like "ollama" with args are pre-vetted — must not throw
  const provider = createShellProvider("local", baseConfig);
  assert.equal(provider.name, "local");
});
