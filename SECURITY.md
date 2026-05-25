# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report security issues via [GitHub private security advisories](https://github.com/mrwalker511/relayai/security/advisories/new).

Include:
- A description of the vulnerability and its potential impact
- Steps to reproduce
- Any relevant file paths or code snippets

**Response SLA:** We aim to acknowledge reports within 72 hours and provide a fix or mitigation within 14 days for confirmed high-severity issues.

## Scope

RelayAI is a local-first CLI tool. Security considerations include:

- **Provider command injection** — commands in `.relay/config.json` are validated against a metacharacter allowlist before being passed to `spawn()`
- **Session data privacy** — `.relay/` contains project context and git history; it is excluded from git via `.gitignore` but is not encrypted at rest
- **Dependency vulnerabilities** — run `pnpm audit` to check for known CVEs in dependencies

## Out of Scope

- Attacks that require direct filesystem access to the user's machine
- Issues in provider CLIs (Claude, OpenAI, Ollama, etc.) — report those upstream
