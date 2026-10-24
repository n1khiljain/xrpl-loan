# Security tooling (Workstream D)

Second-opinion tooling for the security campaign, run on 2026-10-20 against `src/` at commit `43e8408`. Nothing in `src/` was changed. Mutation results are in `mutation.md`. Earlier Slither and Aderyn triage (S-1 to S-12, A-H1 to A-L5) is in `static-analysis.md`.

## Tools

| Tool | Version | Used for |
|---|---|---|
| forge | 1.8.5 | builds, tests, fork tests |
| Slither (+ slither-check-erc, crytic-compile) | 0.11.6 | all detectors, ERC conformance, printers |
| Aderyn | 0.6.8 | rerun, compared with `aderyn-report.md` |
| Gambit | 1.0.6 | mutation testing (`mutation.md`) |
| Halmos | 0.3.3, solver Bitwuzla 0.8.1 (halmos-managed download) | symbolic checks (`test/security/Halmos.t.sol`) |
| Medusa | 1.5.1 | assertion-mode fuzzing (`test/security/medusa/`, `medusa.json`) |
| cast | 1.8.5 | frxUSD on-chain probe |

## Commands

```sh
# from contracts/
slither . --detect all --fail-none --json slither-all.json        # slither.config.json filters lib/ test/ script/
slither-check-erc . ReceivablesPool --erc erc4626 --compile-force-framework foundry
slither-check-erc . ReceivablesPool --erc erc20   --compile-force-framework foundry
slither . --print human-summary,vars-and-auth
aderyn . -o aderyn-rerun.md
JOBS=5 test/security/run-mutants.sh                                # see mutation.md
FOUNDRY_DYNAMIC_TEST_LINKING=false HALMOS_ALLOW_DOWNLOAD=1 \
  halmos --match-contract HalmosTest --solver bitwuzla --solver-threads 4 --solver-timeout-assertion 600s
medusa fuzz                                                        # medusa.json: 6 workers, 5,400 s
FRAXTAL_RPC_URL=https://rpc.frax.com forge test --match-path test/security/FrxUsdFork.t.sol
```

Halmos needs `FOUNDRY_DYNAMIC_TEST_LINKING=false`. Otherwise forge 1.8.5 compiles `new X()` in tests to `vm.deployCode`, which Halmos 0.3.3 doesn't support, and `setUp()` fails. Medusa needs `crytic-compile` on `PATH` (it ships with Slither).

## Slither and Aderyn: new results

- **Slither, all 102 detectors:** 7 results, all `timestamp` (Low). This is the known S-4 set. No other detector fires on `src/`, including the informational and optimization ones.
- **Printers.** `human-summary`: 930 SLOC in `src/`, 0 assembly, 7 low issues, 0 medium or high. It flagged the pool as "Receive ETH / Send ETH". That was the `payable` `execute` (U-82), deleted on 2026-10-21; the pool has no `receive` or `fallback`. `vars-and-auth`: every state-writing external function is behind a role modifier, `onlyRegistry`, a `msg.sender` check (`cancelClaim`/`purchaseClaim` recipient, `submitClaim` guarantor/officer), or is meant to be open (`settle`, lender ERC-4626 entry points, `emergencyWithdraw`). Nothing unexpected.
- **Aderyn rerun:** the same 1 high and 4 low categories at the same 32 locations as `aderyn-report.md` (diffed line by line). Nothing new.
- **forge lint, new in forge 1.8.5.** `static-analysis.md` says forge lint reports nothing, but that was forge 1.8.3. On `forge build --force`, 1.8.5 adds 6 warnings in `src/`, all false positives or by design:
  - `reentrancy-events` at `ClaimRegistry.sol:264` (`GuarantorCalled`), `:280` (`ClaimWrittenOff`), `:490` (`FeeAccrued`). The only "external calls" before these are `SafeCast`/`Math` library calls inside `_accrueFee`, which is the same pattern already suppressed elsewhere.
  - `reentrancy-events` at `ReceivablesPool.sol:131` (`EmergencyWithdrawal`). The earlier call is `idleCash()`, a `balanceOf` STATICCALL inside `maxEmergencyWithdraw`.
  - `arbitrary-send-eth` and `reentrancy-eth` at `ReceivablesPool.sol:150` (`execute`). It is admin-only and `nonReentrant`, and `_status` is set on entry by the modifier. By design (U-82).

  Suggest suppressing these inline the same way as the existing ones, so CI on 1.8.5 stays quiet. Done on 2026-10-21: the `execute` two went with `execute`, the other four are suppressed inline.

## ERC conformance

- `slither-check-erc ... --erc erc4626`: every function, return type, view-ness, and event (indexed parameters included) is present and correct.
- `slither-check-erc ... --erc erc20`: all present. One note: "not protected for the ERC20 approval race condition", which is standard OpenZeppelin `approve` behavior. Accepted.
- **Found by hand: `maxMint` reverts for a near-unlimited deposit cap (Info).** ERC-4626 says `maxMint` must not revert. `maxMint` is `_convertToShares(maxDeposit(receiver), Floor)`. If the admin sets `depositCap` above about `type(uint256).max / 1e6`, for example `type(uint256).max` to mean "no cap", the 6-decimal share offset makes `Math.mulDiv` overflow and `maxMint` reverts. Checked with a scratch forge test: cap `type(uint256).max` reverts, `type(uint256).max / 1e6` works. Only the admin can set the cap, and no real cap gets near that value. Fix if wanted: clamp `maxDeposit` before converting, or return `type(uint256).max` when the room is unbounded.
- Known and documented: `maxDeposit` can't see the caller allowlist (U-42).

## OpenZeppelin 5.3.0 advisories

Checked against the GitHub advisory API (`/repos/OpenZeppelin/openzeppelin-contracts/security-advisories`, 20 advisories) on 2026-10-20. Only one covers 5.3.0:

- **GHSA-9rcw-c2f9-2j55** (Low, 2025-07-17): `Bytes.lastIndexOf(bytes,bytes1,uint256)` reads out of bounds, versions >= 5.2.0, fixed in 5.4.0. **Not reachable:** the full import graph of `src/` covers 38 OZ files (AccessControl, ERC20, ERC4626, ERC721, SafeERC20, ReentrancyGuard, Pausable, Nonces, EIP712, ECDSA, SignatureChecker, MessageHashUtils, Math, SafeCast, ShortStrings, Strings, ...), and `utils/Bytes.sol` isn't one of them.

Every other advisory (ECDSA malleability, SignatureChecker revert on bad ERC-1271, ERC165Checker, Base64 dirty memory, and more) affects only versions below 5.0.2 or the 4.x line. None covers ERC4626, AccessControl, ReentrancyGuard, SignatureChecker, Nonces, EIP712, SafeERC20, or Math in 5.3.0.

## frxUSD admin surface (U-31 as fact)

Read with `cast` from `https://rpc.frax.com` at block 42,873,553 and pinned in `test/security/FrxUsdFork.t.sol` (9 tests, all passing on the fork). Fraxscan's API needs a key (V1 is retired) and Sourcify has no match, so the function list comes from the implementation bytecode (`cast selectors --resolve`) and from simulated calls.

| Fact | Value | Evidence |
|---|---|---|
| Token | `0xFc00000000000000000000000000000000000001`, "Frax USD"/"frxUSD", 18 decimals, `version()` "3.0.0" | `cast call` |
| Proxy | EIP-1967 proxy. Implementation `0x0000000083BDf23788585D499EAb0D92A8bEfB1D`, admin `0xfC0000000000000000000000000000000000000a` (Fraxtal ProxyAdmin predeploy, itself a proxy to `0xfc…09`) | impl and admin slots (`cast storage`) |
| Upgrade and token owner | `owner()` of the token and of the ProxyAdmin, and `timelock_address()`, are all `0xC4EB45d80DC1F079045E75D5d55de8eD1c1090E6`, a Gnosis Safe 1.3.0, **3-of-5** (owners `0x8da4…C2C0`, `0x6e74…c4D2`, `0x6933…A4F2`, `0x17e0…c96e`, `0xcbc6…0928`) | `getThreshold`, `getOwners` |
| Pause | `pause()`/`unpause()`/`isPaused()`, owner only. Currently not paused | outsider call reverts `OnlyOwner`. Fork test: a paused token blocks deposit, redeem, purchase, and settle |
| Freeze | `freeze`, `freezeMany`, `thaw`, `thawMany`, `isFrozen`. Freezers or owner can freeze; only the owner can thaw. A frozen account can neither send nor receive | outsider: `NotFreezer`/`OnlyOwner`. Fork tests below |
| Freezers | `addFreezer`/`removeFreezer` (owner). One freezer, `0x8d1c…c49f`, was added at block 34,384,151 and removed at 37,335,926. The owner Safe is not a freezer but can freeze directly | `AddFreezer`/`RemoveFreezer` logs from block 0. No `AccountFrozen` log so far |
| Forced burn | `burnFrxUsd(address,uint256)`, owner only, **no allowance**: burns any account's balance | simulation: owner hits `ERC20InsufficientBalance` (no allowance check), outsider gets `OnlyOwner`. Fork test burns 5,000 from the pool |
| Minting | `minters_array`: `0xFc…0D` (predeploy), the owner Safe, `0x96A3…F5D4`, `0x8C33…BFF4` (contracts). `minter_mint`/`minter_burn_from`. The L2 bridge `0x4200…0010` mints and burns as an OptimismMintableERC20 (L1 token `0xCAcd…6E29`) | `cast call` |
| Transfers | Plain on the paths the pool uses: no fee, no hook, no rebase (exact balance deltas). Also EIP-2612 `permit` (with an ERC-1271 `bytes` variant) and EIP-3009 `transferWithAuthorization`/`receiveWithAuthorization` | fork test `test_transfer_noFeeNoHookOnPlainTransfers` |
| EVM | `version()` hits an opcode that is `NotActivated` under the repo's `shanghai` target but runs on Fraxtal, so Fraxtal mainnet executes post-Shanghai (Cancun) opcodes. This is evidence for U-35 | fork test switches with `vm.setEvmVersion("cancun")` |

What the fork tests show for the pool:

| Action by frxUSD owner or freezer | Effect | Test |
|---|---|---|
| Freeze the pool | `redeem`, `withdraw`, and `emergencyWithdraw` revert. **Settlements into the pool also revert**, because a frozen account can't receive. `maxRedeem` still reports a positive amount. Thawing restores everything. The pool's `execute` can't help, since the pool can't send | `test_freeze_frozenPoolStrandsLenders` |
| Freeze a claimant | `purchaseClaim` reverts and the claim stays `Approved` | `test_freeze_frozenClaimantCannotSell` |
| Freeze a payer | That payer's `settle` reverts. Any other payer settles the same claim | `test_freeze_frozenPayerBlockedButAnotherPayerSettles` |
| Freeze the registry | Every `settle` reverts for every payer (the registry is the `transferFrom` spender), so claims go overdue | `test_freeze_frozenRegistryBlocksAllSettlements` |
| Pause the token | Deposits, exits, purchases, and settlements all revert | `test_pause_tokenPauseHaltsEveryPoolFlow` |
| `burnFrxUsd(pool, x)` | `totalAssets` and the share price drop by `x` with no write-off recorded (`totalLosses` unchanged) | `test_burnFrxUsd_ownerBurnsPoolCashWithoutAllowance` |
| Upgrade the implementation | Anything: hooks (reopens F2), fees, or rebasing would break I-1 and I-7 | proxy facts above |

Severity: these all need Frax's 3-of-5 Safe (a trusted third party), so **Medium** on the campaign scale. The `SECURITY.md` U-31 text is right about freeze effects. Missing from it: the registry freeze, frozen pools also refusing settlements, the token-wide pause, the no-allowance `burnFrxUsd`, and who the owner is.

## Halmos

`test/security/Halmos.t.sol`. Every function is `check_*`, so `forge test` ignores them. The fee math is private, so checks 1 and 2 **replicate the exact expression** from `ClaimRegistry._pendingFee` (`Math.mulDiv(unpaid, feeBps * elapsed, BPS * 365 days, Ceil)`). The settle checks run through the **deployed registry's** public `settle` and `amountRemaining`, with an ERC-1271 officer so no `ecrecover` is needed. The pool checks run on a **deployed pool** whose registry slot is a stub, so loss, purchase, and principal-return bookkeeping can be symbolic.

Solver: Bitwuzla with `--solver-threads 4`. The per-query assertion timeout was 300 to 1,800 s, and every check had a 40 to 45 minute wall-clock cap. The machine was heavily loaded by the other campaign jobs the whole time (load average up to 230), which made the timeouts worse.

| Check | Inputs | Result |
|---|---|---|
| `check_fee_atMostExactPlusOne`: fee <= `mulDiv(unpaid, feeBps*elapsed, BPS*YEAR) + 1` | `uint128` unpaid, `feeBps <= 10_000`, `uint40` elapsed | **PASS** (13 paths, 1.6 s) |
| `check_fee_monotoneInElapsed` | same widths, `e1 <= e2` | **TIMEOUT** (300 s query) |
| `check_fee_monotoneInElapsedNarrow` | `uint80` unpaid, `uint32` e1 and delta | **TIMEOUT** (wall cap) |
| `check_settle_symbolicPaymentsConcreteTerms`: paid <= remaining after accrual, `amountPaid <= amountDue`, booked principal <= and == `min(paid, purchasePrice - principalPaid)` | price 2,500, fee 10%, 90 + 200 days concrete; first payment and amount symbolic | **PASS** (546 paths, 94 s) |
| `check_settle_neverTakesMoreThanRemainingNoFee` | everything symbolic, fee 0 | **TIMEOUT** (397 paths, 2,653 s) |
| `check_settle_neverTakesMoreThanRemaining` | everything symbolic incl. fee | **TIMEOUT** (wall cap) |
| `check_maxRedeem_isRedeemable` / `check_maxWithdraw_isWithdrawable` | two deposits, purchase, loss, return, donation all symbolic `uint96` | **TIMEOUT** (wall cap) |
| `...ConcreteDeposits` variants | odd concrete deposits and purchase; loss, return, donation symbolic | **TIMEOUT** (maxWithdraw: 2 x 600 s queries; maxRedeem: wall cap) |
| `check_emergency_noUnderflowWhileReceiptsGrow` and `...ConcreteBalances`: claims in order A, B, A, B with receipts growing in between; no revert, payouts <= receipts, each total == pro-rata of total receipts | symbolic / concrete balances with symbolic receipts | **TIMEOUT** (wall cap) |

No check found a counterexample. Every timeout runs into OpenZeppelin's 512-bit `mulDiv` with a symbolic factor or denominator, which this solver setup can't finish. For the properties Halmos couldn't close:

- **Fee monotone:** `feeBps * elapsed` grows with `elapsed`, and `mulDiv(a, b, d, Ceil)` doesn't decrease as `b` grows. The exact-plus-one bound passed. Medusa and the forge fuzz test (`testFuzz_amountRemaining_feeAccruesOnUnpaidPrincipal`, plus `Limits.t.sol` at the deployed cap) check fees against an independent formula.
- **Settle bounds:** proven with concrete terms. Medusa checked them in 362,980 successful settles with random terms and fees from 0 to 100%.
- **`redeem(maxRedeem)` / `withdraw(maxWithdraw)`:** argued by hand from the code. `maxRedeem` returns the whole balance only when `convertToAssets(balance, Floor) <= idle`. Otherwise it returns `convertToShares(idle, Floor)`, and `convertToAssets(convertToShares(x, Floor), Floor) <= x`, so the payout fits in idle cash. `maxWithdraw = min(convertToAssets(balance, Floor), idle)`, and `convertToShares(convertToAssets(b, Floor), Ceil) <= b`, so the shares burned fit the balance. Medusa asserts both on every call with `useMax`, with no failure.
- **Emergency no-underflow:** `maxEmergencyWithdraw = floor(R * bal / S) - withdrawn`, and `withdrawn` is the sum of earlier payouts. Each earlier payout was `floor(R_i * bal / S) - withdrawn_i` for an earlier `R_i`, so `withdrawn = floor(R_last * bal / S)` with `R_last <= R`. The subtraction can't underflow while `R` doesn't decrease. `R` decreases only through the admin's `execute` or frxUSD's `burnFrxUsd` (both trusted roles). In those cases claimants who already withdrew get a reverting `maxEmergencyWithdraw` until receipts recover. That is a liveness effect, not a loss. Medusa asserts the conservation and order-independence properties on 175,209 payouts.

## Medusa

Harness: `test/security/medusa/MedusaHarness.sol` (config `medusa.json`, crytic-compile with `--foundry-compile-all`; corpus and coverage go to `cache/medusa-corpus/`, which git ignores). The harness doesn't wrap `test/invariant/Handler.sol`, because that depends on `vm.prank`/`vm.sign`/`setUp`. It is a self-contained equivalent: the harness deploys the system with itself holding every role. Lenders, members, and officers are `MedusaActor` wallets, and officers sign guaranties through ERC-1271, so the only cheatcode is `warp`. It has the same 22 actions as `Handler` plus `activateEmergency` (one call in 8) and `emergencyWithdraw`, at most 24 claims, and fees enabled (10% initially, 0 to 100% via `setParams`).

Assertions after every action:
- I-1: `totalAssets == balance + outstandingPrincipal`, and `outstandingPrincipal` equals an independent ghost (purchases minus booked principal returns minus write-offs).
- I-2: per-claim unpaid principal sums match `outstandingPrincipal` and both orgs' `orgOutstanding`.
- I-3: `amountPaid <= amountDue`.
- I-5: org cap holds at every purchase.
- I-7: pool balance equals deposits + settlements + donations - purchases - withdrawals - emergency payouts, and the registry holds 0.
- Emergency: `sum(maxEmergencyWithdraw + emergencyWithdrawn) <= receipts`, and with nonzero supply it is within 1 wei per holder of `receipts`. A payout equals the previewed `maxEmergencyWithdraw`, zeroes the payer's entitlement, and never lowers another holder's.

Per-call checks: `settle` takes at most `amountRemaining` and leaves exactly `remaining - paid`, and the principal it books equals `min(paid, unpaid principal)` (0 after a write-off). `withdraw(maxWithdraw)`, `redeem(maxRedeem)`, and any smaller amount never revert. Arithmetic underflow panics count as failures.

**Run:** 1 h 30 min wall clock, 6 workers, sequence length 100. 26,560,316 calls in 265,655 sequences, 2,751 branches, corpus 61. Throughput dipped to about 1k calls/s while other campaign jobs saturated the machine. **Result: 23/23 assertion tests passed, 0 failures.** Harness line coverage was 249/265; the misses are only the actor contract and public getters (see below). Paths reached, with hit counts: settle with booked principal (362,980), write-off (119,569), purchases (308,141), emergency activation (176,454), emergency payouts checked (175,209). The `settle` revert branch was never hit (0), so no valid settle reverted.

Coverage caveat: Medusa reports 0% for `ClaimRegistry` and `ReceivablesPool` (and the actor wallets). Those contracts have immutables and the repo builds with `bytecode_hash = "none"`, so Medusa can't match their deployed bytecode to source. The hit counts above, all in branches that only run when those contracts' calls succeed, show they were exercised.

**Finding from the smoke run (Low): emergency mode with zero supply strands receipts.** Sequence: the only lender redeems everything, frxUSD arrives (a donation, or in production a recovery payment on a written-off claim, which `settle` accepts in emergency mode), then the admin activates emergency mode. `maxEmergencyWithdraw` returns 0 for everyone (`supply == 0`), so the cash sits in the pool. Only the admin's `execute` can move it. The same state outside emergency mode is the zero-NAV recovery capture (F1): the next depositor takes it. The property now skips this case; it is documented, not a regression. Fix if wanted: refuse `activateEmergencyMode` at zero supply, or document `execute` as the recovery path.
