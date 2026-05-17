import test from "node:test";
import assert from "node:assert/strict";
import { createShellProvider } from "./shell-provider.js";
import type { RelayConfig } from "../config/relay-config.js";

const baseConfig: RelayConfig = {
  provider: { default: "default" },
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

test("createShellProvider rejects unknown providers without built-in defaults", () => {
  assert.throws(() => createShellProvider("missing", baseConfig), /Unknown provider 'missing'/);
});
