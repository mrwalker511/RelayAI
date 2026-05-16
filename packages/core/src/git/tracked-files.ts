import { execFileSync } from "node:child_process";

export function listTrackedFiles(cwd = process.cwd()): string[] {
  try {
    const output = execFileSync("git", ["ls-files"], { cwd, encoding: "utf8" });
    return output.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
