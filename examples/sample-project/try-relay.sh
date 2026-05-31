#!/usr/bin/env bash
#
# One-command RelayAI demo. No API key, no network.
#
# Copies this sample project into a fresh temporary git repo, wires up a mock
# provider that emits real Claude-style usage envelopes, and runs the full
# RelayAI flow so you can SEE measured token savings build up across calls.
#
# Usage:   ./try-relay.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RELAY_DIST="$REPO_ROOT/packages/cli/dist/index.js"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
rule() { printf "\033[2m%s\033[0m\n" "----------------------------------------------------------------------"; }

# 1. Build the RelayAI CLI if it isn't built yet.
if [ ! -f "$RELAY_DIST" ]; then
  bold "Building the RelayAI CLI (one-time)..."
  (cd "$REPO_ROOT" && pnpm build >/dev/null)
fi
RELAY=(node "$RELAY_DIST")

# 2. Copy the sample project into a fresh temp git repo.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/relay-try.XXXXXX")"
cp -r "$SCRIPT_DIR/." "$WORK/"
rm -f "$WORK/try-relay.sh"
rm -rf "$WORK/.relay"
cd "$WORK"
git init -q
git add -A
git -c user.email=demo@relay.ai -c user.name=demo -c commit.gpgsign=false commit -qm "init task-tracker" >/dev/null

bold "Sample project ready in a fresh git repo:"
echo "  $WORK"
echo

# 3. Initialize Relay and install the mock-provider config.
"${RELAY[@]}" init >/dev/null
cp relay.config.json .relay/config.json
"${RELAY[@]}" session start >/dev/null
bold "Relay session started (context anchored to the current git SHA)."

run() { echo; printf "\033[36m$ relay %s\033[0m\n" "$*"; "${RELAY[@]}" "$@"; }

echo; rule; bold "1) What Relay assembled — three zones, stable prefix first"; rule
run cache inspect --input-cost-per-million 3 --cached-input-cost-per-million 0.3

echo; rule; bold "2) Ask through the mock provider WITH --measure (3 calls)"; rule
echo "   First call writes the cache (a MISS); later calls read it (HITs)."
run ask --provider mock --measure "Explain how the priority sort works."
run ask --provider mock --measure "Add a dueDate field to the Task type."
run ask --provider mock --measure "Write a test for TaskStore.complete()."

echo; rule; bold "3) Measured savings, straight from the audit ledger"; rule
run savings --input-cost-per-million 3 --cached-input-cost-per-million 0.3 --output-cost-per-million 15

echo; rule; bold "4) The per-call ledger Relay recorded"; rule
run audit --event ask --tail 3

echo; rule
bold "Done. What you just saw:"
echo "  - Call 1 was a cache MISS (wrote the cache); calls 2-3 were HITs."
echo "  - prefix_stable flipped false -> true once the cached prefix held steady."
echo "  - 'relay savings' aggregated the REAL provider usage into dollars saved."
echo
bold "Poke around the working copy if you like:"
echo "  cd $WORK"
echo "  cat .relay/audit.log        # the structured ledger"
echo "  cat .relay/session.json     # session + prefix hashes"
echo
bold "For the estimated file-dump comparison, run from the RelayAI repo root:"
echo "  pnpm run compare -- --prompt \"Explain the priority sort\""
