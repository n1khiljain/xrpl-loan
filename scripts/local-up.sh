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

# 2. the edge functions. By default they trust a Privy test key kept in the cache (made once, outside git), which the
# demo people's tokens are signed with. With a real Privy app in .env (PRIVY_APP_ID and NEXT_PUBLIC_PRIVY_APP_ID, and
# optionally PRIVY_VERIFICATION_KEY; without it the app's published keys are used), they trust that instead, so Google
# and email sign-in work and the demo people don't.
[ -f "$CACHE/functions.env" ] || deno run --allow-write --allow-run --config supabase/functions/deno.json supabase/functions/_tests/make-e2e-env.ts "$CACHE" >/dev/null
envval() { [ -f .env ] && grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }
PRIVY_APP="$(envval PRIVY_APP_ID)"; PRIVY_KEY="$(envval PRIVY_VERIFICATION_KEY)"; WEB_PRIVY_APP="$(envval NEXT_PUBLIC_PRIVY_APP_ID)"
FUNCTIONS_ENV="$CACHE/functions.env"
if [ -n "$PRIVY_APP" ] && [ -n "$WEB_PRIVY_APP" ]; then
  echo "using the Privy app from .env: Google and email sign-in on, demo people off"
  FUNCTIONS_ENV="$CACHE/functions.privy.env"
  {
    grep -vE '^PRIVY_(APP_ID|VERIFICATION_KEY)=' "$CACHE/functions.env"
    echo "PRIVY_APP_ID=$PRIVY_APP"
    [ -n "$PRIVY_KEY" ] && echo "PRIVY_VERIFICATION_KEY=$PRIVY_KEY"
  } >"$FUNCTIONS_ENV"
  DEMO=false
else
  WEB_PRIVY_APP=""
  DEMO=true
fi
pkill -f "supabase functions serve" 2>/dev/null || true
echo "serving the edge functions"
supabase functions serve --env-file "$FUNCTIONS_ENV" >"$CACHE/functions.log" 2>&1 &
pids+=($!)
wait_for "the edge functions" 180 bash -c "curl -s -X POST $API_URL/functions/v1/me | grep -q unauthorized"

# 3. demo people and reimbursements (each new person's wallet is funded on XRPL Devnet)
if [ "$DEMO" = true ]; then
  echo "seeding demo people on XRPL Devnet"
  deno run --allow-all --config supabase/functions/deno.json scripts/local-demo.ts "$CACHE"
fi

# 4. the app
echo "open http://localhost:3000/claims/"
NEXT_PUBLIC_NETWORK=xrpl-devnet NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" NEXT_PUBLIC_PRIVY_APP_ID="$WEB_PRIVY_APP" \
  NEXT_PUBLIC_DEMO_SESSIONS="$DEMO" pnpm --filter web dev
