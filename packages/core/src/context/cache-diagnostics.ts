import { getPrefixHash } from "./prefix-hash.js";
import type { PromptZones } from "./zones.js";
import { inspectZoneTokens } from "../tokens/budget.js";

export interface CacheDiagnosticsInput extends PromptZones {
  sessionPrefixHash?: string;
  session?: Record<string, unknown>;
}

export interface PrefixVolatilityFinding {
  zone: "static_block" | "state_layer";
  kind: "iso_timestamp" | "git_diff" | "runtime_output";
  match: string;
}

export interface CacheDiagnosticsReport {
  prefix: {
    current_hash: string;
    session_hash: string | null;
    matches_session: boolean | null;
    drift_reasons: string[];
  };
  zones: {
    static_block: number;
    state_layer: number;
    dynamic_input: number;
    total: number;
  };
  findings: {
    dynamic_content_in_prefix: PrefixVolatilityFinding[];
  };
  session?: Record<string, unknown>;
}

const VOLATILE_PATTERNS: Array<{
  kind: PrefixVolatilityFinding["kind"];
  pattern: RegExp;
}> = [
  {
    kind: "iso_timestamp",
    pattern: /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z\b/g
  },
  {
    kind: "git_diff",
    pattern: /^(?:diff --git|--- |\+\+\+ )/gm
  },
  {
    kind: "runtime_output",
    pattern: /(?:^\s+at\s+\S+|^(?:Error:|AssertionError|Test Results|FAIL|PASS)\b)/gm
  }
];

function findVolatilePrefixContent(zone: "static_block" | "state_layer", text: string): PrefixVolatilityFinding[] {
  return VOLATILE_PATTERNS.flatMap(({ kind, pattern }) => {
    const findings: PrefixVolatilityFinding[] = [];
    for (const match of text.matchAll(pattern)) {
      findings.push({ zone, kind, match: match[0] });
    }
    return findings;
  });
}

function buildDriftReasons(matchesSession: boolean | null, findings: PrefixVolatilityFinding[]): string[] {
  const reasons: string[] = [];

  if (matchesSession === false) {
    reasons.push("static_or_state_prefix_changed");
  }

  const affectedZones = new Set(findings.map((finding) => finding.zone));
  for (const zone of affectedZones) {
    reasons.push(`volatile_content_in_${zone}`);
  }

  return reasons;
}

export function inspectCacheDiagnostics(input: CacheDiagnosticsInput): CacheDiagnosticsReport {
  const currentHash = getPrefixHash(input.staticBlock, input.stateLayer);
  const sessionHash = input.sessionPrefixHash ?? null;
  const matchesSession = sessionHash ? currentHash === sessionHash : null;
  const zoneTokens = inspectZoneTokens(input);
  const findings = [
    ...findVolatilePrefixContent("static_block", input.staticBlock),
    ...findVolatilePrefixContent("state_layer", input.stateLayer)
  ];

  const report: CacheDiagnosticsReport = {
    prefix: {
      current_hash: currentHash,
      session_hash: sessionHash,
      matches_session: matchesSession,
      drift_reasons: buildDriftReasons(matchesSession, findings)
    },
    zones: {
      static_block: zoneTokens.staticBlock,
      state_layer: zoneTokens.stateLayer,
      dynamic_input: zoneTokens.dynamicInput,
      total: zoneTokens.total
    },
    findings: {
      dynamic_content_in_prefix: findings
    }
  };

  if (input.session) {
    report.session = input.session;
  }

  return report;
}
