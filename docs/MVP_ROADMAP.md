# MVP Roadmap

## MVP 1: Inspectable Context Builder

Goal: Make Relay useful without provider integration.

Deliverables:

- `relay init`
- `relay session start`
- `.relay/session.json`
- `.relay/config.json`
- deterministic three-zone payload builder
- `relay ask` prints assembled payload
- `relay tokens estimate`
- `relay cache fingerprint`
- `relay diff`

Acceptance criteria:

- Running `relay ask` produces the same static and state zone order every time.
- Dynamic git diff appears only in the dynamic zone.
- Prefix hash changes only when static block or state layer changes.

## MVP 2: Real Token Guardrails

Goal: Prevent accidental runaway token usage.

Deliverables:

- zone-by-zone token counts
- interactive warning prompt
- hard block above token limit
- `relay tokens inspect`
- anomaly detection for rapid repeated calls

Acceptance criteria:

- Relay refuses payloads above hard limit.
- Relay offers Context GC when payload exceeds confirmation threshold.

## MVP 3: Context GC

Goal: Replace raw session history with compact semantic state.

Deliverables:

- `relay gc run`
- `relay gc preview`
- `relay gc restore`
- snapshot old compacted summaries
- preserve errors, decisions, code changes, and next actions

Acceptance criteria:

- Raw session history can be compacted into `.relay/memory/semantic-state.json`.
- Compaction does not delete prior state without a restore path.

## MVP 4: Provider Wrappers

Goal: Route Relay payloads into existing coding assistants.

Deliverables:

- Codex CLI adapter
- Claude Code adapter
- Copilot CLI adapter
- provider command templates in config
- dry-run mode

Acceptance criteria:

- User can run `relay ask --provider codex "..."`.
- Relay shows token estimate before provider execution.

## MVP 5: Cache Diagnostics

Goal: Make cache behavior visible.

Deliverables:

- `relay cache inspect`
- `relay cache warm`
- prefix stability report
- static/state/dynamic token split
- cache hit-rate assumptions in cost estimator

Acceptance criteria:

- Relay explains what changed between two prefix hashes.
- Relay identifies dynamic content accidentally placed in prefix zones.
