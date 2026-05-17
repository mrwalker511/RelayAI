import test from "node:test";
import assert from "node:assert/strict";
import { RelayConfigSchema } from "./relay-config.js";

test("RelayConfigSchema uses provider-neutral defaults", () => {
  const cfg = RelayConfigSchema.parse({});

  assert.equal(cfg.provider.default, "default");
  assert.equal(cfg.tokens.provider, "generic");
  assert.equal(cfg.tokens.model, "default");
  assert.equal(cfg.gc.command, undefined);
});

test("RelayConfigSchema accepts arbitrary configured provider commands", () => {
  const cfg = RelayConfigSchema.parse({
    provider: {
      default: "local-llm",
      commands: {
        "local-llm": ["llm", "--model", "dev"],
      },
    },
    gc: {
      command: ["llm", "--json"],
    },
  });

  assert.deepEqual(cfg.provider.commands?.["local-llm"], ["llm", "--model", "dev"]);
  assert.deepEqual(cfg.gc.command, ["llm", "--json"]);
});
