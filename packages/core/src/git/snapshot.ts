import { execFileSync } from "node:child_process";

export interface SessionSnapshot {
  session_id: string;
  base_git_sha: string;
  prefix_hash?: string;
  tracked_paths: string[];
  created_at: string;
}

export function getCurrentGitSha(cwd = process.cwd()): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8"
    }).trim();
  } catch {
    return "unknown";
  }
}

export function createSessionSnapshot(trackedPaths: string[], prefixHash?: string): SessionSnapshot {
  return {
    session_id: `sess_${Date.now().toString(36)}`,
    base_git_sha: getCurrentGitSha(),
    prefix_hash: prefixHash,
    tracked_paths: trackedPaths,
    created_at: new Date().toISOString()
  };
}
