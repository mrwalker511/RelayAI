export interface AnomalyResult {
  anomalous: boolean;
  reasons: string[];
}

export function detectPromptLoop(timestamps: number[], windowMs = 60_000, maxEvents = 10): AnomalyResult {
  const now = Date.now();
  const recent = timestamps.filter((timestamp) => now - timestamp <= windowMs);
  return {
    anomalous: recent.length > maxEvents,
    reasons: recent.length > maxEvents ? [`${recent.length} prompt events occurred within ${windowMs}ms.`] : []
  };
}
