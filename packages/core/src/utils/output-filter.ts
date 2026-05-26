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
    // Preserve failure lines unconditionally so they are never truncated away
    const FAILURE_RE = /\b(FAIL(?:ED)?|Error:|AssertionError|not ok)\b|[✗×]/i;
    const failureIndices = new Set(
      lines.map((l, i) => (FAILURE_RE.test(l) ? i : -1)).filter(i => i >= 0)
    );

    const nonFailureLines = lines.filter((_, i) => !failureIndices.has(i));
    const budgetForOthers = Math.max(maxLines - failureIndices.size, 0);

    if (nonFailureLines.length > budgetForOthers) {
      const headCount = Math.floor(budgetForOthers * 0.6);
      const tailCount = budgetForOthers - headCount;
      const omitted = nonFailureLines.length - budgetForOthers;
      const truncMsg = `\n[... ${omitted} lines truncated ...]\n`;

      // Walk original lines in order, keeping failure lines and head/tail non-failure lines
      const result: string[] = [];
      let nfSeen = 0;
      let truncInserted = false;
      for (let i = 0; i < lines.length; i++) {
        if (failureIndices.has(i)) {
          result.push(lines[i]);
        } else {
          const isHead = nfSeen < headCount;
          const isTail = nfSeen >= nonFailureLines.length - tailCount;
          if (isHead || isTail) {
            result.push(lines[i]);
          } else if (!truncInserted) {
            result.push(truncMsg);
            truncInserted = true;
          }
          nfSeen++;
        }
      }
      lines = result;
    }
    // If all non-failure lines fit within budget, no truncation needed
  }

  return lines.join("\n").trim();
}
