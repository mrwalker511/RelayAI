import { execFileSync } from "node:child_process";

export function getGitDiffSince(baseRef = "HEAD", cwd = process.cwd()): string {
  try {
    return execFileSync("git", ["diff", baseRef], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    return `Unable to read git diff: ${String(error)}`;
  }
}

export function getStagedDiff(cwd = process.cwd()): string {
  try {
    return execFileSync("git", ["diff", "--cached"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    return `Unable to read staged git diff: ${String(error)}`;
  }
}
