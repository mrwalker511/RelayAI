import { execFileSync } from "node:child_process";

export interface SessionSnapshot {
  session_id: string;
  base_git_sha: string;
  prefix_hash?: string;
  static_block_hash?: string;
  state_layer_hash?: string;
  tracked_paths: string[];
  created_at: string;
}

export function getCurrentGitSha(cwd = process.cwd()): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8"
    }).trim();
    return sha || "HEAD";
  } catch {
    return "HEAD";
  }
}

export interface SessionPrefixHashes {
  prefixHash?: string;
  staticBlockHash?: string;
  stateLayerHash?: string;
}

export function createSessionSnapshot(
  trackedPaths: string[],
  prefixHashes: string | SessionPrefixHashes = {}
): SessionSnapshot {
  const hashes = typeof prefixHashes === "string" ? { prefixHash: prefixHashes } : prefixHashes;

  return {
    session_id: `sess_${Date.now().toString(36)}`,
    base_git_sha: getCurrentGitSha(),
    prefix_hash: hashes.prefixHash,
    static_block_hash: hashes.staticBlockHash,
    state_layer_hash: hashes.stateLayerHash,
    tracked_paths: trackedPaths,
    created_at: new Date().toISOString()
  };
}
