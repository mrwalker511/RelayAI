import { execFileSync } from "node:child_process";

const DIFF_SKIP_PATTERNS = [
  /^diff --git .+\.(lock|snap|map|min\.js|d\.ts) /m,
  /^diff --git .+dist\//m,
  /^diff --git .+node_modules\//m,
];

export function summarizeDiff(diff: string): string {
  if (!diff.trim()) return "No git diff.";

  const fileSections = diff.split(/^(?=diff --git )/m).filter(Boolean);
  const lines: string[] = [];

  for (const section of fileSections) {
    if (DIFF_SKIP_PATTERNS.some((p) => p.test(section))) continue;

    const fileMatch = section.match(/^diff --git a\/.+ b\/(.+)$/m);
    const fileName = fileMatch?.[1] ?? "unknown";
    const additions = (section.match(/^\+[^+]/gm) ?? []).length;
    const deletions = (section.match(/^-[^-]/gm) ?? []).length;
    const hunkHeaders = section.match(/^@@.+@@.*/gm) ?? [];

    lines.push(
      `[modified] ${fileName} — +${additions}/-${deletions} lines` +
        (hunkHeaders.length > 0 ? ` (${hunkHeaders.join("; ")})` : "")
    );
  }

  return lines.length > 0 ? lines.join("\n") : "No relevant diff.";
}

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
