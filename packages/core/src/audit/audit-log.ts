import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { appendFileSync } from "node:fs";

export interface AuditEvent {
  ts: string;
  event: string;
  session_id: string | null;
  v: 1;
  [key: string]: unknown;
}

const ROTATION_DROP_FRACTION = 0.2;

export function appendAuditEvent(
  logPath: string,
  fields: Omit<AuditEvent, "ts" | "v">,
  maxLines = 10_000
): void {
  const entry = { ...fields, ts: new Date().toISOString(), v: 1 as const } as AuditEvent;
  const line = JSON.stringify(entry) + "\n";

  if (existsSync(logPath)) {
    const existing = readFileSync(logPath, "utf8");
    const lines = existing.split("\n").filter(Boolean);
    if (lines.length >= maxLines) {
      const dropCount = Math.ceil(maxLines * ROTATION_DROP_FRACTION);
      const kept = lines.slice(dropCount);
      writeFileSync(logPath, kept.join("\n") + "\n");
    }
  }

  appendFileSync(logPath, line);
}

export function readAuditLog(logPath: string): AuditEvent[] {
  if (!existsSync(logPath)) return [];
  const text = readFileSync(logPath, "utf8");
  const events: AuditEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as AuditEvent);
    } catch {
      // skip malformed lines
    }
  }
  return events;
}

export function filterAuditLog(
  events: AuditEvent[],
  opts: { event?: string; session_id?: string; tail?: number } = {}
): AuditEvent[] {
  let result = events;
  if (opts.event) {
    result = result.filter(e => e.event === opts.event);
  }
  if (opts.session_id) {
    result = result.filter(e => e.session_id === opts.session_id);
  }
  if (opts.tail !== undefined && opts.tail > 0) {
    result = result.slice(-opts.tail);
  }
  return result;
}
