# CLAUDE.md

Install. Businesses selectively expedite a transaction, transfer, or payment with an upfront loan from a lending vault on the XRP Ledger, paid back with interest that depends on the loan horizon. `STATUS.md` has where things stand.

## Ground rules

- **XRPL test networks only.** Today that's Devnet: it's the only network with the SingleAssetVault and LendingProtocol amendments. The config schema refuses mainnet (network ID 0). Never point anything at mainnet or use real funds.
- **No secrets in git.** Keys go in `.env` (gitignored) or Supabase secrets; `.env.example` lists every name with an empty value, and a test keeps it in sync.
- **Verify XRPL details before writing transaction code.** Check transaction names, fields, and flags against xrpl.org and the installed `xrpl` (5.3.0) types. The lending features are new.
- **Blockers stop work.** A missing key, an unclear design choice, a docs ambiguity, or a network that lacks a feature: stop and ask, with a short numbered list. Don't guess or stub silently.

## Decisions so far

| Topic | Decision |
|---|---|
| Network | XRPL Devnet (`deployments/xrpl-devnet.json`) |
| Loan asset | A stand-in "RLUSD" issued by the app's own issuer account, because RLUSD isn't on Devnet. Issuer and currency are config, so real RLUSD is a config swap. |
| Wallets | Custodial: the `me` function makes an XRPL wallet per person, encrypts the seed with `WALLET_ENCRYPTION_KEY` (AES-GCM, bound to the address), and funds it from the Devnet faucet. The browser never holds a key and never talks to the ledger. |
| Sign-in | Privy (email code or Google), sign-in only. No Privy wallets. |
| KYC | A Privy identity token proves the email, then staff approve on `/admin/kyc`. Approval is what the app will issue an XRPL Credential for. |
| Branding | The product name is Install, set in type. No third-party logos; name the network and asset in text. |
| Git | Commit each phase on `xrpl-migration`. Never push; the user pushes. |

## Repo layout

```
.
├── deployments/xrpl-devnet.json    # network, asset, terms, and the ledger objects the setup script creates (public IDs only)
├── packages/
│   ├── config/                     # @app/config: zod schema + loader for deployments/*.json
│   └── adapters/                   # @app/adapters: claim shapes, base-unit <-> XRPL amount conversion, explorer links
├── supabase/
│   ├── migrations/                 # schema: wallets, profiles, claims (lifecycle in Postgres), ledger_txs, ...
│   └── functions/                  # Deno edge functions; _shared/ has auth, db, ledger (xrpl.js), wallets (custody)
├── apps/web/                       # Next.js static export; talks only to the edge functions
├── scripts/local-up.sh             # pnpm local: Supabase + functions + demo seed + web
└── scripts/local-demo.ts           # pnpm demo: demo people with funded Devnet wallets and claims in each state
```

## Commands

```bash
pnpm install
pnpm local                                   # everything, then http://localhost:3000 with one-click demo people
supabase start && supabase db reset && supabase test db
cd supabase/functions && deno test --allow-all   # unit tests use FakeLedger; DB tests need the local stack
pnpm test && pnpm lint && pnpm typecheck
pnpm --filter web build
```

Toolchain: Node 24, pnpm 10, Deno 2, Supabase CLI 2.122+, Docker.

## Code rules

- TypeScript `strict`, no `any`. Deno functions import `xrpl` as `npm:xrpl@5.3.0` (deno.json has `nodeModulesDir: "auto"`, which the edge runtime needs).
- Amounts are integer base units of the loan asset with 6 decimals (`ASSET_DECIMALS`), as decimal strings in JSON and `numeric` in Postgres. Convert to XRPL values only at the ledger boundary (`unitsToValue` / `valueToUnits`).
- Every XRPL transaction goes through `Ledger.submit` in `supabase/functions/_shared/ledger.ts`, which records it in `ledger_txs` for explorer links.
- Edge functions verify the Privy token before anything else. The browser never sees a Supabase service key or a wallet seed.
- Claim state changes go through `db.transitionClaim` so two requests can't both apply.
- Ledger addresses and object IDs come from `@app/config`; never hand-copy them.
- Match the surrounding code's comment density and voice: comments say why, in plain sentences.
