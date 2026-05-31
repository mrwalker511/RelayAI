import test from "node:test";
import assert from "node:assert/strict";
import { parseProviderUsage } from "./usage-parser.js";

test("parses a Claude --output-format json envelope", () => {
  const stdout = JSON.stringify({
    type: "result",
    result: "ok",
    usage: {
      input_tokens: 100,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 50,
      output_tokens: 200
    }
  });
  assert.deepEqual(parseProviderUsage("claude", stdout), {
    inputTokens: 100,
    cachedInputTokens: 900,
    cacheCreationTokens: 50,
    outputTokens: 200
  });
});

test("tolerates surrounding text and markdown fences", () => {
  const stdout = "Here is the result:\n```json\n" +
    JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 } }) +
    "\n```\nDone.";
  assert.deepEqual(parseProviderUsage("claude", stdout), { inputTokens: 10, outputTokens: 5 });
});

test("parses stream-json and prefers the final object with usage", () => {
  const stdout = [
    JSON.stringify({ type: "assistant", text: "thinking" }),
    JSON.stringify({ type: "result", usage: { input_tokens: 7, cache_read_input_tokens: 3, output_tokens: 9 } })
  ].join("\n");
  assert.deepEqual(parseProviderUsage("claude", stdout), {
    inputTokens: 7,
    cachedInputTokens: 3,
    outputTokens: 9
  });
});

test("parses a Codex turn.completed JSONL envelope (cached-inclusive normalization)", () => {
  const stdout = JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 24763, cached_input_tokens: 24448, output_tokens: 122, reasoning_output_tokens: 0 }
  });
  assert.deepEqual(parseProviderUsage("codex", stdout), {
    inputTokens: 315, // 24763 - 24448
    cachedInputTokens: 24448,
    outputTokens: 122 // 122 + 0 reasoning
  });
});

test("Codex multi-line JSONL: skips thread.started and selects turn.completed usage", () => {
  const stdout = [
    JSON.stringify({ type: "thread.started", thread_id: "t_1" }),
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10, reasoning_output_tokens: 5 } })
  ].join("\n");
  assert.deepEqual(parseProviderUsage("codex", stdout), {
    inputTokens: 60, // 100 - 40
    cachedInputTokens: 40,
    outputTokens: 15 // 10 + 5
  });
});

test("returns null for non-JSON output", () => {
  assert.equal(parseProviderUsage("claude", "just some plain text reply"), null);
});

test("returns null for JSON without a usage object", () => {
  assert.equal(parseProviderUsage("claude", JSON.stringify({ result: "ok" })), null);
});

test("returns null for empty output", () => {
  assert.equal(parseProviderUsage("claude", "   "), null);
});
