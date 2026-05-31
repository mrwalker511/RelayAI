#!/usr/bin/env node
// Mock LLM provider for the RelayAI walkthrough.
//
// It ignores the prompt's *meaning* and emits a Claude-style
// `--output-format json` usage envelope on stdout, so `relay ask --measure`
// and `relay savings` work with NO API key and NO network.
//
// It simulates a prompt cache: the FIRST call WRITES the cache
// (cache_creation_input_tokens), and later calls READ it
// (cache_read_input_tokens). That is exactly the behavior RelayAI is built
// to exploit — so the measured-savings numbers tell the real story:
// the first call costs a little more, every call after is much cheaper.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const payload = Buffer.concat(chunks).toString("utf8");
  const approxTokens = Math.max(1, Math.round(payload.length / 4));
  const prefixTokens = Math.round(approxTokens * 0.85); // stable, cacheable zones
  const dynamicTokens = approxTokens - prefixTokens;    // volatile tail (prompt + diff)

  const relayDir = join(process.cwd(), ".relay");
  const marker = join(relayDir, ".mock-cache-warm");
  const warm = existsSync(marker);
  if (!warm) {
    mkdirSync(relayDir, { recursive: true });
    writeFileSync(marker, "1");
  }

  const usage = {
    input_tokens: dynamicTokens,
    cache_read_input_tokens: warm ? prefixTokens : 0,
    cache_creation_input_tokens: warm ? 0 : prefixTokens,
    output_tokens: 220
  };

  // Human-friendly status on stderr; machine-readable envelope on stdout.
  process.stderr.write(
    `[mock-provider] ${warm ? "cache HIT — reading cached prefix" : "cache MISS — writing cache"} (~${approxTokens} input tokens)\n`
  );
  process.stdout.write(JSON.stringify({ type: "result", result: "(mock model response)", usage }) + "\n");
  process.exit(0);
});
