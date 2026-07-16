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
  // Rewrite href="...COMMANDS.md" → href="commands.html" etc. Repo files with
  // no generated page (e.g. .github/copilot-instructions.md) link to GitHub so
  // nothing in the rendered docs points at a nonexistent relative path.
  return html.replace(/href="([^"]+\.md)"/g, (match, href) => {
    if (/^[a-z]+:/i.test(href)) return match; // absolute URLs stay as-is
    // Strip leading ../ or ./ prefixes for lookup
    const stripped = href.replace(/^(\.\.\/)*/, "").replace(/^\.\//, "");
    const mapped = MD_TO_HTML[stripped] ?? MD_TO_HTML[href];
    return `href="${mapped ?? `https://github.com/mrwalker511/RelayAI/blob/main/${stripped}`}"`;
  });
}

// Inline SVG favicon so pages stay fully self-contained (no external requests).
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%232563eb'/%3E%3Ctext x='16' y='22' text-anchor='middle' font-family='system-ui,sans-serif' font-size='18' font-weight='700' fill='white'%3ER%3C/text%3E%3C/svg%3E";

const HERO = `<section class="hero">
        <h1 class="hero-title">Relay</h1>
        <p class="hero-tagline">Local-first context and prompt-cache optimizer for coding agents and model CLIs.</p>
        <div class="hero-chips">
          <span class="chip">MIT license</span>
          <span class="chip">Node.js &ge; 20</span>
          <span class="chip">TypeScript</span>
          <span class="chip">MCP-ready</span>
        </div>
        <div class="hero-ctas">
          <a class="btn btn-primary" href="getting-started.html">Get started</a>
          <a class="btn btn-ghost" href="walkthrough.html">Read the walkthrough</a>
        </div>
      </section>`;

// HTML replacement for the README's ASCII three-zone diagram. The zones light
// up in sequence to show how stable prefixes precede volatile input.
const ZONES_DIAGRAM = `<div class="zones" aria-label="Prompt zone layout diagram">
  <div class="zone" style="--i:0">
    <div class="zone-head"><span class="zone-name">STATIC_BLOCK</span><span class="zone-note">stable across requests</span></div>
    <p class="zone-desc">project rules, architecture notes, source snapshots</p>
  </div>
  <div class="zone" style="--i:1">
    <div class="zone-head"><span class="zone-name">STATE_LAYER</span><span class="zone-note">stable, structured</span></div>
    <p class="zone-desc">semantic memory, file index, session summary</p>
  </div>
  <div class="zone" style="--i:2">
    <div class="zone-head"><span class="zone-name">DYNAMIC_INPUT</span><span class="zone-note">volatile, always last</span></div>
    <p class="zone-desc">current prompt, git diff, runtime output, timestamp</p>
  </div>
  <div class="zone-arrow" aria-hidden="true">&darr;</div>
  <div class="zone-provider">configured provider CLI <span class="zone-note">(stdin)</span></div>
</div>`;

// Landing-only cleanup: the hero replaces the README's h1, badge row, and
// tagline blockquote; the ASCII zones diagram becomes the animated version.
function toLandingBody(body: string): string {
  return body
    .replace(/<h1[^>]*>[^]*?<\/h1>\s*/, "")
    .replace(/<p>\s*<a[^>]*>\s*<img[^]*?<\/p>\s*/, "")
    .replace(/<blockquote>\s*<p>Local-first context[^]*?<\/blockquote>\s*/, "")
    .replace(/<pre><code>[^]*?STATIC_BLOCK[^]*?<\/code><\/pre>/, ZONES_DIAGRAM);
}

function buildPage(title: string, navHtml: string, bodyHtml: string, landing: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="Relay — local-first context and prompt-cache optimizer for coding agents and model CLIs." />
  <title>RelayAI — ${title}</title>
  <link rel="icon" href="${FAVICON}" />
  <style>
    :root {
      --bg: #fbfbfa;
      --surface: #ffffff;
      --border: #e6e4df;
      --border-soft: #f0eeea;
      --ink: #1f2735;
      --muted: #6e7686;
      --accent: #2563eb;
      --accent-ink: #1d4fd7;
      --accent-soft: #eef3fe;
      --code-bg: #f4f4f1;
      --radius: 8px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      background: var(--bg); color: var(--ink);
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      display: flex; flex-direction: column; min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }
    code, pre, .zone-name {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    }

    /* ── Header ── */
    header {
      background: rgba(255,255,255,0.88); backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--border);
      padding: 0 24px; height: 56px;
      display: flex; align-items: center; gap: 12px;
      position: sticky; top: 0; z-index: 100;
    }
    .logo-icon {
      width: 30px; height: 30px; border-radius: 7px;
      background: var(--accent); color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 15px; font-weight: 700; flex-shrink: 0;
    }
    .logo-name { font-size: 15px; font-weight: 650; letter-spacing: -0.2px; }
    .logo-sub { font-size: 12px; color: var(--muted); margin-left: 2px; }
    .nav-toggle {
      display: none; margin-left: auto;
      border: 1px solid var(--border); background: var(--surface);
      border-radius: 6px; padding: 6px 10px; font-size: 13px;
      color: var(--ink); cursor: pointer;
    }

    /* ── Layout ── */
    .layout { display: flex; flex: 1; max-width: 1280px; width: 100%; margin: 0 auto; }

    /* ── Sidebar ── */
    nav {
      width: 220px; flex-shrink: 0;
      padding: 28px 0 40px;
      position: sticky; top: 56px; height: calc(100vh - 56px);
      overflow-y: auto;
      border-right: 1px solid var(--border-soft);
    }
    .nav-group { margin-bottom: 10px; }
    .nav-group-label {
      font-size: 11px; font-weight: 650; text-transform: uppercase;
      letter-spacing: 0.7px; color: var(--muted);
      padding: 10px 24px 6px;
    }
    .nav-link {
      display: block; padding: 6px 24px;
      font-size: 13.5px; color: var(--muted);
      text-decoration: none; transition: color 0.15s, background 0.15s;
      border-left: 2px solid transparent;
    }
    .nav-link:hover { color: var(--ink); }
    .nav-link.active {
      color: var(--accent-ink); border-left-color: var(--accent);
      background: var(--accent-soft); font-weight: 550;
    }

    /* ── Content ── */
    main { flex: 1; min-width: 0; padding: 44px 56px 96px; }
    .content { max-width: 760px; }

    /* ── Hero (landing page) ── */
    .hero { padding: 26px 0 10px; }
    .hero-title { font-size: 44px; font-weight: 750; letter-spacing: -1.2px; line-height: 1.1; }
    .hero-tagline { font-size: 17.5px; color: var(--muted); line-height: 1.6; margin: 14px 0 20px; max-width: 560px; }
    .hero-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 26px; }
    .chip {
      font-size: 12px; color: var(--muted);
      border: 1px solid var(--border); border-radius: 999px;
      padding: 4px 12px; background: var(--surface);
    }
    .hero-ctas { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 26px; }
    .btn {
      display: inline-block; font-size: 14px; font-weight: 550;
      border-radius: var(--radius); padding: 9px 18px;
      text-decoration: none; transition: background 0.15s, border-color 0.15s;
    }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-primary:hover { background: var(--accent-ink); }
    .btn-ghost { border: 1px solid var(--border); color: var(--ink); background: var(--surface); }
    .btn-ghost:hover { border-color: var(--muted); }

    /* ── Zones diagram (landing page) ── */
    .zones { margin: 22px 0; max-width: 560px; }
    .zone {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 13px 18px; margin-bottom: 8px;
    }
    .zone-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
    .zone-name { font-size: 13px; font-weight: 650; letter-spacing: 0.2px; }
    .zone-note { font-size: 12px; color: var(--muted); }
    .zone-desc { font-size: 13px; color: var(--muted); margin-top: 3px; line-height: 1.55; }
    .zone-arrow { text-align: center; color: var(--muted); font-size: 15px; padding: 2px 0 10px; }
    .zone-provider {
      border: 1px dashed var(--border); border-radius: var(--radius);
      padding: 11px 18px; text-align: center; font-size: 13.5px; color: var(--ink);
      background: var(--code-bg);
    }
    @media (prefers-reduced-motion: no-preference) {
      .zone { animation: zone-pulse 6s ease-in-out infinite; animation-delay: calc(var(--i) * 2s); }
      @keyframes zone-pulse {
        0%, 28%, 100% { border-color: var(--border); box-shadow: none; }
        10% { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
      }
    }

    /* ── Markdown styles ── */
    .md h1 { font-size: 30px; font-weight: 720; letter-spacing: -0.6px; margin-bottom: 16px; line-height: 1.25; }
    .md h2 { font-size: 21px; font-weight: 680; letter-spacing: -0.3px; margin: 40px 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border-soft); }
    .md h3 { font-size: 16.5px; font-weight: 650; margin: 28px 0 10px; }
    .md h4 { font-size: 13px; font-weight: 650; margin: 20px 0 8px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }

    .md p { font-size: 15px; line-height: 1.75; margin-bottom: 14px; }
    .md a { color: var(--accent-ink); text-decoration: none; }
    .md a:hover { text-decoration: underline; }
    .md strong { font-weight: 650; }

    .md ul, .md ol { padding-left: 22px; margin-bottom: 14px; }
    .md li { font-size: 15px; line-height: 1.7; margin-bottom: 4px; }
    .md li > p { margin-bottom: 4px; }

    .md ul.contains-task-list { list-style: none; padding-left: 4px; }
    .md li.task-list-item { display: flex; align-items: flex-start; gap: 8px; }
    .md li.task-list-item input[type="checkbox"] { margin-top: 5px; accent-color: var(--accent); flex-shrink: 0; }

    .md blockquote {
      border-left: 3px solid var(--accent);
      padding: 10px 18px; margin: 18px 0;
      background: var(--accent-soft); border-radius: 0 6px 6px 0;
      font-size: 14px; color: var(--ink);
    }
    .md blockquote p { margin-bottom: 0; font-size: 14px; }

    .md code {
      font-size: 13px; background: var(--code-bg);
      border: 1px solid var(--border-soft); border-radius: 5px;
      padding: 2px 6px; color: #14355f;
    }
    .md pre {
      position: relative;
      background: var(--code-bg); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 16px 18px; margin: 16px 0;
      overflow-x: auto;
    }
    .md pre code {
      background: none; border: none; padding: 0;
      font-size: 13px; color: #2a3242; line-height: 1.65;
    }
    .copy-btn {
      position: absolute; top: 8px; right: 8px;
      font-size: 11.5px; color: var(--muted);
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 6px; padding: 3px 9px; cursor: pointer;
      opacity: 0; transition: opacity 0.15s, color 0.15s;
    }
    .md pre:hover .copy-btn, .copy-btn:focus-visible { opacity: 1; }
    .copy-btn.ok { color: #157347; border-color: #157347; opacity: 1; }

    .md table { width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 13.5px; display: block; overflow-x: auto; }
    .md th {
      text-align: left; padding: 9px 14px;
      background: var(--code-bg); color: var(--muted);
      font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border);
    }
    .md td { padding: 10px 14px; border-bottom: 1px solid var(--border-soft); vertical-align: top; line-height: 1.6; }
    .md tr:last-child td { border-bottom: none; }

    .md hr { border: none; border-top: 1px solid var(--border-soft); margin: 34px 0; }
    .md img { max-width: 100%; border-radius: var(--radius); }

    /* ── On this page (right rail) ── */
    .toc {
      width: 200px; flex-shrink: 0;
      padding: 44px 20px 40px 4px;
      position: sticky; top: 56px; height: calc(100vh - 56px);
      overflow-y: auto; display: none;
    }
    .toc-label { font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.7px; color: var(--muted); margin-bottom: 8px; }
    .toc ul { list-style: none; }
    .toc a {
      display: block; font-size: 12.5px; color: var(--muted);
      text-decoration: none; padding: 4px 0 4px 10px; line-height: 1.45;
      border-left: 2px solid var(--border-soft); transition: color 0.15s;
    }
    .toc a:hover { color: var(--ink); }
    .toc a.active { color: var(--accent-ink); border-left-color: var(--accent); }
    @media (min-width: 1150px) { .toc:not([hidden]) { display: block; } }

    /* ── Entrance animation (CSS-only, content never depends on JS to show) ── */
    @media (prefers-reduced-motion: no-preference) {
      .hero > * { animation: fade-up 0.5s ease both; }
      .hero > *:nth-child(2) { animation-delay: 0.08s; }
      .hero > *:nth-child(3) { animation-delay: 0.16s; }
      .hero > *:nth-child(4) { animation-delay: 0.24s; }
      @keyframes fade-up {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: none; }
      }
    }

    /* ── Responsive ── */
    @media (max-width: 700px) {
      .nav-toggle { display: block; }
      nav {
        display: none;
        position: fixed; top: 56px; left: 0; right: 0; bottom: 0;
        width: 100%; height: auto; z-index: 90;
        background: var(--surface); border-right: none;
      }
      body.nav-open nav { display: block; }
      body.nav-open { overflow: hidden; }
      main { padding: 28px 20px 64px; }
      .hero-title { font-size: 34px; }
      .md h1 { font-size: 24px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="logo-icon" aria-hidden="true">R</div>
    <div class="logo-name">Relay<span class="logo-sub">docs</span></div>
    <button class="nav-toggle" id="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
  </header>
  <div class="layout">
    <nav id="site-nav" aria-label="Documentation">
      ${navHtml}
    </nav>
    <main>
      <div class="content">${landing ? `\n      ${HERO}` : ""}
      <div class="md">
        ${bodyHtml}
      </div>
      </div>
    </main>
    <aside class="toc" id="toc" hidden aria-label="On this page">
      <div class="toc-label">On this page</div>
      <ul></ul>
    </aside>
  </div>
  <script>
    (function () {
      "use strict";
      // Mobile nav toggle
      var toggle = document.getElementById("nav-toggle");
      if (toggle) {
        toggle.addEventListener("click", function () {
          var open = document.body.classList.toggle("nav-open");
          toggle.setAttribute("aria-expanded", open ? "true" : "false");
        });
      }

      // Heading anchors + "On this page" rail with scroll-spy
      var headings = Array.prototype.slice.call(document.querySelectorAll(".md h2"));
      headings.forEach(function (h) {
        if (!h.id) {
          h.id = h.textContent.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        }
      });
      var toc = document.getElementById("toc");
      if (toc && headings.length >= 3) {
        toc.hidden = false;
        var list = toc.querySelector("ul");
        var linkById = {};
        headings.forEach(function (h) {
          var li = document.createElement("li");
          var a = document.createElement("a");
          a.href = "#" + h.id;
          a.textContent = h.textContent;
          li.appendChild(a);
          list.appendChild(li);
          linkById[h.id] = a;
        });
        if ("IntersectionObserver" in window) {
          var current = null;
          var spy = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
              if (entry.isIntersecting) {
                if (current) current.classList.remove("active");
                current = linkById[entry.target.id];
                if (current) current.classList.add("active");
              }
            });
          }, { rootMargin: "0px 0px -75% 0px" });
          headings.forEach(function (h) { spy.observe(h); });
        }
      }

      // Copy-to-clipboard on code blocks
      Array.prototype.forEach.call(document.querySelectorAll(".md pre"), function (pre) {
        var btn = document.createElement("button");
        btn.className = "copy-btn";
        btn.type = "button";
        btn.textContent = "Copy";
        btn.addEventListener("click", function () {
          var code = pre.querySelector("code");
          var text = (code || pre).textContent;
          function done() {
            btn.textContent = "Copied";
            btn.classList.add("ok");
            setTimeout(function () { btn.textContent = "Copy"; btn.classList.remove("ok"); }, 1600);
          }
          function fallback() {
            var ta = document.createElement("textarea");
            ta.value = text;
            ta.setAttribute("readonly", "");
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand("copy"); } catch (e) { /* no-op */ }
            document.body.removeChild(ta);
            done();
          }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, fallback);
          } else {
            fallback();
          }
        });
        pre.appendChild(btn);
      });
    })();
  </script>
</body>
</html>`;
}

mkdirSync(DOCS, { recursive: true });

let generated = 0;
for (const page of PAGES) {  // sync loop — no top-level await needed
  const md = readFileSync(page.src, "utf8");
  const rawHtml = marked.parse(md, { async: false, gfm: true }) as string;
  const landing = page.out === "index.html";
  let body = rewriteLinks(rawHtml);
  if (landing) body = toLandingBody(body);
  const nav = buildNav(page.out);
  const html = buildPage(page.label, nav, body, landing);
  writeFileSync(join(DOCS, page.out), html, "utf8");
  console.log(`  ✓  ${page.out}`);
  generated++;
}

console.log(`\nGenerated ${generated} HTML files → docs/`);
