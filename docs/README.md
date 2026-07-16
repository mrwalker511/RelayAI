# docs/

This directory holds three kinds of files. Knowing which is which matters
because two of them are generated and should never be edited by hand.

## Markdown sources (edit these)

The `UPPER_CASE.md` files (plus `bench-prompts.md`) are the canonical
documentation sources: `ARCHITECTURE.md`, `BENCHMARKS.md`, `COMMANDS.md`,
`CONFIGURATION.md`, `GETTING_STARTED.md`, `MCP.md`, `MVP_ROADMAP.md`,
`PROVIDER_ADAPTERS.md`, `TESTING_PLAN.md`, `USER_INSTALLATION_GUIDE.md`,
`WALKTHROUGH.md`.

## Generated HTML (do not edit)

The lowercase `*.html` pages are generated from the markdown sources (and from
root files like `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `CHANGELOG.md`,
`SECURITY.md`) by `scripts/gen-docs.ts`. After editing any markdown source,
regenerate and commit the HTML:

```bash
pnpm run docs   # note: "run" is required — plain `pnpm docs` hits pnpm's builtin docs command
```

The generated testing plan is `testing-plan-doc.html` (not `testing-plan.html`)
because that name is taken by the interactive tool below.

## Interactive tools (hand-maintained, not generated)

Three standalone pages are hand-built apps used by the testing workflow, not
rendered markdown:

- `testing-plan.html` — interactive testing checklist
- `relay-test-results.html` — test results tracker
- `session-compare.html` — baseline vs Relay session comparison

Edit these directly; `gen-docs.ts` never touches them.
