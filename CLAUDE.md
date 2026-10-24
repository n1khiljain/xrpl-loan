# CLAUDE.md

College org financing on FraxNet. Student org members sell pending ASUC reimbursement claims to a frxUSD pool on Fraxtal and settle when ASUC pays. Built by Blockchain at Berkeley in collaboration with Frax, and branded that way. Users complete KYC on https://net.frax.com, not in this app. The October 11, 2026 hackathon runs on Fraxtal mainnet with real frxUSD (U-68), rehearsed on Fraxtal testnet. `STATUS.md` has where things stand.

## Read first

| File | What it is | Rule |
|---|---|---|
| `STATUS.md` | Where the project is right now: deadlines, what's done, what's blocked and on whom, what's next | Read this first. Update it when the state changes. |
| `docs/PRD.md` | What to build and why, with requirement IDs (FR-C, FR-B, FR-A, FR-F) and invariants (I-1 to I-8) | Source of truth. Do not edit. |
| `docs/SYSTEM_DESIGN.md` | How it's built: interfaces, storage, schema, routes | Do not edit. If it conflicts with the PRD, the PRD wins; log the conflict in `UNCERTAINTIES.md`. |
| `docs/UNCERTAINTIES.md` | Every choice Frax hasn't confirmed | Append new entries. Never delete entries. |
| `docs/BRAND.md` | Co-branding rules, design tokens, voice | Do not edit. Tokens go in `apps/web/app/globals.css`. |
| `docs/GOALS.md` | The `/goal` condition for each build phase | Do not edit. |
| `docs/reference/FraxNet_Project_Overview.pdf` | The original scope from B@B and Frax | Reference only |

## Repo layout

```
.
├── CLAUDE.md
├── README.md
├── package.json                 # pnpm workspace root
├── pnpm-workspace.yaml
├── .env.example
├── .github/workflows/ci.yml
├── docs/
│   ├── PRD.md
│   ├── SYSTEM_DESIGN.md
│   ├── UNCERTAINTIES.md
│   ├── GOALS.md
│   ├── BRAND.md
│   ├── RUNBOOK.md               # phase 4
│   └── reference/FraxNet_Project_Overview.pdf
├── deployments/                 # one JSON per network, read by contracts, web, and functions
│   ├── local.json
│   ├── fraxtal-testnet.json
│   ├── sepolia.json
│   └── fraxtal.json
├── contracts/                   # Foundry project
│   ├── foundry.toml
│   ├── src/
│   │   ├── ReceivablesPool.sol
│   │   ├── ClaimRegistry.sol
│   │   ├── OrgRegistry.sol
│   │   ├── ClaimNFT.sol
│   │   ├── interfaces/
│   │   ├── libraries/ClaimTypes.sol   # enums, structs, errors, events shared across contracts
│   │   └── mocks/MockFrxUSD.sol
│   ├── script/Deploy.s.sol      # reads deployments/$NETWORK.json, writes addresses back
│   ├── test/
│   │   ├── utils/BaseTest.sol
│   │   ├── unit/
│   │   ├── fuzz/
│   │   └── invariant/           # Handler.sol + Invariants.t.sol
│   ├── audits/
│   │   ├── static-analysis.md
│   │   └── coverage.md
│   └── SECURITY.md
├── packages/
│   ├── config/                  # @app/config: zod schema + loader for deployments/*.json
│   ├── abi/                     # @app/abi: @wagmi/cli output from contracts/out
│   └── adapters/                # @app/adapters
│       ├── fraxnet/             # FraxNetClient: real + mock
│       ├── gas-sponsor/         # GasSponsor: drip + mock
│       ├── cash-out/            # CashOut: mesh + simulated
│       └── chain-reader/        # ChainReader: rpc + goldsky
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   └── functions/               # one folder per edge function, each with a Deno test
└── apps/
    └── web/                     # Next.js static export
        ├── public/brand/        # official logo files only (see docs/BRAND.md)
        ├── public/manifest.json # Safe App manifest
        ├── app/
        ├── components/
        ├── lib/
        └── e2e/                 # Playwright tests and screenshots
```

## Commands

```bash
pnpm install

# contracts
cd contracts
forge build
forge test
forge test --match-path "test/invariant/*"
forge coverage --report summary
slither .
aderyn .
anvil                                   # separate terminal
NETWORK=local forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast

# config, abi, adapters
pnpm --filter @app/config test
pnpm --filter @app/abi generate
pnpm --filter @app/adapters test

# backend
supabase start
supabase db reset
supabase functions serve
cd supabase/functions && deno test --allow-all

# web
pnpm --filter web dev
pnpm --filter web build
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web e2e
```

## Solidity rules

- `pragma solidity 0.8.28;` exactly. `evm_version = "shanghai"` in foundry.toml until Fraxtal's Cancun support is confirmed (U-35), so no transient storage and no `ReentrancyGuardTransient`.
- OpenZeppelin Contracts v5 and forge-std are the only dependencies.
- NatSpec (`@notice`, `@param`, `@return`, and `@dev` where behavior isn't obvious) on every external and public function, event, and error.
- Custom errors only. No revert strings.
- Every state change and every parameter change emits an event (FR-C16).
- Checks, effects, interactions. `nonReentrant` on every function that moves tokens. `SafeERC20` for every token call.
- No `tx.origin`, `delegatecall`, inline assembly, or upgradeable proxies.
- Amounts are frxUSD with 18 decimals. Fees round up in the pool's favor. ERC-4626 rounding follows OpenZeppelin defaults.
- Test names: `test_<function>_<case>`, `testFuzz_<function>_<case>`, `invariant_I<n>_<name>`.

## TypeScript rules

- `strict: true`. No `any`.
- viem and wagmi, not ethers.
- Addresses and ABIs come from `@app/config` and `@app/abi`. Never hand-copy an address or ABI.
- Adapters are chosen by the network config's `adapters` block. App code imports the adapter interface, never a specific implementation.
- Edge functions verify the Privy access token before doing anything. The browser never sees a Supabase service key.

## Product language

Purchase language only (U-09). Never use loan, borrow, interest, or repay in code, events, UI copy, or docs.

- Code, contracts, events, functions, and the database: sell a claim, purchase price, amount due, settle, guarantor, guaranty.
- Anything a student reads (screens, emails, README walkthrough) uses plain words (U-71): "Get reimbursed now", reimbursement, officer sign-off, "Send it to Frax", "Closed out", "Officer asked to cover". Don't say "pass it along" or "pay back". The officer's sign-off screen must still say plainly that they pay Frax what's left if ASUC never pays. The README "Words" table has the full mapping.

## When the docs don't settle something

1. Make the most reasonable choice and keep building.
2. Put the choice behind config, an admin setter, or an adapter if you can.
3. Append an entry to `docs/UNCERTAINTIES.md` in its existing format with the next free ID.
4. Tag the code: `// UNCERTAIN: U-xx`.

## Never

- Deploy or broadcast to any network except local anvil.
- Put private keys, API keys, or real `.env` values in any file.
- Edit `docs/PRD.md`, `docs/SYSTEM_DESIGN.md`, `docs/BRAND.md`, or `docs/GOALS.md`.
- Redraw, trace, or recreate the Blockchain at Berkeley or Frax logos. Use the official files in `apps/web/public/brand/`.
- Build a KYC or identity form. Verification happens on https://net.frax.com.
- Delete an entry in `docs/UNCERTAINTIES.md`.
- Put names, emails, receipts, or CalLink numbers onchain.
- Add a dependency without a one-line reason in the commit message.

## Git

- Commit after each passing checkpoint.
- Message format: `<area>: <what changed> (FR-C7, I-3)`, for example `contracts: add guaranty signature check (FR-C7)`.
