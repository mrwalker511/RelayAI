import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readTextFile, writeTextFile, readOptional } from "./fs.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "relay-fs-test-"));
}

test("readTextFile returns file contents when file exists", () => {
  const dir = tempDir();
  writeTextFile(join(dir, "a.txt"), "hello");
  assert.equal(readTextFile(join(dir, "a.txt")), "hello");
});

test("readTextFile returns empty string fallback when file missing", () => {
  assert.equal(readTextFile(join(tempDir(), "missing.txt")), "");
});

test("readTextFile returns custom fallback when file missing", () => {
  assert.equal(readTextFile(join(tempDir(), "missing.txt"), "default"), "default");
});

test("writeTextFile creates intermediate directories", () => {
  const dir = tempDir();
  const nested = join(dir, "a", "b", "c.txt");
  writeTextFile(nested, "nested content");
  assert.equal(readTextFile(nested), "nested content");
});

test("readOptional returns file contents when file exists", () => {
  const dir = tempDir();
  writeTextFile(join(dir, "b.txt"), "world");
  assert.equal(readOptional(join(dir, "b.txt")), "world");
});

test("readOptional returns empty string when file missing", () => {
  assert.equal(readOptional(join(tempDir(), "nope.txt")), "");
});

test("readOptional returns custom fallback when file missing", () => {
  assert.equal(readOptional(join(tempDir(), "nope.txt"), "fallback"), "fallback");
});

test("writeTextFile overwrites existing file", () => {
  const dir = tempDir();
  const path = join(dir, "file.txt");
  writeTextFile(path, "first");
  writeTextFile(path, "second");
  assert.equal(readTextFile(path), "second");
});
