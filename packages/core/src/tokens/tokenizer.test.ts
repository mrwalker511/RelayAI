import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, CLAUDE_TOKEN_CORRECTION_FACTOR } from "./tokenizer.js";

test("estimateTokens returns zero tokens for empty string", () => {
  const result = estimateTokens("");
  assert.equal(result.tokens, 0);
});

test("estimateTokens returns a positive token count for non-empty text", () => {
  const result = estimateTokens("hello world");
  assert.ok(result.tokens > 0, "token count should be positive");
});

test("estimateTokens returns a tokenizer name in the result", () => {
  const result = estimateTokens("some text");
  assert.ok(typeof result.tokenizer === "string");
  assert.ok(result.tokenizer.length > 0);
});

test("estimateTokens returns higher count for longer text", () => {
  const short = estimateTokens("hi");
  const long = estimateTokens("This is a much longer string with many more words and tokens in it.");
  assert.ok(long.tokens > short.tokens);
});

test("estimateTokens result is consistent across repeated calls", () => {
  const text = "deterministic token count test";
  const first = estimateTokens(text);
  const second = estimateTokens(text);
  assert.equal(first.tokens, second.tokens);
  assert.equal(first.tokenizer, second.tokenizer);
});

test("default path labels cl100k_base", () => {
  const result = estimateTokens("some sample text for tokenizing");
  assert.equal(result.tokenizer, "cl100k_base");
});

test("no-opts count equals a generic provider", () => {
  const text = "the quick brown fox jumps over the lazy dog";
  assert.equal(estimateTokens(text).tokens, estimateTokens(text, { provider: "generic" }).tokens);
});

test("newer OpenAI models use o200k_base", () => {
  const result = estimateTokens("some sample text", { provider: "openai", model: "gpt-4o" });
  assert.equal(result.tokenizer, "o200k_base");
  assert.ok(result.tokens > 0);
});

test("Claude applies the correction factor over the base count", () => {
  const text = "summarize the architecture of this repository in detail";
  const base = estimateTokens(text, { provider: "openai", model: "gpt-4-turbo" });
  const claude = estimateTokens(text, { provider: "anthropic", model: "claude-sonnet-4" });
  assert.equal(claude.tokenizer, "cl100k_base*claude_factor");
  assert.equal(claude.tokens, Math.ceil(base.tokens * CLAUDE_TOKEN_CORRECTION_FACTOR));
  assert.ok(claude.tokens > base.tokens);
});

test("estimateTokens returns the same object reference on cache hit", () => {
  const text = "cache hit test string that is unique enough";
  const first = estimateTokens(text);
  const second = estimateTokens(text);
  assert.strictEqual(first, second, "memoized call should return the same object");
});

test("explicit correctionFactor overrides the default", () => {
  const text = "some text to estimate";
  const base = estimateTokens(text);
  const doubled = estimateTokens(text, { provider: "anthropic", model: "claude-sonnet-4", correctionFactor: 2 });
  assert.equal(doubled.tokens, Math.ceil(base.tokens * 2));
});
