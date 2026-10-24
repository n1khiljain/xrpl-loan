# Build goals for Claude Code

Paste one goal per Claude Code session, in order. Each goal is a `/goal` condition: Claude keeps working turn after turn until a separate evaluator model reads the conversation and confirms every numbered item is met.

## How to run

- Start Claude Code in the repo root in auto mode, so tool calls don't stop for approval.
- Start a fresh session for each phase (or run `/clear` first). The docs carry the context between phases, not the chat history.
- The evaluator only reads the conversation. It can't run commands, so every condition asks Claude to show command output.
- Check progress with `/goal`. Stop early with `/goal clear`.
- After each phase, read the new entries in `docs/UNCERTAINTIES.md` before starting the next one.

---

## Phase 1: scaffold and contracts

```text
/goal Phase 1: scaffold the monorepo and build the contracts package to spec. Before writing code, read CLAUDE.md, docs/PRD.md, docs/SYSTEM_DESIGN.md, and docs/UNCERTAINTIES.md. The spec is PRD sections 6, 7, 9 (FR-C1 to FR-C18), 10, 12, and 13, plus the contracts section of SYSTEM_DESIGN.md.

Done when all of these are shown in this conversation:
1. The repo tree matches the layout in CLAUDE.md (empty apps and packages get a package.json only), and `pnpm install` exits 0.
2. deployments/local.json, fraxtal-testnet.json, sepolia.json, and fraxtal.json exist with the params and addresses from PRD sections 6 and 10.
3. `forge build` in contracts/ exits 0 with no compiler warnings.
4. `forge test` exits 0, and its output includes unit tests for every transition in the PRD section 7 table and every revert path, named test_<function>_<case>.
5. Invariant tests invariant_I1 through invariant_I8 match PRD section 13, run through a handler contract with at least 256 runs and depth 50, and pass.
6. `forge coverage --report summary` shows 100% lines and at least 95% branches for every file in contracts/src except mocks, or each uncovered line is listed with a reason in contracts/audits/coverage.md.
7. `slither .` and `aderyn .` have been run in contracts/, and every finding is fixed or triaged in contracts/audits/static-analysis.md.
8. With anvil running, `NETWORK=local forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast` exits 0 and writes deployed addresses into deployments/local.json.
9. contracts/SECURITY.md lists every role, what it can call, and every trust assumption in PRD section 12.
10. A final table in the conversation maps each of FR-C1 to FR-C18 to the source file and the test names that cover it.

Constraints:
- Dependencies are OpenZeppelin Contracts v5 and forge-std only.
- Do not edit docs/PRD.md or docs/SYSTEM_DESIGN.md. For any judgment call the docs don't settle, append an entry to docs/UNCERTAINTIES.md in its existing format and tag the code `// UNCERTAIN: U-xx`.
- Purchase language only: no function, event, error, or variable named with loan, borrow, interest, or repay.
- No upgradeable proxies. No deploys anywhere except local anvil. No private keys or secrets in any file.
- Commit after each item that passes, with the FR or item IDs in the message.
- Or stop after 80 turns and print which numbered items remain.
```

## Phase 2: config, adapters, and backend

```text
/goal Phase 2: build packages/config, packages/abi, packages/adapters, and supabase/ to spec. Read CLAUDE.md, docs/PRD.md (sections 5, 8, 9 FR-B1 to FR-B11 and FR-A1 to FR-A2, 10, 12), docs/SYSTEM_DESIGN.md, and docs/UNCERTAINTIES.md first. Phase 1 contracts already exist; do not change contract behavior.

Done when all of these are shown in this conversation:
1. packages/config exports a zod schema and a loader; `pnpm --filter @app/config test` exits 0 and validates all four files in deployments/.
2. `pnpm --filter @app/abi generate` builds typed ABIs from contracts/out with @wagmi/cli and exits 0.
3. packages/adapters has FraxNetClient, GasSponsor, CashOut, and ChainReader, each with a real and a mock implementation chosen by the network config's adapters block; `pnpm --filter @app/adapters test` exits 0. The real FraxNetClient calls only documented endpoints and throws a typed NotAvailableError for anything Frax hasn't documented yet (U-04, U-07).
4. `supabase start` and `supabase db reset` exit 0 and apply every migration in supabase/migrations.
5. A test shows the anon key cannot select from any table.
6. Every edge function in SYSTEM_DESIGN.md exists, rejects a request without a valid Privy token, and has a Deno test; `deno test` in supabase/functions exits 0.
7. The packet function returns the same packetHash for the same inputs regardless of key order or file order, shown by a test.
8. The gas-drip function refuses a second top-up for the same wallet within 24 hours, shown by a test.
9. simulate-payout refuses to run when the network config has isTestnet false, shown by a test.
10. .env.example lists every variable the functions and web app read, with no real values.

Constraints: same doc, language, secret, and commit rules as CLAUDE.md. Log new judgment calls in docs/UNCERTAINTIES.md. Or stop after 80 turns and print which numbered items remain.
```

## Phase 3: web app

```text
/goal Phase 3: build apps/web to spec. Read CLAUDE.md, docs/PRD.md (sections 4, 5, 6, 8, 9 FR-F1 to FR-F12, 12), docs/SYSTEM_DESIGN.md, docs/BRAND.md, and docs/UNCERTAINTIES.md first. Contracts, config, ABIs, adapters, and Supabase functions from phases 1 and 2 exist; reuse them and don't change their behavior.

Done when all of these are shown in this conversation:
1. `pnpm --filter web build` exits 0 and writes a static export to apps/web/out.
2. `pnpm --filter web lint` and `pnpm --filter web typecheck` exit 0.
3. Every route in the frontend section of SYSTEM_DESIGN.md exists, and record pages use query params such as /claim?id=12.
4. Playwright tests run against local anvil, local Supabase, and mock adapters, and `pnpm --filter web e2e` exits 0 covering: claimant submits a claim and gets paid; guarantor signs; underwriter approves through the Safe App path with Transaction Builder JSON fallback; claimant reports ASUC rejected and attester calls the guarantor; guarantor settles to Recovered; lender deposits and withdraws; simulated ASUC payout and settle to Settled; simulated cash-out.
5. Playwright screenshots at 375px wide for every claimant and guarantor screen are saved in apps/web/e2e/screenshots and listed in the conversation.
6. A grep over apps/web/app and apps/web/components shows no user-facing copy containing loan, borrow, interest, or repay.
7. The testnet banner renders when isTestnet is true, shown by a test.
8. Every color, font, and radius comes from the BRAND.md tokens in apps/web/app/globals.css; a grep shows no raw hex colors in apps/web/components or apps/web/app outside globals.css, and a unit test checks every text and background token pair passes WCAG AA.
9. The header shows the B@B x Frax lockup from files in apps/web/public/brand/, falling back to text names when a file is missing; no logo is drawn in code.
10. Onboarding opens https://net.frax.com in a new tab, shows the wallet address to add in FraxNet, and "Check my status" calls kyc-status, shown by a Playwright test with the mock FraxNetClient.

Constraints: same rules as CLAUDE.md. Use Tailwind and shadcn/ui components. Log new judgment calls in docs/UNCERTAINTIES.md. Or stop after 100 turns and print which numbered items remain.
```

## Phase 4: CI, testnet readiness, and runbook

```text
/goal Phase 4: make the repo ready for a Fraxtal testnet deploy and the October 11 pilot. Read CLAUDE.md, docs/PRD.md (sections 10, 13, 14, 17), docs/SYSTEM_DESIGN.md, and docs/UNCERTAINTIES.md first.

Done when all of these are shown in this conversation:
1. .github/workflows/ci.yml runs forge build, forge test, forge coverage, slither, aderyn, pnpm lint, typecheck, unit tests, deno test, and Playwright, and `actionlint` exits 0 on it.
2. `NETWORK=fraxtal-testnet forge script script/Deploy.s.sol --rpc-url $FRAXTAL_TESTNET_RPC` without --broadcast simulates successfully, or the conversation shows the RPC is unreachable from this machine and docs/RUNBOOK.md says to run it locally.
3. The deploy script refuses to run on fraxtal-testnet if any role in deployments/fraxtal-testnet.json is still SET_AFTER_SAFE_CREATED, shown by a test.
4. docs/RUNBOOK.md covers, as numbered steps with exact commands: creating the testnet Safes at safe.testnet.frax.com, filling role addresses, getting FRAX from faucet.testnet.frax.com, deploying, seeding the pool, registering the Safe App, deploying edge functions, publishing the static site, onboarding a pilot org, and pausing in an emergency.
5. docs/UNCERTAINTIES.md has every entry still open marked with status open, and a new section at the bottom lists the open entry IDs grouped by section, ready to send to Frax in one message.
6. README.md explains what the project is, how to run everything locally in under 10 commands, and links to every doc.

Constraints: same rules as CLAUDE.md. Never broadcast to a public network. Or stop after 40 turns and print which numbered items remain.
```
