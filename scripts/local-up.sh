#!/usr/bin/env bash
# Runs the whole app on this machine so you can sign in as a demo person and click through every screen:
#   pnpm local
# Starts local Supabase and the edge functions, seeds the demo people and reimbursements (scripts/local-demo.ts),
# then runs the web dev server on http://localhost:3000. The ledger is XRPL Devnet: each demo person gets a
# custodial wallet funded by the Devnet faucet. Ctrl-C stops what this started.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/apps/web/e2e/.cache"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$HOME/.deno/bin:$PATH"
mkdir -p "$CACHE"
cd "$ROOT"

pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

wait_for() {
  local what="$1" tries="$2"; shift 2
  for _ in $(seq 1 "$tries"); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done
  echo "timed out waiting for $what" >&2
  exit 1
}

# 1. Supabase (a stack that's still booting answers "not ready", so wait for it rather than starting twice)
supabase status >/dev/null 2>&1 || supabase start || true
wait_for "Supabase" 120 supabase status
eval "$(supabase status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY)=')"

# 2. the edge functions, trusting a Privy test key and a wallet key kept in the cache (made once, outside git)
[ -f "$CACHE/functions.env" ] || deno run --allow-write --allow-run --config supabase/functions/deno.json supabase/functions/_tests/make-e2e-env.ts "$CACHE" >/dev/null
pkill -f "supabase functions serve" 2>/dev/null || true
echo "serving the edge functions"
supabase functions serve --env-file "$CACHE/functions.env" >"$CACHE/functions.log" 2>&1 &
pids+=($!)
wait_for "the edge functions" 180 bash -c "curl -s -X POST $API_URL/functions/v1/me | grep -q unauthorized"

# 3. demo people and reimbursements (each new person's wallet is funded on XRPL Devnet)
echo "seeding demo people on XRPL Devnet"
deno run --allow-all --config supabase/functions/deno.json scripts/local-demo.ts "$CACHE"

# 4. the app
echo "open http://localhost:3000/claims/ and pick someone to sign in as"
NEXT_PUBLIC_NETWORK=xrpl-devnet NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" NEXT_PUBLIC_PRIVY_APP_ID= \
  NEXT_PUBLIC_DEMO_SESSIONS=true pnpm --filter web dev
