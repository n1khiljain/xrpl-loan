# Runbook

How to run the stack locally, deploy it to Fraxtal testnet for the October 11 pilot, and pause it if something goes wrong.

Nothing in CI or in this repo's scripts broadcasts to a public network. Every command below that sends a transaction to Fraxtal testnet is run by a person, from their own machine, with a key in Foundry's encrypted keystore. No key goes in a file in the repo.

## Local

With Docker running:

```bash
pnpm install
anvil                                   # separate terminal
cd contracts && NETWORK=local forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast && cd ..
supabase start                          # applies supabase/migrations and seed.sql
pnpm e2e                                # serves the functions and the static export, then runs Playwright
```

`pnpm e2e` (apps/web/e2e/global-setup.ts) makes a throwaway Privy test key, restarts `supabase functions serve` with it, builds the site for `local`, and serves `apps/web/out` on http://localhost:3000. Screenshots land in `apps/web/e2e/screenshots`. `E2E_SKIP_BUILD=1` reuses the last build.

### Click around locally

Real sign-in needs `NEXT_PUBLIC_PRIVY_APP_ID`. Without it, use the demo people. With Docker running:

```bash
pnpm local
```

That starts anvil (keeping the chain in `apps/web/e2e/.cache/anvil-state.json`, so a restart picks up where you left off), deploys if the chain is new, starts Supabase (resetting the database when the chain is new, so the two agree), serves the edge functions with a Privy test key kept in `apps/web/e2e/.cache`, runs `pnpm demo`, and starts the web dev server. Ctrl-C stops what it started.

Open http://localhost:3000/claims/. The sign-in screen of a `local` build lists the demo people: Jordan Park (a member with five reimbursements: waiting on the officer, in review, approved, paid, and closed out), Sam Rivera (officer of "Blockchain at Berkeley (demo)", who signed off on them), a lender with MockFrxUSD, and the pilot underwriter (anvil account 0, every admin role). Click one to sign in. Sign out to switch, or open a tab per person already signed in with `http://localhost:3000/claims/?as=claimant` (or `guarantor`, `lender`, `staff`). Sessions are per tab and last 12 hours; restart `pnpm local` for fresh ones.

`pnpm demo` on its own does the seeding against a stack that's already up. It also prints a line per person to paste into the browser console, and writes the sign-in list to `apps/web/public/local-demo-sessions.json` (gitignored). Only a `local` build reads either (U-62).

### Local backend

```bash
supabase db reset            # applies supabase/migrations and seed.sql
supabase test db             # pgTAP: RLS deny-all, drip window, constraints
```

Functions run in Docker, so they reach the host's anvil at `host.docker.internal` (`RPC_URL` in the env file). To serve them and run the backend end-to-end test, with anvil running and the local deploy done as above:

```bash
deno run --allow-write --config supabase/functions/deno.json supabase/functions/_tests/make-e2e-env.ts /tmp/fraxnet-e2e
supabase functions serve --env-file /tmp/fraxnet-e2e/functions.env
cd supabase/functions && E2E_ENV_FILE=/tmp/fraxnet-e2e/functions.env E2E_PRIVY_JWK=/tmp/fraxnet-e2e/privy-test.jwk.json deno test --allow-all
```

The env file holds a Privy key made for that run and anvil's public dev account 9 as `PAYOUT_PRIVATE_KEY`. Keep it outside the repo. Without `E2E_ENV_FILE` the e2e test is skipped, and without a running stack so are the database tests.

On Linux, Docker has no `host.docker.internal`. Replace it with the bridge gateway (`docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}'`), or set `E2E_DOCKER_HOST` to it for `pnpm e2e`. CI does both.

After changing a migration, regenerate the types the functions compile against (CI diffs them):

```bash
supabase gen types typescript --local --schema public > supabase/functions/_shared/db/database.types.ts
```

## Hosted preview (Cloudflare Worker + Supabase)

The team's temporary live site. It builds for `fraxtal-testnet`, so until the contracts are deployed (steps 2 to 5 below, waiting on the Safes) sign-in, account setup, and onboarding work, and the pool and claim pages say the contracts aren't deployed. Once step 5's commit lands on `main`, a rebuild brings those pages to life.

| | |
|---|---|
| Site | https://fraxnet-college.andrewjliu22.workers.dev |
| Supabase project | `thrroafmcnkjagkqhfjg`, https://thrroafmcnkjagkqhfjg.supabase.co |
| Privy app | "FraxNet College (testnet)", App ID `cmug4r4sn01wg0djpw3mol46q` (public; development mode, up to 150 users) |
| Function secrets | `~/fraxnet-secrets/testnet.env` on the machine that set it up, never in the repo |

It's an assets-only Cloudflare Worker (`wrangler.jsonc` at the repo root), not a Pages project: a Worker can be linked to GitHub after it exists, and a direct-upload Pages project can't. The GitHub link needs the "Cloudflare Workers and Pages" app installed on `BerkeleyBlockchain`, which only an org owner can approve.

### Privy app

1. On https://dashboard.privy.io create an app. Login methods: Email, Google, and External wallets (FR-F2, U-70). Automatically create embedded EVM wallets for users without one. The app's own sign-in screen also makes the wallet itself, since Privy only does it from its modal. Sessions last 30 days by default (User management, Authentication, Advanced), so people aren't asked for a code on every visit.
2. Allowed origins (App settings, Basics, Domains and clients): the site URL and `http://localhost:3000`. Nothing else: an origin nobody owns lets anyone use the app ID.
3. `PRIVY_APP_ID` is the App ID. `PRIVY_VERIFICATION_KEY` is the public key under "Verify with key instead" (SPKI PEM, `\n` escapes are fine). The app secret isn't used.

```bash
supabase secrets set --env-file ~/fraxnet-secrets/testnet.env --project-ref thrroafmcnkjagkqhfjg
```

### Deploy by hand

```bash
NEXT_PUBLIC_NETWORK=fraxtal-testnet \
NEXT_PUBLIC_SUPABASE_URL=https://thrroafmcnkjagkqhfjg.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<legacy anon key, Supabase project settings, API keys; public like the URL> \
NEXT_PUBLIC_PRIVY_APP_ID=cmug4r4sn01wg0djpw3mol46q \
pnpm --filter web build
npx wrangler@4 deploy
```

### Deploy on every push to main

Once the GitHub app is installed on the org: Workers & Pages, `fraxnet-college`, Settings, Builds, Git repository, GitHub, then `BerkeleyBlockchain/frax-tokenized-receivables` on branch `main`. Build command `pnpm --filter web build`, deploy command `npx wrangler deploy`, root directory `/`. Build variables: `NODE_VERSION=24`, `PNPM_VERSION=10.30.3`, and the four `NEXT_PUBLIC_*` values above. A `NEXT_PUBLIC_*` change only takes effect on the next build.

If the site URL ever changes, update `APP_BASE_URL` (it's the CORS allowlist and the base of emailed links) and Privy's allowed origins together.

### Check it

```bash
curl -sI https://fraxnet-college.andrewjliu22.workers.dev/admin/manifest.json | grep -i access-control-allow-origin
curl -s -X POST -H "apikey: <anon key>" https://thrroafmcnkjagkqhfjg.supabase.co/functions/v1/me    # 401 once Privy is set, 503 not_configured before
```

Then sign in at https://fraxnet-college.andrewjliu22.workers.dev/claims/ with your email. To make yourself staff, copy the wallet address `/onboard/` shows and run in the Supabase SQL editor:

```sql
insert into public.staff (wallet_address, role) values (lower('<wallet>'), 'underwriter');
```

### When the contracts are deployed

Finish step 7 on this project: fill `DRIP_PRIVATE_KEY` and `PAYOUT_PRIVATE_KEY` in the secrets file, set the secrets again, and create the two Vault secrets so pg_cron starts calling chain-sync every minute.

## Fraxtal testnet

| | |
|---|---|
| Chain | Fraxtal testnet, chain ID 2523 |
| RPC | https://rpc.testnet.frax.com |
| Explorer | https://hoodi.fraxscan.com |
| Safe UI | https://safe.testnet.frax.com |
| Gas faucet | https://faucet.testnet.frax.com (FRAX only) |

Everything reads `deployments/fraxtal-testnet.json`. The contracts write their addresses into it, and the functions and the site bundle it at build time, so each step below that changes it ends with a commit, and later steps run from that commit.

### 0. Before you start

Tools: Foundry 1.8.3, Node 24, pnpm 10, Supabase CLI 2.117.0, Deno 2, jq. Accounts: a Supabase project (who owns it is U-21), a Privy app, and a Resend account if you want real email.

Put each key you will sign with in Foundry's keystore. It asks for the key and a password and stores it encrypted under `~/.foundry/keystores`:

```bash
cast wallet import fraxnet-deployer --interactive
cast wallet import fraxnet-pauser --interactive       # the emergency pauser; a hardware wallet with --ledger is better
export FRAXTAL_TESTNET_RPC=https://rpc.testnet.frax.com
export DEPLOYER=$(cast wallet address --account fraxnet-deployer)
```

Make two more keys that only the edge functions hold: the gas drip wallet and the payout wallet (U-54). Save the private keys straight into the secrets file in step 7, outside the repo:

```bash
cast wallet new    # run twice: drip, payout
```

### 1. Get FRAX for gas

Open https://faucet.testnet.frax.com and request FRAX for the deployer, every Safe signer, the emergency pauser, the seeding lender (step 6), the drip wallet, and the payout wallet. Then check each one:

```bash
cast balance $DEPLOYER --ether --rpc-url $FRAXTAL_TESTNET_RPC
```

The deploy is about 10.9M gas (the dry run on 2026-09-24), a small fraction of one faucet request at testnet gas prices. The drip wallet pays for every new user's first transactions, so give it the most.

### 2. Create the testnet Safes

At https://safe.testnet.frax.com, connect a signer wallet, pick Fraxtal testnet, and create three Safes:

1. Admin Safe: sets limits, adds orgs and officers, manages the lender allowlist, unpauses.
2. Underwriter Safe: approves and rejects claims.
3. Attester Safe: calls guarantors and writes claims off.

Signers and thresholds are still open with Frax (U-13). For the pilot, use B@B signers with a 2 of 3 threshold on each unless Frax asks for a seat. The emergency pauser is a single key, not a Safe, so someone on call can pause without waiting for signatures.

Copy each Safe address. Safe URLs show it with a chain prefix (`...:0x1234...`); keep only the `0x` part. Check each exists:

```bash
cast code <safe address> --rpc-url $FRAXTAL_TESTNET_RPC     # anything but 0x
```

### 3. Fill in the role addresses

Edit `deployments/fraxtal-testnet.json`:

```json
"roles": {
  "admin": "<admin Safe>",
  "underwriter": "<underwriter Safe>",
  "attester": "<attester Safe>",
  "emergencyPauser": "<cast wallet address --account fraxnet-pauser>"
}
```

Two more fields to decide in the same edit:

- `frxUSD`. Keep `0xfc00000000000000000000000000000000000001`, Frax's real test frxUSD (U-67). Only Frax's Safe can mint it, so Frax sends test frxUSD to the seeding lender and to the payout wallet (`cast wallet address --private-key <PAYOUT_PRIVATE_KEY>`); "Simulate ASUC payout" transfers from that wallet and says `payout_empty` when it runs dry. `"frxUSD": null` deploys `MockFrxUSD` instead, which anyone can mint, if the pilot ever has to run without Frax's token.
- `nftBaseUri`. `https://<project-ref>.supabase.co/functions/v1/nft-metadata/`, with the trailing slash. Leaving it null skips it; the admin Safe can call `ClaimNFT.setBaseURI` later (U-41).

Then check the file and commit it:

```bash
pnpm --filter @app/config test
cd contracts && forge test --match-path test/unit/Deploy.t.sol && cd ..
git commit -am "deployments: set fraxtal-testnet roles"
```

In the Deploy suite, `test_runFor_fraxtalTestnetRefusesWhileCommittedConfigHasPlaceholder` now shows as skipped. It guards the placeholders you just replaced: while any role is still `SET_AFTER_SAFE_CREATED`, the deploy script stops with `RoleNotSet("<role>")` before sending anything.

### 4. Simulate the deploy

No `--broadcast`, so nothing is sent and nothing is written back to the config:

```bash
cd contracts
NETWORK=fraxtal-testnet forge script script/Deploy.s.sol --rpc-url $FRAXTAL_TESTNET_RPC --sender $DEPLOYER
```

Expect `SIMULATION COMPLETE` and 20 transactions (21 with MockFrxUSD): the four contracts, the wiring, role grants to the Safes, and the deployer renouncing its admin roles. On 2026-09-24 this ran from a dev machine against the live RPC with candidate role addresses and estimated 10,877,932 gas. With a placeholder still in the file it stops with `Error: script failed: RoleNotSet("admin")`.

If the RPC isn't reachable from your machine (a firewall, a campus network), run this step and step 5 from a machine that can reach it. `cast chain-id --rpc-url $FRAXTAL_TESTNET_RPC` should print 2523.

### 5. Deploy

A person runs this, never CI:

```bash
NETWORK=fraxtal-testnet forge script script/Deploy.s.sol --rpc-url $FRAXTAL_TESTNET_RPC --account fraxnet-deployer --broadcast
cd ..
```

It writes the addresses and the deploy block into `deployed`. Check the handoff:

```bash
export REG=$(jq -r .deployed.claimRegistry deployments/fraxtal-testnet.json)
export POOL=$(jq -r .deployed.pool deployments/fraxtal-testnet.json)
export ORGS=$(jq -r .deployed.orgRegistry deployments/fraxtal-testnet.json)
export FRXUSD=$(jq -r .deployed.frxUSD deployments/fraxtal-testnet.json)
cast call $REG "hasRole(bytes32,address)(bool)" $(cast keccak UNDERWRITER_ROLE) <underwriter Safe> --rpc-url $FRAXTAL_TESTNET_RPC   # true
cast call $REG "hasRole(bytes32,address)(bool)" $(cast keccak ATTESTER_ROLE) <attester Safe> --rpc-url $FRAXTAL_TESTNET_RPC         # true
cast call $REG "hasRole(bytes32,address)(bool)" 0x0000000000000000000000000000000000000000000000000000000000000000 $DEPLOYER --rpc-url $FRAXTAL_TESTNET_RPC   # false, renounced
cast call $POOL "registry()(address)" --rpc-url $FRAXTAL_TESTNET_RPC    # same as $REG
git add deployments/fraxtal-testnet.json && git commit -m "deployments: record fraxtal-testnet addresses"
git push
```

### 6. Seed the pool

The pool only takes deposits from allowlisted lenders (U-15).

1. Import the seeding lender's key: `cast wallet import fraxnet-lender --interactive`, then `export LENDER=$(cast wallet address --account fraxnet-lender)`.
2. Get frxUSD into that wallet. With Frax's token, Frax sends it (U-25). With MockFrxUSD, anyone can mint:
   ```bash
   cast send $FRXUSD "mint(address,uint256)" $LENDER 10000000000000000000000 --account fraxnet-lender --rpc-url $FRAXTAL_TESTNET_RPC
   ```
3. Allowlist the lender from the admin Safe. Once step 9 is done this is a button on `/admin/lenders/`. Before that, open the admin Safe's Transaction Builder app, set the address to `$POOL`, and paste the calldata:
   ```bash
   cast calldata "setLenderAllowed(address,bool)" $LENDER true
   ```
   Collect the signatures and execute.
4. Deposit, from `/lend` once the site is up, or directly:
   ```bash
   cast send $FRXUSD "approve(address,uint256)" $POOL 10000000000000000000000 --account fraxnet-lender --rpc-url $FRAXTAL_TESTNET_RPC
   cast send $POOL "deposit(uint256,address)" 10000000000000000000000 $LENDER --account fraxnet-lender --rpc-url $FRAXTAL_TESTNET_RPC
   cast call $POOL "idleCash()(uint256)" --rpc-url $FRAXTAL_TESTNET_RPC     # 10000000000000000000000
   ```

10,000 frxUSD covers four claims at the $2,500 per-claim cap. The deposit cap is 50,000 (PRD section 6).

### 7. Deploy the edge functions

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push                      # migrations only; seed.sql is local
```

Write the secrets to a file outside the repo, for example `~/fraxnet-secrets/testnet.env`. The names are the ones in `.env.example`:

```bash
NETWORK=fraxtal-testnet
PRIVY_APP_ID=<Privy dashboard, App settings>
PRIVY_VERIFICATION_KEY=<Privy dashboard, verification key, SPKI PEM; \n escapes are fine>
DRIP_PRIVATE_KEY=<drip wallet key from step 0>
DRIP_AMOUNT_WEI=2000000000000000
DRIP_THRESHOLD_WEI=200000000000000
PAYOUT_PRIVATE_KEY=<payout wallet key from step 0; only used with MockFrxUSD>
RESEND_API_KEY=<empty logs email subjects instead of sending>
EMAIL_FROM=<an address on a domain verified in Resend>
APP_BASE_URL=https://<site origin, no trailing slash>
CHAIN_SYNC_SECRET=<openssl rand -hex 32>
FRAXNET_CLIENT_ID=<FraxNet app client id from Frax>
FRAXNET_CLIENT_SECRET=<FraxNet app client secret from Frax; only ever in this file and Supabase secrets>
FRAXNET_WEBHOOK_SECRET=
```

`DRIP_THRESHOLD_WEI` matches the 0.0002 FRAX floor below which the web app asks for a top-up. Supabase sets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` itself.

```bash
supabase secrets set --env-file ~/fraxnet-secrets/testnet.env
supabase functions deploy             # every function in supabase/functions, with verify_jwt off from config.toml
```

Connect FraxNet (U-77) talks to FraxNet's staging OAuth on testnet, set in `deployments/fraxtal-testnet.json` (`fraxnet.apiBase`, `fraxnet.oauthIssuer`). Frax has to register `${APP_BASE_URL}/fraxnet/callback/` as a redirect URI for the app, matching exactly, trailing slash included. Until they do, FraxNet answers the sign-in with a redirect error and members can't connect; an underwriter can still verify them by hand at `/admin/kyc/`. To check the setup, sign in as a test member, open Verification, and press Connect FraxNet: it should land on FraxNet's sign-in, then come back to Verification showing the FraxNet account.

In the dashboard SQL editor, turn on the every-minute chain sync and add staff. A staff wallet is the one that person signs into the app with:

```sql
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/chain-sync', 'chain_sync_url');
select vault.create_secret('<CHAIN_SYNC_SECRET>', 'chain_sync_secret');
insert into public.staff (wallet_address, role) values (lower('<wallet>'), 'underwriter');
```

Check:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<project-ref>.supabase.co/functions/v1/me     # 401, token check is on
curl -s -X POST -H "authorization: Bearer <CHAIN_SYNC_SECRET>" https://<project-ref>.supabase.co/functions/v1/chain-sync
```

### 8. Publish the static site

First make sure the official logo files are in `apps/web/public/brand/` (see its README and `docs/BRAND.md`). Without them the header falls back to text and the Safe App has no icon.

```bash
NEXT_PUBLIC_NETWORK=fraxtal-testnet \
NEXT_PUBLIC_PRIVY_APP_ID=<Privy app ID> \
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from the Supabase dashboard> \
pnpm --filter web build
```

Upload `apps/web/out` to the host. Frax plans to serve it on a frax.com subdomain (U-21). For a preview on Cloudflare Pages:

```bash
npx wrangler pages deploy apps/web/out --project-name fraxnet-college
```

Any host works if it:

- serves `claim/index.html` for `/claim/` (the export uses trailing slashes, and record pages are `/claim/?id=12`)
- serves `404.html` for unknown paths
- sends `Access-Control-Allow-Origin: *` on `/manifest.json`, `/admin/manifest.json`, and `/brand/*`, so the Safe UI can load the Safe App. `public/_headers` does this on Cloudflare Pages and Netlify

Then point the backend at the site: `APP_BASE_URL` must be the exact origin (it's the CORS allowlist and the base of emailed links), and Privy's allowed origins must include it.

```bash
supabase secrets set APP_BASE_URL=https://<site origin>
curl -sI https://<site origin>/admin/manifest.json | grep -i access-control-allow-origin
```

Open the site. The testnet banner is off for now (`features.testnetBanner`, U-66); turn it on before anyone outside the team uses it.

### 9. Register the Safe App

In https://safe.testnet.frax.com, open the admin Safe, then Apps, then My custom apps, then Add custom Safe App. Paste `https://<site origin>/admin/`. The Safe UI reads `/admin/manifest.json` and shows "B@B x Frax College Admin" (U-64). Custom apps are saved per browser, so every signer adds it once, and it works from the underwriter and attester Safes too.

Check it: open the app inside a Safe, sign in, and the review queue's buttons say "Propose in Safe". Outside a Safe, the same pages show "Open in Frax Safe" and a Transaction Builder JSON download. If Frax's Safe UI won't load a custom app (U-27), signers download the JSON and import it in the built-in Transaction Builder app.

### 10. Onboard a pilot org

1. Every officer signs in at `https://<site origin>/onboard/`, sets their name, finishes KYC on https://net.frax.com, and presses "Connect FraxNet" so the app can see it (U-77). Start by October 6; Persona takes 1 to 3 business days.
2. Where FraxNet can't answer (mainnet for now, or before Frax registers the redirect URI), an underwriter confirms each officer's status with Frax and records it at `/admin/kyc/` (U-36).
3. In the admin Safe, open the Safe App at `/admin/orgs/`. Propose "Add org" with the org's name as ASUC lists it, and after it executes, "Set officer" for each officer's wallet with the org number it shows. Signers approve in the Safe.
4. Orgs start on the default `perOrgCap` of 10,000 outstanding. To give one org its own cap, type it in "Org cap ($)" on that org's card and propose it; 0 puts the org back on the default (U-69). Blockchain at Berkeley gets 50,000.
5. Within a minute chain-sync mirrors the org. Check: `cast call $ORGS "orgCount()(uint256)" --rpc-url $FRAXTAL_TESTNET_RPC` went up, and a member sees the org in the first step of `/claims/new/`.
6. Walk one real reimbursement through the whole flow before the pilot (M4 dry run): sell, guarantee, approve, get paid, simulate the ASUC payout, settle.

### 11. Pause in an emergency

The emergency pauser can pause right away:

```bash
cast send $REG "pause()" --account fraxnet-pauser --rpc-url $FRAXTAL_TESTNET_RPC
cast call $REG "paused()(bool)" --rpc-url $FRAXTAL_TESTNET_RPC      # true
```

The admin Safe can pause too: Transaction Builder, address `$REG`, calldata `0x8456cb59` (`cast calldata "pause()"`).

Pausing stops new submissions, approvals, purchases, and deposits. `settle`, `withdraw`, and `redeem` stay open, so people can still pay what they owe and lenders can take out idle cash (U-26).

Then, depending on what went wrong:

- Gas drip key exposed: `supabase secrets unset DRIP_PRIVATE_KEY` stops the drip. Move what's left out of that wallet, make a new key, and set it again.
- A function misbehaving: `supabase functions delete <name>` takes it down; redeploy the fixed version with `supabase functions deploy <name>`.
- Pauser key exposed: the admin Safe revokes it with calldata from `cast calldata "revokeRole(bytes32,address)" $(cast keccak PAUSER_ROLE) <old key>` on `$REG`, then grants the new key with `grantRole`.

Only the admin Safe can unpause, after the fix: Transaction Builder, address `$REG`, calldata `0x3f4ba83a` (`cast calldata "unpause()"`). Nothing is upgradeable (U-03), so a contract bug means pausing, deploying new contracts, and moving lenders over.

### 12. Permanently close the pool and withdraw emergency cash (U-80)

This procedure is for a newly deployed pool that includes `activateEmergencyMode`; existing deployments cannot gain it through a configuration change. Emergency mode is permanent. The emergency pauser still uses step 11 for the immediate reversible stop; only the pool's admin Safe can activate permanent closeout. It works without the registry being available or paused, and blocks purchases at the pool even if someone later unpauses the registry.

1. Confirm the pool address, chain, and shareholder wallets. Anyone who already exited before closeout has no emergency entitlement. Pause the registry as in step 11 when possible, so members stop submitting requests that cannot be funded.
2. In the admin Safe's Transaction Builder, target `$POOL` with the calldata from `cast calldata "activateEmergencyMode()"`. The call permanently closes deposits, purchases, ordinary withdrawals/redemptions, and share transfers. There is no restart switch. Read `cast call $POOL "emergencyMode()(bool)" --rpc-url $RPC` to confirm `true`.
3. For each shareholder wallet, read `cast call $POOL "maxEmergencyWithdraw(address)(uint256)" <shareholder> --rpc-url $RPC`. This is that wallet's current frxUSD entitlement, with 18 decimals. If Frax owns every share, it can claim all idle cash. If there are multiple holders, each receives its fixed proportion, irrespective of who claims first. The one exception is frxUSD leaving the pool some other way (the frxUSD owner freezing or burning it, D-1): then the entitlement is capped at what the pool holds, and whoever claims first gets it.
4. From the shareholder wallet itself, call the pool's `emergencyWithdraw(address)` with the destination wallet. For a lender Safe, import the generated `ReceivablesPool` ABI into Transaction Builder and use the calldata from `cast calldata "emergencyWithdraw(address)" <destination>`. The destination cannot be zero or the pool. No token allowance is needed. Only the shareholder can claim its entitlement; the admin cannot claim another wallet's funds. Use this function after activation; the normal web withdrawal flow is closed.
5. As ASUC and guarantors settle claims, repeat steps 3 and 4. The same share balance remains in the shareholder's wallet as evidence of its rights to all later payments, including after write-offs. Do not promise immediate access to cash already paid to claimants: it only becomes available if someone settles. There is no need to keep 1 frxUSD inside the pool in emergency mode.

Before activation, regular withdrawals and the U-79 last-share risk still apply. Closeout cannot restore ownership after every share has already been redeemed, recover a lost shareholder key, bypass a token freeze, or fix every possible pool bug. With multiple holders, rounding can leave less than one frxUSD wei per holder until further receipts arrive. Continue monitoring outstanding and written-off claims after moving operations to a new deployment.

## Fraxtal mainnet (October 11 hackathon)

The hackathon is the first live use, with real frxUSD (U-68). Testnet stays as the rehearsal: do the full dry run there first, then repeat the steps above on mainnet with these differences.

| | |
|---|---|
| Chain | Fraxtal, chain ID 252 |
| RPC | https://rpc.frax.com |
| Explorer | https://fraxscan.com |
| Safe UI | https://safe.mainnet.frax.com |
| Config | `deployments/fraxtal.json`, `NETWORK=fraxtal` |

- Gas: no faucet. The deployer, pauser, and gas-drip wallets need real FRAX. The testnet deploy used about 0.00001 FRAX, so a little goes a long way, but the drip wallet pays every new member's first gas.
- Safes: three new 2-of-3 Safes on https://safe.mainnet.frax.com. Testnet Safes don't carry over.
- `deployments/fraxtal.json` won't load until `fraxnet.apiBase` and `fraxMesh` are set, and `pnpm --filter @app/config test` says so. Both come from Frax. If the partner API isn't ready, underwriters record KYC by hand at `/admin/kyc/` (U-07), but the adapter choice still needs a decision with Frax first. The chain reader is `rpc` until a Goldsky subgraph exists.
- Terms are the same as testnet: 2,500 per claim, 10,000 per org, 50,000 pool deposit cap, fee 0. After adding Blockchain at Berkeley, the admin Safe sets its cap to 50,000 from `/admin/orgs/` (testnet step 10), or with Transaction Builder on `$REG` and `cast calldata "setOrgCap(uint64,uint128)" <orgId> 50000000000000000000000`.
- Deploy with the same dry run and the same single `--broadcast` by Andrew, with `NETWORK=fraxtal` and `--rpc-url https://rpc.frax.com`. Never from CI or an agent.
- Seed: Frax deposits real frxUSD from its own address after the admin Safe allowlists it. The hackathon target needs at least 10,000 idle. The full procedure is "Seeding the pool with Frax's 40,000" below.
- `simulateAsucPayout` is off, so there's no payout wallet and no "Simulate ASUC payout" button. ASUC pays the member and they settle from the claim page.
- Backend: a separate Supabase project for mainnet, with `NETWORK=fraxtal` and a fresh set of secrets. The free plan allows two active projects.
- Sign-in: a production Privy app, not the testnet one in dev mode (150 users). Add the mainnet site's origin to it.
- Site: a second Worker, so testnet keeps its URL: build with `NEXT_PUBLIC_NETWORK=fraxtal` and the mainnet Supabase and Privy values, then `npx wrangler@4 deploy --name fraxnet-college-mainnet`.
- The banner flag, `features.testnetBanner`, has no effect on mainnet, since testnet is decided by the chain ID and chain 252 is mainnet.

### Seeding the pool with Frax's 40,000

Frax is the only lender for now, and the pool takes deposits only from allowlisted addresses (U-15). Adding another lender later is one admin Safe transaction (`setLenderAllowed`), with no contract change. Rehearse every step on a fork first, against Fraxtal's real frxUSD; nothing is broadcast:

```bash
cd contracts && FRAXTAL_RPC_URL=https://rpc.frax.com forge test --match-path "test/fork/*" -vv
```

`test/fork/FraxtalPilot.fork.t.sol` runs this exact sequence (10 frxUSD in and out, then 40,000), buys claims until the pool is empty, settles most, writes two off, and redeems Frax's whole position.

Set these first: `POOL` and `REG` from `deployments/fraxtal.json`, `FRXUSD=0xFc00000000000000000000000000000000000001`, `FRAX=<the address Frax deposits from>`, `RPC=https://rpc.frax.com`.

1. Read-only checks. Every line must print what the comment says before anyone sends money:
   ```bash
   cast call $POOL "asset()(address)" --rpc-url $RPC                 # $FRXUSD
   cast call $POOL "registry()(address)" --rpc-url $RPC              # $REG
   cast call $POOL "depositCap()(uint256)" --rpc-url $RPC            # 50000000000000000000000
   cast call $POOL "allowlistEnabled()(bool)" --rpc-url $RPC         # true
   cast call $REG "paused()(bool)" --rpc-url $RPC                    # false
   cast call $POOL "totalSupply()(uint256)" --rpc-url $RPC           # 0, nobody deposited first
   ```
2. The admin Safe allowlists Frax: Transaction Builder on `$POOL` with `cast calldata "setLenderAllowed(address,bool)" $FRAX true`. Then `cast call $POOL "isLenderAllowed(address)(bool)" $FRAX --rpc-url $RPC` prints `true`.
3. Rehearsal with 10 frxUSD from `$FRAX`, as one Safe batch or three transactions: `approve($POOL, 10e18)`, `deposit(10e18, $FRAX)`, `redeem(<shares>, $FRAX, $FRAX)`. Calldata:
   ```bash
   cast calldata "approve(address,uint256)" $POOL 10000000000000000000            # on $FRXUSD
   cast calldata "deposit(uint256,address)" 10000000000000000000 $FRAX            # on $POOL; mints 10000000000000000000000000 shares
   cast calldata "redeem(uint256,address,address)" 10000000000000000000000000 $FRAX $FRAX   # on $POOL
   ```
   Frax's frxUSD balance ends exactly where it started.
4. The real deposit, approving exactly 40,000 rather than an unlimited amount:
   ```bash
   cast calldata "approve(address,uint256)" $POOL 40000000000000000000000         # on $FRXUSD
   cast calldata "deposit(uint256,address)" 40000000000000000000000 $FRAX         # on $POOL
   cast call $POOL "idleCash()(uint256)" --rpc-url $RPC                           # 40000000000000000000000
   cast call $POOL "maxWithdraw(address)(uint256)" $FRAX --rpc-url $RPC           # 40000000000000000000000
   ```
   Shares carry 24 decimals (frxUSD's 18 plus the pool's 6-decimal guard against first-deposit share inflation), so 40,000 frxUSD is `40000000000000000000000000000` shares.
5. Getting it back: Frax can withdraw up to `maxWithdraw($FRAX)` at any time, which is the idle cash; money out in purchased claims comes back as ASUC and guarantors pay. Withdrawals stay open even while the registry is paused (U-26).
6. Leaving completely: keep at least 1 frxUSD of shares while any written-off claim could still be paid, because an officer can still pay a written-off claim and that money only reaches a lender who holds shares (U-79). Once nothing more is expected, redeem the whole balance: `redeem(balanceOf($FRAX), $FRAX, $FRAX)`. Before that, withdraw everything but the last 1 frxUSD:
   ```bash
   cast call $POOL "maxWithdraw(address)(uint256)" $FRAX --rpc-url $RPC           # then withdraw that minus 1000000000000000000
   ```

