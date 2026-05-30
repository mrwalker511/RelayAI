export interface ProviderUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationTokens?: number;
  outputTokens?: number;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Collect candidate JSON objects from provider stdout. Handles three shapes:
 *  - a single JSON object (optionally wrapped in markdown fences or surrounding text)
 *  - stream-json: newline-delimited JSON objects, one per line
 */
function collectJsonObjects(stdout: string): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  const push = (text: string) => {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        objects.push(parsed as Record<string, unknown>);
      }
    } catch {
      // not valid JSON on its own — ignore
    }
  };

  // Per-line (stream-json)
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) push(trimmed);
  }
  // Whole string (single object, possibly with surrounding whitespace)
  push(stdout.trim());
  // Fenced or embedded object
  const fence = stdout.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) push(fence[1].trim());
  const embedded = stdout.match(/\{[\s\S]*\}/);
  if (embedded) push(embedded[0]);

  return objects;
}

function readUsage(usage: Record<string, unknown>): ProviderUsage | null {
  const result: ProviderUsage = {};
  const input = num(usage.input_tokens);
  const cacheRead = num(usage.cache_read_input_tokens);
  const cacheCreation = num(usage.cache_creation_input_tokens);
  const output = num(usage.output_tokens);
  if (input !== undefined) result.inputTokens = input;
  if (cacheRead !== undefined) result.cachedInputTokens = cacheRead;
  if (cacheCreation !== undefined) result.cacheCreationTokens = cacheCreation;
  if (output !== undefined) result.outputTokens = output;
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parse machine-readable token usage from a provider's captured stdout.
 * Currently understands the Anthropic/Claude CLI `--output-format json`
 * envelope (a `usage` object with input_tokens / cache_read_input_tokens /
 * cache_creation_input_tokens / output_tokens). Returns null when no usage
 * can be found, so callers can fall back to `relay usage record`.
 *
 * `providerName` is reserved for future provider-specific dispatch.
 */
export function parseProviderUsage(providerName: string, stdout: string): ProviderUsage | null {
  void providerName;
  if (!stdout || !stdout.trim()) return null;
  try {
    const objects = collectJsonObjects(stdout);
    // Prefer the last object carrying a usage field (stream-json final result).
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      const usage = obj.usage;
      if (usage && typeof usage === "object" && !Array.isArray(usage)) {
        const parsed = readUsage(usage as Record<string, unknown>);
        if (parsed) return parsed;
      }
    }
    return null;
  } catch {
    return null;
  }
}
