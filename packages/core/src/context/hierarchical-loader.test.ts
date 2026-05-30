import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadHierarchicalContext, renderBranchSections } from "./hierarchical-loader.js";

function makeTempContextDir(): string {
  const dir = join(tmpdir(), `relay-hc-test-${Date.now()}`);
  mkdirSync(join(dir, "branches"), { recursive: true });
  return dir;
}

test("returns placeholder when contextDir does not exist", () => {
  const result = loadHierarchicalContext({ contextDir: "/nonexistent/path/relay-test" });
  assert.ok(result.trunk.includes("trunk.md not found"), "should include hint to run relay context build");
  assert.equal(Object.keys(result.branches).length, 0);
  assert.ok(result.loaded.length > 0);
});

test("loads trunk.md when present", () => {
  const dir = makeTempContextDir();
  try {
    writeFileSync(join(dir, "trunk.md"), "# Trunk Content");
    const result = loadHierarchicalContext({ contextDir: dir });
    assert.equal(result.trunk, "# Trunk Content");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detects relevant domains from prompt and loads matching branches", () => {
  const dir = makeTempContextDir();
  try {
    writeFileSync(join(dir, "trunk.md"), "# Trunk");
    writeFileSync(join(dir, "branches", "tokens.md"), "# Token Budget Details");
    writeFileSync(join(dir, "branches", "git.md"), "# Git Delta Details");

    const result = loadHierarchicalContext({
      contextDir: dir,
      prompt: "how does the token budget work?",
      maxBranches: 3,
    });

    assert.ok("tokens" in result.branches, "should load tokens branch for token-related prompt");
    assert.ok(result.loaded.includes("Token Budget Details"), "loaded should include branch content");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("does not load unrelated branches", () => {
  const dir = makeTempContextDir();
  try {
    writeFileSync(join(dir, "trunk.md"), "# Trunk");
    writeFileSync(join(dir, "branches", "providers.md"), "# Provider Details");

    const result = loadHierarchicalContext({
      contextDir: dir,
      prompt: "what is the token budget?",
      maxBranches: 3,
    });

    assert.ok(!("providers" in result.branches), "should not load unrelated providers branch");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("respects maxBranches cap", () => {
  const dir = makeTempContextDir();
  try {
    writeFileSync(join(dir, "trunk.md"), "# Trunk");
    for (const domain of ["git", "tokens", "memory", "config", "context"]) {
      writeFileSync(join(dir, "branches", `${domain}.md`), `# ${domain}`);
    }

    const result = loadHierarchicalContext({
      contextDir: dir,
      prompt: "git diff token budget memory state config context zone",
      maxBranches: 2,
    });

    assert.ok(Object.keys(result.branches).length <= 2, "should not exceed maxBranches");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderBranchSections renders one labeled section per branch", () => {
  const rendered = renderBranchSections({ tokens: "Token Details", git: "Git Details" });
  assert.ok(rendered.includes("## Branch: tokens\nToken Details"));
  assert.ok(rendered.includes("## Branch: git\nGit Details"));
});

test("renderBranchSections returns empty string for no branches", () => {
  assert.equal(renderBranchSections({}), "");
});

test("returns trunk only when no branches match", () => {
  const dir = makeTempContextDir();
  try {
    writeFileSync(join(dir, "trunk.md"), "# Trunk Only");
    const result = loadHierarchicalContext({ contextDir: dir, prompt: "hello world" });
    assert.equal(result.loaded, "# Trunk Only");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
