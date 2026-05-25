// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

export interface FilterOptions {
  enabled?: boolean;
  maxLines?: number;
  dedupConsecutive?: boolean;
  collapseBlankLines?: boolean;
  stripAnsi?: boolean;
  successPatterns?: RegExp[];
  maxSuccessOccurrences?: number;
}

const DEFAULT_SUCCESS_PATTERNS: RegExp[] = [
  /^\s*(PASS|ok|passed|compiled|done|success|built)\b/i,
  /^\s*[✓✔]/,
];

export function filterOutput(raw: string, opts: FilterOptions = {}): string {
  if (opts.enabled === false) return raw;

  const {
    maxLines = 300,
    dedupConsecutive = true,
    collapseBlankLines = true,
    stripAnsi = true,
    successPatterns = DEFAULT_SUCCESS_PATTERNS,
    maxSuccessOccurrences = 3,
  } = opts;

  let text = stripAnsi ? raw.replace(ANSI_RE, "") : raw;
  let lines = text.split("\n");

  if (collapseBlankLines) {
    const out: string[] = [];
    let blanks = 0;
    for (const line of lines) {
      if (line.trim() === "") {
        if (++blanks <= 1) out.push(line);
      } else {
        blanks = 0;
        out.push(line);
      }
    }
    lines = out;
  }

  if (dedupConsecutive) {
    const out: string[] = [];
    let prev: string | undefined;
    let dupCount = 0;
    for (const line of lines) {
      if (line === prev) {
        dupCount++;
      } else {
        if (prev !== undefined && dupCount > 0) {
          out.push(`  [×${dupCount + 1} repeated]`);
        }
        prev = line;
        dupCount = 0;
        out.push(line);
      }
    }
    if (prev !== undefined && dupCount > 0) {
      out.push(`  [×${dupCount + 1} repeated]`);
    }
    lines = out;
  }

  if (successPatterns.length > 0 && maxSuccessOccurrences >= 0) {
    let successCount = 0;
    const out: string[] = [];
    for (const line of lines) {
      const isSuccess = successPatterns.some((p) => p.test(line));
      if (isSuccess) {
        successCount++;
        if (successCount <= maxSuccessOccurrences) {
          out.push(line);
        } else if (successCount === maxSuccessOccurrences + 1) {
          out.push("  [... additional success lines suppressed]");
        }
      } else {
        out.push(line);
      }
    }
    lines = out;
  }

  if (lines.length > maxLines) {
    const headCount = Math.floor(maxLines * 0.6);
    const tailCount = maxLines - headCount;
    const omitted = lines.length - maxLines;
    lines = [
      ...lines.slice(0, headCount),
      `\n[... ${omitted} lines truncated ...]\n`,
      ...lines.slice(lines.length - tailCount),
    ];
  }

  return lines.join("\n").trim();
}
