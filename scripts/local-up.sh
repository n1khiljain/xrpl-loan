#!/usr/bin/env bash
# Runs the whole app on this machine so you can sign in as a demo person and click through every screen:
#   pnpm local
# Starts anvil (and deploys, keeping the chain in apps/web/e2e/.cache/anvil-state.json across restarts), local
# Supabase, and the edge functions, seeds the demo people and reimbursements (scripts/local-demo.ts), then runs the
# web dev server on http://localhost:3000. The sign-in screen lists the demo people. Ctrl-C stops what this started.
# Local anvil only (U-62).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/apps/web/e2e/.cache"
RPC="http://127.0.0.1:8545"
export PATH="$HOME/.foundry/bin:$HOME/.local/bin:/opt/homebrew/bin:$PATH"
mkdir -p "$CACHE"
cd "$ROOT"

pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

rpc() { curl -s -X POST -H 'content-type: application/json' --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}" "$RPC"; }
wait_for() {
  local what="$1" tries="$2"; shift 2
  for _ in $(seq 1 "$tries"); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done
  echo "timed out waiting for $what" >&2
  exit 1
}

# 1. the chain
if ! rpc eth_chainId '[]' | grep -q result; then
  echo "starting anvil"
  anvil --host 0.0.0.0 --port 8545 --silent --state "$CACHE/anvil-state.json" --state-interval 5 &
  pids+=($!)
  wait_for anvil 30 bash -c "curl -s -X POST -H 'content-type: application/json' --data '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_chainId\",\"params\":[]}' $RPC | grep -q result"
fi
registry="$(node -e 'console.log(require("./deployments/local.json").deployed.claimRegistry)')"
fresh_chain=0
if rpc eth_getCode "[\"$registry\",\"latest\"]" | grep -q '"result":"0x"'; then
  echo "deploying the contracts"
  (cd contracts && NETWORK=local forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast >/dev/null)
  fresh_chain=1
fi

# 2. Supabase; a new chain means the database's mirror of the old one is stale, so start it clean
supabase status >/dev/null 2>&1 || supabase start
if [ "$fresh_chain" = 1 ]; then
  echo "new chain, so resetting the local database to match"
  supabase db reset >/dev/null
fi
eval "$(supabase status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY)=')"
export SUPABASE_ANON_KEY="$ANON_KEY"

# 3. the edge functions, trusting a Privy test key kept in the cache (made once, outside git)
[ -f "$CACHE/functions.env" ] || deno run --allow-write --allow-run --config supabase/functions/deno.json supabase/functions/_tests/make-e2e-env.ts "$CACHE" >/dev/null
pkill -f "supabase functions serve" 2>/dev/null || true
echo "serving the edge functions"
supabase functions serve --env-file "$CACHE/functions.env" >"$CACHE/functions.log" 2>&1 &
pids+=($!)
wait_for "the edge functions" 180 bash -c "curl -s -X POST $API_URL/functions/v1/me | grep -q unauthorized"

# 4. demo people and reimbursements
deno run --allow-all --config supabase/functions/deno.json scripts/local-demo.ts "$CACHE" | head -1

# 5. the app
echo "open http://localhost:3000/claims/ and pick someone to sign in as"
NEXT_PUBLIC_NETWORK=local NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" NEXT_PUBLIC_PRIVY_APP_ID= \
  pnpm --filter web dev
