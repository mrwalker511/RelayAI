import { marked } from "marked";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");

// Internal .md → .html link rewrite map (relative paths as they appear in markdown)
const MD_TO_HTML: Record<string, string> = {
  "README.md": "index.html",
  "CONTRIBUTING.md": "contributing.html",
  "AGENTS.md": "agents.html",
  "CHANGELOG.md": "changelog.html",
  "SECURITY.md": "security.html",
  "docs/GETTING_STARTED.md": "getting-started.html",
  "GETTING_STARTED.md": "getting-started.html",
  "docs/USER_INSTALLATION_GUIDE.md": "user-installation-guide.html",
  "USER_INSTALLATION_GUIDE.md": "user-installation-guide.html",
  "docs/COMMANDS.md": "commands.html",
  "COMMANDS.md": "commands.html",
  "docs/CONFIGURATION.md": "configuration.html",
  "CONFIGURATION.md": "configuration.html",
  "docs/PROVIDER_ADAPTERS.md": "provider-adapters.html",
  "PROVIDER_ADAPTERS.md": "provider-adapters.html",
  "docs/MCP.md": "mcp.html",
  "MCP.md": "mcp.html",
  "docs/ARCHITECTURE.md": "architecture.html",
  "ARCHITECTURE.md": "architecture.html",
  "docs/TESTING_PLAN.md": "testing-plan-doc.html",
  "TESTING_PLAN.md": "testing-plan-doc.html",
  "docs/WALKTHROUGH.md": "walkthrough.html",
  "WALKTHROUGH.md": "walkthrough.html",
  "docs/MVP_ROADMAP.md": "mvp-roadmap.html",
  "MVP_ROADMAP.md": "mvp-roadmap.html",
  "docs/bench-prompts.md": "bench-prompts.html",
  "bench-prompts.md": "bench-prompts.html",
};

const PAGES: Array<{ src: string; out: string; label: string; group: string }> = [
  { src: join(ROOT, "README.md"),                          out: "index.html",                label: "Overview",                group: "Project" },
  { src: join(DOCS, "GETTING_STARTED.md"),                 out: "getting-started.html",      label: "Getting Started",         group: "Project" },
  { src: join(DOCS, "USER_INSTALLATION_GUIDE.md"),         out: "user-installation-guide.html", label: "Installation Guide",   group: "Project" },
  { src: join(DOCS, "WALKTHROUGH.md"),                     out: "walkthrough.html",          label: "Walkthrough",             group: "Project" },
  { src: join(DOCS, "COMMANDS.md"),                        out: "commands.html",             label: "Commands",                group: "Reference" },
  { src: join(DOCS, "CONFIGURATION.md"),                   out: "configuration.html",        label: "Configuration",           group: "Reference" },
  { src: join(DOCS, "PROVIDER_ADAPTERS.md"),               out: "provider-adapters.html",    label: "Provider Adapters",       group: "Reference" },
  { src: join(DOCS, "MCP.md"),                             out: "mcp.html",                  label: "MCP Integration",         group: "Reference" },
  { src: join(DOCS, "ARCHITECTURE.md"),                    out: "architecture.html",         label: "Architecture",            group: "Reference" },
  { src: join(DOCS, "TESTING_PLAN.md"),                    out: "testing-plan-doc.html",     label: "Testing Plan",            group: "Development" },
  { src: join(DOCS, "MVP_ROADMAP.md"),                     out: "mvp-roadmap.html",          label: "MVP Roadmap",             group: "Development" },
  { src: join(DOCS, "bench-prompts.md"),                   out: "bench-prompts.html",        label: "Bench Prompts",           group: "Development" },
  { src: join(ROOT, "CONTRIBUTING.md"),                    out: "contributing.html",         label: "Contributing",            group: "Development" },
  { src: join(ROOT, "AGENTS.md"),                          out: "agents.html",               label: "Agents Guide",            group: "Development" },
  { src: join(ROOT, "CHANGELOG.md"),                       out: "changelog.html",            label: "Changelog",               group: "Development" },
  { src: join(ROOT, "SECURITY.md"),                        out: "security.html",             label: "Security",                group: "Development" },
];

function buildNav(currentOut: string): string {
  const groups = [...new Set(PAGES.map((p) => p.group))];
  return groups
    .map((group) => {
      const items = PAGES.filter((p) => p.group === group);
      const links = items
        .map((p) => {
          const active = p.out === currentOut;
          return `<a href="${p.out}" class="nav-link${active ? " active" : ""}">${p.label}</a>`;
        })
        .join("\n        ");
      return `<div class="nav-group">
        <div class="nav-group-label">${group}</div>
        ${links}
      </div>`;
    })
    .join("\n      ");
}

function rewriteLinks(html: string): string {
  // Rewrite href="...COMMANDS.md" → href="commands.html" etc.
  return html.replace(/href="([^"]+\.md)"/g, (match, href) => {
    // Strip leading ../ or ./ prefixes for lookup
    const stripped = href.replace(/^(\.\.\/)*/, "").replace(/^\.\//, "");
    const mapped = MD_TO_HTML[stripped] ?? MD_TO_HTML[href];
    return mapped ? `href="${mapped}"` : match;
  });
}

function buildPage(title: string, navHtml: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>RelayAI — ${title}</title>
  <style>
    :root {
      --bg: #0f1117;
      --surface: #181c27;
      --surface2: #1e2333;
      --border: #2a3045;
      --accent: #4f8ef7;
      --accent2: #7c5cbf;
      --green: #22c55e;
      --red: #ef4444;
      --yellow: #f59e0b;
      --text: #e2e8f0;
      --muted: #8892a4;
      --radius: 10px;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body { background: var(--bg); color: var(--text); display: flex; flex-direction: column; min-height: 100vh; }

    /* ── Header ── */
    header {
      background: linear-gradient(135deg, #1a1f35 0%, #0f1117 100%);
      border-bottom: 1px solid var(--border);
      padding: 14px 28px;
      display: flex; align-items: center; gap: 14px;
      position: sticky; top: 0; z-index: 100;
    }
    .logo-icon {
      width: 34px; height: 34px; border-radius: 8px;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; font-weight: 800; color: #fff; flex-shrink: 0;
    }
    .logo-name { font-size: 16px; font-weight: 700; letter-spacing: -0.3px; }
    .logo-sub { font-size: 11px; color: var(--muted); margin-top: 1px; }

    /* ── Layout ── */
    .layout { display: flex; flex: 1; overflow: hidden; }

    /* ── Sidebar ── */
    nav {
      width: 220px; flex-shrink: 0;
      background: var(--surface);
      border-right: 1px solid var(--border);
      padding: 20px 0;
      overflow-y: auto;
      position: sticky; top: 57px; height: calc(100vh - 57px);
    }
    .nav-group { margin-bottom: 6px; }
    .nav-group-label {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.8px; color: var(--muted);
      padding: 10px 20px 6px;
    }
    .nav-link {
      display: block; padding: 7px 20px;
      font-size: 13px; color: var(--muted);
      text-decoration: none; transition: all 0.15s;
      border-left: 2px solid transparent;
    }
    .nav-link:hover { color: var(--text); background: var(--surface2); }
    .nav-link.active {
      color: var(--accent); border-left-color: var(--accent);
      background: rgba(79,142,247,0.08);
    }

    /* ── Content ── */
    main {
      flex: 1; overflow-y: auto;
      padding: 40px 48px 80px;
      max-width: 900px;
    }

    /* ── Markdown styles ── */
    .md h1 { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 16px; line-height: 1.25; }
    .md h2 { font-size: 20px; font-weight: 700; margin: 36px 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
    .md h3 { font-size: 16px; font-weight: 700; margin: 28px 0 10px; color: var(--text); }
    .md h4 { font-size: 14px; font-weight: 700; margin: 20px 0 8px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }

    .md p { font-size: 14px; line-height: 1.75; margin-bottom: 14px; color: var(--text); }
    .md a { color: var(--accent); text-decoration: none; }
    .md a:hover { text-decoration: underline; }

    .md ul, .md ol { padding-left: 22px; margin-bottom: 14px; }
    .md li { font-size: 14px; line-height: 1.7; margin-bottom: 4px; }
    .md li > p { margin-bottom: 4px; }

    /* task lists */
    .md ul.contains-task-list { list-style: none; padding-left: 4px; }
    .md li.task-list-item { display: flex; align-items: flex-start; gap: 8px; }
    .md li.task-list-item input[type="checkbox"] { margin-top: 4px; accent-color: var(--accent); flex-shrink: 0; }

    .md blockquote {
      border-left: 3px solid var(--accent2);
      padding: 10px 18px; margin: 18px 0;
      background: rgba(124,92,191,0.08); border-radius: 0 6px 6px 0;
      font-size: 13px; color: var(--muted);
    }
    .md blockquote p { margin-bottom: 0; color: var(--muted); }

    .md code {
      font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 12.5px; background: var(--surface2);
      border: 1px solid var(--border); border-radius: 4px;
      padding: 2px 6px; color: #a5d6ff;
    }
    .md pre {
      background: var(--surface2); border: 1px solid var(--border);
      border-radius: 8px; padding: 18px 20px; margin: 16px 0;
      overflow-x: auto;
    }
    .md pre code {
      background: none; border: none; padding: 0;
      font-size: 13px; color: #cdd9e5; line-height: 1.6;
    }

    .md table {
      width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 13px;
    }
    .md th {
      text-align: left; padding: 9px 14px;
      background: var(--surface2); color: var(--muted);
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border);
    }
    .md td { padding: 10px 14px; border-bottom: 1px solid var(--border); vertical-align: top; }
    .md tr:last-child td { border-bottom: none; }
    .md tr:hover td { background: rgba(255,255,255,0.02); }

    .md hr { border: none; border-top: 1px solid var(--border); margin: 32px 0; }

    .md img { max-width: 100%; border-radius: 8px; }

    /* badges (shields.io etc.) */
    .md img[src*="shields.io"], .md img[src*="badge"] { border-radius: 3px; }

    /* ── Responsive ── */
    @media (max-width: 700px) {
      nav { display: none; }
      main { padding: 24px 20px 60px; }
      .md h1 { font-size: 22px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="logo-icon">R</div>
    <div>
      <div class="logo-name">RelayAI</div>
      <div class="logo-sub">Docs</div>
    </div>
  </header>
  <div class="layout">
    <nav>
      ${navHtml}
    </nav>
    <main>
      <div class="md">
        ${bodyHtml}
      </div>
    </main>
  </div>
</body>
</html>`;
}

mkdirSync(DOCS, { recursive: true });

let generated = 0;
for (const page of PAGES) {  // sync loop — no top-level await needed
  const md = readFileSync(page.src, "utf8");
  const rawHtml = marked.parse(md, { async: false, gfm: true }) as string;
  const body = rewriteLinks(rawHtml);
  const nav = buildNav(page.out);
  const html = buildPage(page.label, nav, body);
  writeFileSync(join(DOCS, page.out), html, "utf8");
  console.log(`  ✓  ${page.out}`);
  generated++;
}

console.log(`\nGenerated ${generated} HTML files → docs/`);
