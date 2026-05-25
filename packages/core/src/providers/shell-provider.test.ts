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
  const code = await provider.sendPrompt("hello relay");
  assert.equal(code, 0);
});

test("ShellProvider.sendPrompt returns non-zero exit code from process", async () => {
  const provider = new ShellProvider("false", "/bin/sh", ["-c", "cat >/dev/null; exit 42"]);
  const code = await provider.sendPrompt("test payload");
  assert.equal(code, 42);
});

test("ShellProvider.sendPrompt rejects when command is not found", async () => {
  const provider = new ShellProvider("nonexistent", "relay-nonexistent-command-xyz", []);
  await assert.rejects(() => provider.sendPrompt("test"), /not found in PATH/);
});
