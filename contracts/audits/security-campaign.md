# Security campaign: can the pool lose money?

Run 2026-10-20 to 2026-10-21 on branch `security-campaign`, off `main` at `43e8408`. Find and document only: nothing in `contracts/src/`, the app, or the functions was changed during the campaign. Not an audit.

**Fixed since (2026-10-21):** every contract finding the user chose to fix (B-4b, B-4c, B-7, D-3, D-4, D-5) and every off-chain finding except E-2a, which waits on Frax (U-77). Each entry's status line says how. Left as documented by decision: the second-lender findings (A-*, B-1, U-79), the yearly fee (B-5, the user plans pricing by payment history), and the four simplifications that conflict with the PRD (A-7, B-6, B-8, B-9).

## Summary

**No outsider, claimant, or lender can drain the pool or take another lender's money while Frax is the only lender.** Nothing Critical was found. The money the pool can lose comes from three places:

1. **A second lender (U-79).** Every share-price fairness finding (A-1, A-2, A-3, A-10, B-1) needs a second shareholder. With Frax as the only lender they move money from Frax to Frax.
2. **Trusted roles.** The admin Safe's `execute` could forgive a claim with no loss booked (B-4b) and leave emergency holders unable to withdraw (B-4c); both are fixed. The frxUSD owner Safe can freeze, pause, or burn the pool's frxUSD (D-1).
3. **Off-chain gates.** The worst findings are here, not in the contracts. KYC is granted per FraxNet organization, not per person (E-2a). Chain 252 accepts `isTestnet: true`, which can deploy the anyone-can-mint mock token as the pool asset or turn on the simulated payout (E-1).

The user asked that fixes make the system simpler, not more complicated. Each finding below gives the **simplest fix** first. Most findings go away by **removing** something (see [Fixes that remove findings](#fixes-that-remove-findings)).

| Severity | IDs |
|---|---|
| Critical | none |
| High | E-1 (chain 252 accepts `isTestnet: true`), E-1d/e/f (mocks allowed on mainnet), E-2a/b (KYC per FraxNet org), A-1 *once there is a second lender* |
| Medium | A-1 (pilot), A-3, ~~B-4b~~, ~~B-4c~~ (fixed), D-1, E-1h/i, E-2c/d/f, E-3a, E-5a/b |
| Low | A-1c, A-2, A-7, A-10, B-1, B-6, ~~B-7~~ (fixed), B-8, B-9, D-2, E-3c/d, E-4a/b, E-5c, E-6a/b |
| Info | A-9, A-11, B-5, ~~D-3~~, ~~D-4~~, ~~D-5~~ (fixed), D-6, E-2e |

### Severity scale

- **Critical:** an outsider or lender drains or strands pool funds.
- **High:** bounded loss or a permanent freeze, or an off-chain gate that lets an unchecked person or contract reach the money.
- **Medium:** needs a trusted role, a second lender, or a compromised backend.
- **Low/Info:** griefing, an edge only an admin can reach, or documentation.

### How the findings are tested

Each finding has a test that asserts **today's behaviour**, so the suite stays green and the test fails once the fix lands. Contract tests are named `test_<fn>_documents...`. Off-chain finding tests are skipped unless `SECURITY_FINDINGS=1`; with it set, they fail today (34 of them).

## What was run

| Workstream | What | Result |
|---|---|---|
| A: share price and lender fairness | `test/security/PoolEconomics.t.sol`, 18 tests | 7 findings, all needing a second lender or a total loss |
| B: reentrancy, access, limits | `test/security/{Reentrancy,AccessMatrix,Limits,RegistryEdges}.t.sol` + `mocks/`, 25 tests | 54 functions × 10 roles access matrix clean; 7 findings |
| C: adversarial invariants | `test/invariant/Adversarial{Handler,Invariants}.sol`, 15 invariants | Held on three seeded deep runs (2,000 × 300, 600k calls each) with 0 reverts; killed 10/10 injected bugs. No findings |
| D: second-opinion tooling | Gambit, Halmos, Slither (all detectors), Aderyn, OZ advisories, frxUSD fork probe, Medusa (90 min, 26.6M calls) | 438/440 mutants killed; 0 Medusa failures; frxUSD admin powers documented. `audits/mutation.md`, `audits/security-tooling.md` |
| E: off-chain and deploy | `packages/{config,adapters}/test/security.test.ts`, `apps/web/test/security.test.ts`, `supabase/functions/*/handler.security.test.ts`, `_shared/auth.security.test.ts`, `supabase/tests/database/security_seed.test.sql`, `test/security/DeployConfig.t.sol` | The worst findings of the campaign |

`forge test` passes 380 tests (2 skipped: the fork suites without `FRAXTAL_RPC_URL`). Every contract finding below was reproduced by the orchestrating session, not just reported by a subagent.

**Not run:** the database test (`security_seed.test.sql`) and DB-backed edge-function tests need Docker and the Supabase CLI, which weren't available here. Halmos timed out on most properties that go through OpenZeppelin's 512-bit `mulDiv`; those are covered by Medusa and by hand proofs in `audits/security-tooling.md`.

## Findings: contracts

### A-1 New depositor captures a recovery after a total loss
- **Severity:** Medium in the pilot (Frax alone); High with any second lender.
- **Actor:** an allowlisted lender.
- **What happens:** every claim is written off, so `totalAssets() == 0` while shares still exist. OpenZeppelin's conversion then mints a deposit of 1 frxUSD about 1e46 shares. When the guarantor later pays 2,500 on the written-off claim, the new depositor owns almost all of it and the original lender keeps 2,500 wei. Even a 1-wei deposit takes half.
- **Near-zero variant (A-1b):** with NAV just above zero, a 1 frxUSD deposit gains 1,249.99 of a 2,500 recovery.
- **Tests:**
  - `test_settle_documentsZeroNavRecoveryCapturedByNewDepositor`
  - `testFuzz_deposit_documentsZeroNavCaptureForAnyAmount`
  - `test_settle_documentsNearZeroNavRecoveryCapture`
- **Simplest fix:** one lender with non-transferable shares (the pilot shape, U-79). There's no one else to capture from.
- **Additive fix:** refuse deposits while `totalSupply > 0 && totalAssets < 1e18` (or while any written-off claim can still pay).
- **Status:** open.

### A-1c Recovery stranded after every holder exits
- **Severity:** Low.
- **What happens:** a payment on a written-off claim after the last share is redeemed belongs to the virtual shares. Only the admin's `execute` could move it; with `execute` deleted (2026-10-21) nothing can.
- **Test:** `test_settle_documentsRecoveryStrandedAfterEveryHolderLeft`.
- **Related (D-2):** the same state with emergency mode activated afterwards strands the cash too (Medusa smoke run).
- **Simplest fix:** keep it documented. The RUNBOOK already tells Frax to keep shares while a written-off claim can pay (U-79).
- **Status:** open, procedural.

### A-2 Sandwiching a recovery or fee payment
- **Severity:** Low (by design with more than one lender).
- **What happens:**
  - A lender who deposits just before a recovery gains 1,333.33.
  - Around a fee payment, they take 61.64 of 123.29.
- **Tests:** `test_settle_documentsRecoverySandwich`, `test_settle_documentsFeePaymentSandwich`.
- **Simplest fix:** one lender (U-79). The fee half also goes away with the flat fee (see B-5).
- **Status:** open.

### A-3 Exiting during the write-off grace leaves the loss to the other lender
- **Severity:** Medium with a second lender.
- **What happens:** a `GuarantorCalled` claim counts at par for 60 days. A 30k lender who exits in that window leaves at par, and the 10k lender who stays loses 100%: 7,500 of loss shifts onto them.
- **Tests:** `test_redeem_documentsGraceExitWipesOutTheStayer`, `testFuzz_redeem_documentsGraceExitLossTransfer`.
- **Related (A-10):** entering during the grace buys into a known loss; the test shows a 1,250 loss (`test_deposit_documentsEntryDuringTheGraceBuysIntoAKnownLoss`).
- **Simplest fix:** one lender (U-79).
- **Additive fix:** mark `GuarantorCalled` principal down at call time, or haircut exits.
- **Status:** open; already a known U-79 limit, now quantified.

### A-7 A donation fills the deposit cap
- **Severity:** Low.
- **What happens:** anyone can send frxUSD to the pool until `_depositRoom()` is zero, blocking lender deposits. The admin raises the cap to recover.
- **Test:** `test_deposit_documentsDonationFillsTheCap`.
- **Simplest fix:** drop `depositCap` once there's one lender. This **conflicts with FR-C3**, so the product owner decides.
- **Status:** open.

### A-9 Zero-value redeem on someone else's behalf
- **Severity:** Info.
- **What happens:** `redeem(0, x, victim)` succeeds for anyone and emits `Withdraw` with `owner = victim`. This only matters to an indexer.
- **Test:** `test_redeem_documentsZeroValueCallOnBehalfOfAStranger`.
- **Simplest fix:** ignore zero-value events in `chain-sync`.

### A-11 Repeated wipe-outs overflow the share math
- **Severity:** Info.
- **What happens:** after three total losses with re-deposits, deposits revert.
- **Test:** `test_deposit_documentsRepeatedWipeOutsOverflowShareMath`.
- **Simplest fix:** one lender (U-79). A wiped-out pool is retired, not refilled.

### B-1 A hooked token lets a deposit mint at understated NAV during `settle`
- **Severity:** Low (frxUSD has no hooks; D-1 confirmed it on the fork).
- **What happens:** `settle` books principal returned (`ClaimRegistry.sol:213`) before pulling the frxUSD (`:214`). A token hook in between lets a lender deposit while NAV is understated. The deposit gains 1,578.95 and the other lender drops from 20,000 to 18,421.05.
- **Test:** `test_settle_documentsHookedDepositAtUnderstatedNav`.
- **Simplest fix:** none needed while frxUSD stays plain and there's one lender.
- **Additive fix:** pull the payment before booking it, or have the pool pull it under its own guard.
- **Status:** open.

### B-4b The admin can forgive a claim with no loss booked
- **Severity:** Medium (trusted role).
- **What happens:**
  1. The admin calls `execute(frxUSD, approve(registry, X))`.
  2. Then `execute(registry, settle(id, X))`.
  3. The pool pays itself. The claim becomes `Settled` with no money in, the share price goes from 1.00 to 0.95, and `totalLosses` stays 0.
- **Why it matters:** this skips the attester, `writeOff`, and the separation FR-C13 relies on, and hides the loss.
- **Test:** `test_execute_documentsAdminSelfSettleForgivesPrincipalWithoutLoss` (deleted with `execute`).
- **Simplest fix:** delete `execute` (U-82).
- **Status:** fixed 2026-10-21. `execute` is deleted from the pool and its interface; the admin has no call that can make the pool pay itself.

### B-4c `execute` outflow during emergency mode locks holders out
- **Severity:** Medium.
- **What happens:**
  - A 1-wei outflow makes the first holder's `maxEmergencyWithdraw` underflow (panic).
  - A larger outflow leaves 9,125 idle against the second holder's 13,687.5 entitlement, so `emergencyWithdraw` reverts with `ERC20InsufficientBalance` and they get nothing.
  - D-1 shows the same lockout without `execute`: the frxUSD owner burning the pool's balance.
- **Test:** `test_emergencyWithdraw_documentsExecuteOutflowBlocksHolders`, now `test_emergencyWithdraw_outflowLeavesEveryHolderAbleToDrawWhatIsThere` (simulates the burn with `deal`).
- **Simplest fix:** delete `execute` (U-82). That removes the trigger the B@B side controls.
- **Additive fix (needed anyway if frxUSD may burn):** in `maxEmergencyWithdraw` and `emergencyWithdraw`, saturate the subtraction and pay `min(entitlement, idle)`.
- **Status:** fixed 2026-10-21, both ways. `execute` is gone, and `maxEmergencyWithdraw` saturates at 0 and caps at idle cash (`emergencyWithdraw` pays it), so after a burn every holder can take what is there without a revert. After an outflow, what is left goes first come, first served.

### B-5 The yearly fee can overflow `uint128` and freeze a claim
- **Severity:** Info.
- **What happens:** `_accrueFee` calls `toUint128` (`ClaimRegistry.sol:488`). It only overflows at about 6.67e36 wei per claim, far above any cap. `toUint40` is safe until 2106.
- **Tests:**
  - `test_accrueFee_documentsUint128OverflowFreezesTheClaim`
  - `testFuzz_accrueFee_neverOverflowsAtTheDeployedCap`
  - `test_toUint40_maxWindowsNearYear2106DoNotOverflow`
- **Simplest fix:** revert the yearly fee (U-84) to the PRD's flat fee, charged once at purchase (PRD §6). That also removes the fee sandwich (A-2), per-call rounding, and the pay screen's "add an hour of fee" workaround.
- **Status:** open.

### B-6 Two guaranties signed at the same nonce cancel each other
- **Severity:** Low (UX/DoS).
- **What happens:** an officer signs claims A and B at nonce n. Submitting A kills B's signature, and there is no way to revoke an unused one.
- **Test:** `test_submitClaim_documentsSameNonceGuarantiesInvalidateEachOther`.
- **Simplest fix:** drop guarantor nonces; `packetHash` is already single-use and signed. This **conflicts with FR-C7**, so the product owner decides.
- **Status:** open.

### B-7 A deactivated guarantor still backs a purchase
- **Severity:** Low/Medium.
- **What happens:** `setOfficer(org, guarantor, false)` after approval doesn't stop `purchaseClaim`. `_checkPurchase` checks the org is active, not the officer. The test pays out 1,000.
- **Test:** `test_purchaseClaim_documentsDeactivatedGuarantorStillBacksPurchase`, now `test_purchaseClaim_revertsWhenGuarantorDeactivated`.
- **Simplest fix:** none removes it. It's a one-line `isActiveOfficer` check in `_checkPurchase`.
- **Status:** fixed 2026-10-21. `_checkPurchase` reverts with `NotOfficer(orgId, guarantor)`. Both invariant handlers skip such claims.

### B-8 Re-approval ignores a lowered advance rate
- **Severity:** Low.
- **What happens:** `approveClaim` rechecks `requestedAmount` and `perClaimCap`, but not `advanceRateBps`. This contradicts "param changes apply to later approvals".
- **Test:** `test_approveClaim_documentsLoweredAdvanceRateNotReapplied`.
- **Simplest fix:** drop `advanceRateBps` (it's 10,000) or allow approval only from `Submitted`. Both **conflict with PRD §6 params**.
- **Status:** open.

### B-9 Grace can be set to one second
- **Severity:** Low (admin + attester).
- **What happens:** `setParams(writeOffGrace = 1)` lets the attester write off one second after calling the guarantor.
- **Test:** `test_writeOff_documentsOneSecondGraceAfterPurchase`.
- **Simplest fix:** make the grace a constant. This **conflicts with PRD §6** ("not constants").
- **Status:** open.

### D-1 The frxUSD owner Safe can freeze, pause, or burn the pool's money
- **Severity:** Medium (trusted third party).
- **Tested on:** Fraxtal mainnet at block 42,873,553.
- **The token:**
  - frxUSD is an EIP-1967 proxy, implementation `0x0000000083BDf23788585D499EAb0D92A8bEfB1D`, upgraded by the Fraxtal ProxyAdmin predeploy.
  - The token owner, the ProxyAdmin owner, and the timelock are one 3-of-5 Gnosis Safe: `0xC4EB45d80DC1F079045E75D5d55de8eD1c1090E6`.
- **What that Safe can do:**
  - pause the token;
  - freeze accounts (a freezer can freeze; only the owner thaws);
  - **`burnFrxUsd(account, amount)`: burn any balance with no allowance;**
  - upgrade the token.
  No account has ever been frozen.
- **What the fork tests show:**
  - Freezing the pool blocks redeem, withdraw, `emergencyWithdraw`, and incoming settlements; `maxRedeem` still reports a positive number.
  - Freezing the registry blocks every settlement.
  - A token pause halts everything.
  - A burn lowers the share price with no write-off booked.
- **Tests:** `test/security/FrxUsdFork.t.sol` (9 tests; skipped without `FRAXTAL_RPC_URL`).
- **Simplest fix:** none on our side. Write it into `SECURITY.md` (done) and ask Frax (U-85).
- **Status:** open.

### D-2 to D-6 Tooling results (Info)
- **D-2:** zero-supply emergency mode strands receipts. Same root as A-1c.
- **D-3:** `maxMint` reverts when `depositCap` is set above about `type(uint256).max / 1e6`, including `type(uint256).max` as "no cap". ERC-4626 says it must not revert. Only the admin sets the cap. **Simplest fix:** never set a cap that large, or drop the cap (FR-C3 conflict, as in A-7). **Status:** fixed 2026-10-21. `maxMint` clamps the deposit room to `type(uint256).max / (totalSupply + 1e6)` first, so it underestimates instead of reverting (`test_maxMint_doesNotRevertForUnboundedCap`). A side effect: A-11's `maxMint` no longer reverts; its deposit still does.
- **D-4:** forge 1.8.5 lint adds 6 warnings in `src/`:
  - `reentrancy-events` at `ClaimRegistry.sol:264,280,490` and `ReceivablesPool.sol:131`;
  - `arbitrary-send-eth` and `reentrancy-eth` on `execute`.
  All are false positives or by design. The `execute` two disappear with it.
  **Status:** fixed 2026-10-21. The `execute` two went with `execute`; the four `reentrancy-events` are suppressed inline with a reason, like the earlier ones. `forge build` on 1.8.5 reports nothing in `src/`.
- **D-5:** mutant 331 survives. `ClaimRegistry.sol:421` `c.id = claimId` → `c.id = 1`, because no test reads `getClaim(2).id`. A test gap only. **Status:** fixed 2026-10-21. `test_submitClaim_idsStartAtOneAndIncrement` asserts `getClaim(2).id == 2`.
- **D-6:** `version()` on frxUSD uses an opcode the repo's `shanghai` target doesn't have, and Fraxtal mainnet runs it. Fraxtal supports Cancun-era opcodes (evidence for U-35).

## Findings: off-chain and deployment

### E-1 Chain 252 accepts `isTestnet: true` (High)
- **What happens:** `isTestnet` comes from the JSON, not the chain ID, in both the config schema and `Deploy.s.sol:158`.
  - **E-1a/b/c:** on chain 252 the schema accepts `isTestnet: true`, so testnet-only features turn on.
  - **E-1g:** with `isTestnet: true` and `frxUSD: null`, `Deploy.s.sol` deploys `MockFrxUSD`, which anyone can mint, as the pool asset on Fraxtal mainnet.
  - **E-4c:** `simulate-payout` runs on chain 252.
- **E-1h/E-1i (Medium):** one address can hold every role, and every role may be a plain key, not a Safe.
- **Tests:**
  - `test_deploy_documentsMockFrxUsdOnMainnetWhenFileSaysTestnet`
  - `test_readConfig_documentsSameAddressForEveryRoleOnMainnet`
  - `test_deploy_documentsEoaRolesAcceptedOnMainnet`
  - `packages/config/test/security.test.ts`
- **Simplest fix:** delete the `isTestnet` field and derive it from `chainId` in the config loader and the deploy script.
- **Additive fix:** require distinct roles that are contracts on non-local networks.
- **Status:** fixed 2026-10-21, both. `isTestnet` is gone from every `deployments/*.json` and the schema; `packages/config` derives it from `chainId` (31337, 2523, 11155111 are testnets) and `Deploy.s.sol` checks `block.chainid == 252`. Outside local, the deploy script requires admin, underwriter, and attester to be three different contracts (`RolesNotDistinct`, `RoleNotContract`). Tests: `test_readConfig_refusesMockFrxUsdOnMainnet`, `test_readConfig_ignoresIsTestnetInTheFileOnMainnet`, `test_readConfig_refusesSameAddressForEveryRoleOnMainnet`, `test_readConfig_refusesEoaRolesOnMainnet`, `test_deploy_mainnetWithDistinctSafesAndKeyPauser`, `packages/config/test/security.test.ts`.

### E-1d/e/f Mainnet config allows the mock adapters (High)
- **What happens:** with `isTestnet: false` the schema still accepts:
  - `fraxnet: "mock"`, which approves KYC for anyone;
  - `gasSponsor: "mock"`;
  - `cashOut: "simulated"`;
  - `features.simulateAsucPayout: true`.
- **Tests:** `packages/config/test/security.test.ts`.
- **Simplest fix:** remove `simulate-payout` and the mock adapters from the mainnet bundle and config.
- **Status:** fixed 2026-10-21. On a non-testnet chain the schema rejects every mock adapter, `simulateAsucPayout`, and a null `frxUSD`.

### E-2a/E-2b KYC is per FraxNet organization, not per person (High)
- **What happens:** `packages/adapters/fraxnet/types.ts:89-94` approves anyone whose FraxNet org is `verified` and not a business. Two users in one verified org both pass, and `isBusiness: null` counts as personal.
- **Tests:** `packages/adapters/test/security.test.ts`.
- **Simplest fix:** none. Frax has to say what `verified` means (U-77). Until then, treat only `isBusiness === false` as personal and keep manual KYC on mainnet.
- **Status:** E-2b fixed 2026-10-21: only `isBusiness === false` approves; `null` stays pending (U-91 asks Frax whether `/org` always sends it). E-2a open, blocked on Frax (U-77).

### E-2c/E-2d/E-2f Webhook replay and stale KYC (Medium)
- **E-2c:** the same signed webhook body is accepted twice.
- **E-2d:** a webhook overrides a manual rejection.
- **E-2f:** KYC isn't rechecked at approval; the underwriter gate is UI-only.
- **E-2e (Info):** the OIDC nonce is safe.
- **Tests:**
  - `supabase/functions/fraxnet-webhook/handler.security.test.ts`
  - `supabase/functions/fraxnet-connect/handler.security.test.ts`
  - `supabase/functions/directory/handler.security.test.ts`
- **Simplest fix:** delete `fraxnet-webhook` until FraxNet ships webhooks (U-51). That removes E-2c and E-2d. E-2f stays an underwriter procedure.
- **Status:** fixed 2026-10-21. The user chose to keep and harden the webhook. The signature covers only the body, so each applied body's HMAC is stored in `once_keys` and a repeat gets 409; a manual rejection from `/admin/kyc/` is never overwritten (202, no change). For E-2f, the review queue's `directory?view=people` asks FraxNet again for each connected member before Approve turns on; the approval itself is an on-chain Safe transaction.

### E-3 Guaranty signing
- **E-3a (Medium):** the officer signs whatever typed data the server hands back. The page doesn't check `domain.chainId`, `verifyingContract`, or the amount shown, and Privy's wallet UI is off (`showWalletUIs: false`).
  - **Simplest fix:** build the typed data in the browser from `@app/config` and the displayed claim. Never take it from the server.
- **E-3b:** safe.
- **E-3c/d (Low):** a used invite still resolves, and invite emails are unlimited.
- **Status:** fixed 2026-10-21. The guarantee page builds the typed data in the browser (`apps/web/lib/guaranty.ts`) from `@app/config` and the claim on screen; only the nonce comes from the server, and a wrong nonce only makes the signature unusable. A used invite answers 410; invite creation is limited to 3 per claim per day (429). Privy's wallet UI stays off (`showWalletUIs: false`): turning it on changes every transaction screen, so that's a product call and its test stays skipped.
- **Tests:**
  - `supabase/functions/guaranty/handler.security.test.ts`
  - `supabase/functions/guarantor-invite/handler.security.test.ts`
  - `apps/web/test/security.test.ts`

### E-4 Hot wallets (Low)
- **E-4a:** gas-drip pays any new Privy account once a day (sybil). The exposure is `DRIP_AMOUNT_WEI` × the number of accounts.
- **E-4b:** `simulate-payout` re-drains: 300 due, 900 drawn over three calls.
- **Simplest fix:** remove `simulate-payout` from mainnet (as for E-1d/e/f). For gas-drip, require verified KYC before a drip.
- **Tests:** `supabase/functions/{gas-drip,simulate-payout}/handler.security.test.ts`.
- **Status:** fixed 2026-10-21. Gas only for KYC-approved members (403 `kyc_required`). Each claim gets at most one simulated payout (`once_keys`, 409 `already_paid`), and the function is off on mainnet by chain ID.

### E-5 Browser surface (Medium/Low)
- **E-5a (Medium):** no `Content-Security-Policy` or `frame-ancestors` in `apps/web/public/_headers`.
- **E-5b (Medium):** the Safe SDK allows any parent origin (`allowedDomains: [/.*/]`).
- **E-5c (Low):** the cash-out address accepts the zero address, contracts, and bad checksums.
- **Fix:** none removes these. Add the header, pin the Safe origins, and check the address strictly.
- **Test:** `apps/web/test/security.test.ts`.
- **Status:** fixed 2026-10-21. `_headers` sends a CSP with `frame-ancestors` limited to the app and the Safe UIs (`app.safe.global`, `safe.mainnet.frax.com`, `safe.testnet.frax.com`); `script-src` keeps `'unsafe-inline'` because a static export can't carry a nonce. `lib/safe.ts` accepts messages only from those origins. The cash-out address must be checksummed and non-zero and can't be the token itself; checking for contract code is skipped because the address is on Ethereum and the app only reads Fraxtal. **Not checked in a browser:** that Privy and WalletConnect still work under the CSP on the hosted site.

### E-6 Staff and auth (Low)
- **E-6a:** `supabase/seed.sql` makes anvil account 0 an underwriter in every environment that runs the seed. The test (`supabase/tests/database/security_seed.test.sql`) is unrun here.
  - **Simplest fix:** move that row into the local-only script.
- **E-6b:** a Privy JWT without `exp` and with no max age is accepted.
  - **Fix:** add `requiredClaims: ["exp"]` and `maxTokenAge`.
- **Test:** `supabase/functions/_shared/auth.security.test.ts`.
- **Status:** fixed 2026-10-21. `seed.sql` adds no staff; `supabase/functions/_tests/local-underwriter.ts` adds the anvil underwriter for `pnpm local`, `pnpm demo`, and the e2e setup and refuses a non-loopback Supabase. Tokens need `exp` and `iat` and are refused after 24 hours.

## Fixes that remove findings

Ordered by how much each removes.

| Simplification | Removes | PRD |
|---|---|---|
| Pool takes exactly one lender, shares non-transferable (the pilot shape, U-79). **Declined 2026-10-21:** left as documented under U-79 | A-1, A-1b, A-2, A-3, A-10, A-11, U-42 transfers, B-1 | Compatible with FR-C1..C4 (still ERC-4626). A later multi-lender pool is a new deployment anyway (U-03) |
| Delete `execute` (U-82), **done 2026-10-21** | B-4b, the B@B-side trigger of B-4c, the full-drain trust caveat, two D-4 lint warnings. Restores I-7 as the PRD writes it | Aligned: not in the PRD |
| Derive `isTestnet` from `chainId` and delete the field, **done** | E-1a/b/c, E-1g, E-4c | Aligned |
| Remove `simulate-payout` and the mock adapters from mainnet, **done** (by schema) | E-1d/e/f, E-4b | Aligned |
| ~~Revert the yearly fee (U-84) to the flat fee~~ **declined 2026-10-21**: the user wants pricing by payment history later | B-5, the fee half of A-2, the "approve an extra hour" UX, per-call rounding | Aligned: PRD §6 is the flat fee |
| Delete `fraxnet-webhook` until FraxNet has webhooks (U-51). **Declined:** hardened instead | E-2c, E-2d | Aligned |
| Build guaranty typed data in the browser from config, **done** | E-3a | Aligned |
| Move the anvil underwriter out of `seed.sql`, **done** | E-6a | Aligned |
| Drop `depositCap` once there's one lender | A-7, D-3 | **Conflicts with FR-C3** |
| Drop guarantor nonces (`packetHash` is already single-use and signed) | B-6 | **Conflicts with FR-C7** |
| Drop `advanceRateBps`, or approve only from `Submitted` | B-8 | **Conflicts with PRD §6 params** |
| Make the write-off grace a constant | B-9 | **Conflicts with PRD §6** ("not constants") |

The PRD is not edited (repo rule), so the four conflicting rows are a product-owner decision.

**Not solvable by removing something:**
- E-2a/b: Frax has to answer U-77.
- B-7: one `isActiveOfficer` line (done).
- E-5a/b/c: a header, an origin list, an address check.
- E-6b: two JWT options.
- D-1: Frax's Safe; ask, don't code.
- B-4c saturating subtraction: needed only if `execute` stays or frxUSD may burn the pool's balance (D-1 says it can). Done.

## Follow-ups that aren't findings

- `test/invariant/Invariants.t.sol` `afterInvariant` loops `i < 21`, so it prints `claimCount` under the "warp" label and never prints `calls("warp")`. Debug output only.
- Kill mutant 331 with one assertion: `getClaim(2).id == 2`. Done (D-5).
- Suppress the four D-4 `reentrancy-events` lints inline so CI on forge 1.8.5 stays quiet. Done.
- Run the DB test and the DB-backed function tests once Docker is available.
- The adversarial invariants (`AdversarialInvariants.t.sol`) and the security tests run in the default `forge test`. The deep profile (`FOUNDRY_PROFILE=deep`) is for campaigns, not CI.
