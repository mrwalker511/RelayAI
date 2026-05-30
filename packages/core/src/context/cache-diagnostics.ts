import { getPrefixHash } from "./prefix-hash.js";
import type { PromptZones } from "./zones.js";
import { inspectZoneTokens } from "../tokens/budget.js";
import type { TokenEstimateOptions } from "../tokens/tokenizer.js";

export interface CacheDiagnosticsInput extends PromptZones {
  sessionPrefixHash?: string;
  sessionStaticBlockHash?: string;
  sessionStateLayerHash?: string;
  session?: Record<string, unknown>;
  tokenizerOptions?: TokenEstimateOptions;
}

export interface PrefixVolatilityFinding {
  zone: "static_block" | "state_layer";
  kind: "iso_timestamp" | "git_diff" | "runtime_output" | "hierarchical_branch";
  match: string;
}

export interface CacheDiagnosticsReport {
  prefix: {
    current_hash: string;
    session_hash: string | null;
    matches_session: boolean | null;
    current_zone_hashes: {
      static_block: string;
      state_layer: string;
    };
    session_zone_hashes: {
      static_block: string | null;
      state_layer: string | null;
    };
    changed_zones: Array<"static_block" | "state_layer">;
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
  },
  {
    // Prompt-selected hierarchical branches are volatile and must live in
    // DYNAMIC_INPUT. If a "## Branch:" marker shows up in a prefix zone, the
    // cache-breaking regression has returned.
    kind: "hierarchical_branch",
    pattern: /^## Branch: /gm
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

function getZoneHash(zoneText: string): string {
  return getPrefixHash(zoneText, "");
}

function buildDriftReasons(
  matchesSession: boolean | null,
  changedZones: Array<"static_block" | "state_layer">,
  hasSessionZoneHashes: boolean,
  findings: PrefixVolatilityFinding[]
): string[] {
  const reasons: string[] = [];

  if (matchesSession === false) {
    if (hasSessionZoneHashes && changedZones.length > 0) {
      for (const zone of changedZones) {
        reasons.push(`${zone}_prefix_changed`);
      }
    } else {
      reasons.push("static_or_state_prefix_changed");
    }
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
  const currentZoneHashes = {
    static_block: getZoneHash(input.staticBlock),
    state_layer: getZoneHash(input.stateLayer)
  };
  const sessionZoneHashes = {
    static_block: input.sessionStaticBlockHash ?? null,
    state_layer: input.sessionStateLayerHash ?? null
  };
  const hasSessionZoneHashes = Boolean(sessionZoneHashes.static_block && sessionZoneHashes.state_layer);
  const changedZones: Array<"static_block" | "state_layer"> = [];
  if (sessionZoneHashes.static_block && currentZoneHashes.static_block !== sessionZoneHashes.static_block) {
    changedZones.push("static_block");
  }
  if (sessionZoneHashes.state_layer && currentZoneHashes.state_layer !== sessionZoneHashes.state_layer) {
    changedZones.push("state_layer");
  }
  const zoneTokens = inspectZoneTokens(input, input.tokenizerOptions);
  const findings = [
    ...findVolatilePrefixContent("static_block", input.staticBlock),
    ...findVolatilePrefixContent("state_layer", input.stateLayer)
  ];

  const report: CacheDiagnosticsReport = {
    prefix: {
      current_hash: currentHash,
      session_hash: sessionHash,
      matches_session: matchesSession,
      current_zone_hashes: currentZoneHashes,
      session_zone_hashes: sessionZoneHashes,
      changed_zones: changedZones,
      drift_reasons: buildDriftReasons(matchesSession, changedZones, hasSessionZoneHashes, findings)
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
