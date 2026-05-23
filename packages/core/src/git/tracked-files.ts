import { execFileSync } from "node:child_process";

export function listTrackedFiles(cwd = process.cwd()): string[] {
  try {
    const output = execFileSync("git", ["ls-files"], { cwd, encoding: "utf8" });
    return output.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export interface FileIndexOptions {
  limit?: number;
  priorityPaths?: string[];
  excludePatterns?: RegExp[];
}

const DEFAULT_EXCLUDE = [
  /\.lock$/,
  /\.snap$/,
  /\.map$/,
  /\.d\.ts$/,
  /dist\//,
  /node_modules\//,
  /\.min\.js$/,
];

export function buildPrioritizedFileIndex(
  cwd = process.cwd(),
  options: FileIndexOptions = {}
): string[] {
  const { limit = 200, priorityPaths = [], excludePatterns = DEFAULT_EXCLUDE } = options;

  const all = listTrackedFiles(cwd);
  const prioritySet = new Set(priorityPaths);
  const filtered = all.filter((f) => !excludePatterns.some((pattern) => pattern.test(f)));

  const priority = filtered.filter((f) => prioritySet.has(f));
  const rest = filtered.filter((f) => !prioritySet.has(f));

  return [...priority, ...rest].slice(0, limit);
}
