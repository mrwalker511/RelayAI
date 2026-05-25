import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens } from "./tokenizer.js";

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
