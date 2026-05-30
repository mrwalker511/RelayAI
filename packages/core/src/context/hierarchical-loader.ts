import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface LoadContextOptions {
  contextDir: string;
  prompt?: string;
  gitDiff?: string;
  maxBranches?: number;
}

export interface HierarchicalContext {
  trunk: string;
  branches: Record<string, string>;
  loaded: string;
}

const DOMAIN_PATTERNS: Record<string, RegExp[]> = {
  git:       [/\bgit\b/i, /\bdiff\b/i, /\bcommit\b/i, /\bdelta\b/i, /\bbranch\b/i],
  tokens:    [/\btoken\b/i, /\bbudget\b/i, /\bcost\b/i, /\bcache\b/i, /\blimit\b/i],
  memory:    [/\bmemory\b/i, /\bstate\b/i, /\bcompact\b/i, /\bgc\b/i, /\bsemantic\b/i],
  providers: [/\bprovider\b/i, /\bshell\b/i, /\bcommand\b/i, /\bexec\b/i, /\bstdin\b/i],
  config:    [/\bconfig\b/i, /\bsetting\b/i, /\.relay\b/i, /\bschema\b/i, /\bzod\b/i],
  context:   [/\bprompt\b/i, /\bpayload\b/i, /\bzone\b/i, /\bstatic.block\b/i, /\bdynamic.input\b/i],
};

function detectRelevantDomains(probe: string, maxBranches: number): string[] {
  const scores: Record<string, number> = {};
  for (const [domain, patterns] of Object.entries(DOMAIN_PATTERNS)) {
    scores[domain] = patterns.filter((p) => p.test(probe)).length;
  }
  return Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxBranches)
    .map(([domain]) => domain);
}

/**
 * Render the prompt-selected branch map into a single string. This content is
 * VOLATILE (the selected branches depend on the prompt + git diff), so callers
 * must place it in the DYNAMIC_INPUT zone — never in the cacheable STATIC_BLOCK
 * prefix.
 */
export function renderBranchSections(branches: Record<string, string>): string {
  return Object.entries(branches)
    .map(([domain, content]) => `## Branch: ${domain}\n${content}`)
    .join("\n\n");
}

export function loadHierarchicalContext(opts: LoadContextOptions): HierarchicalContext {
  const { contextDir, prompt = "", gitDiff = "", maxBranches = 3 } = opts;
  const trunkPath = join(contextDir, "trunk.md");

  const trunk = existsSync(trunkPath)
    ? readFileSync(trunkPath, "utf8")
    : "<!-- trunk.md not found: run `relay context build` to generate hierarchical context -->";

  const probe = `${prompt}\n${gitDiff}`;
  const domains = detectRelevantDomains(probe, maxBranches);

  const branchesDir = join(contextDir, "branches");
  const branches: Record<string, string> = {};

  if (existsSync(branchesDir) && domains.length > 0) {
    for (const domain of domains) {
      const branchPath = join(branchesDir, `${domain}.md`);
      if (existsSync(branchPath)) {
        branches[domain] = readFileSync(branchPath, "utf8");
      }
    }
  }

  const branchSections = renderBranchSections(branches);

  const loaded = branchSections ? `${trunk}\n\n${branchSections}` : trunk;

  return { trunk, branches, loaded };
}
