import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function readTextFile(path: string, fallback = ""): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return fallback;
  }
}

export function writeTextFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

export function readOptional(path: string, fallback = ""): string {
  return existsSync(path) ? readFileSync(path, "utf8") : fallback;
}
