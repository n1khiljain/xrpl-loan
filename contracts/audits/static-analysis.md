# Static analysis

Tools run from `contracts/` on 2026-09-24:

- Slither 0.11.6, `slither .` with `slither.config.json` (filters `lib/`, `test/`, `script/`, fails CI on medium or higher)
- Aderyn 0.6.8, `aderyn .` (scans `src/`), full report in `aderyn-report.md`
- forge lint (built into forge 1.8.3, runs on every `forge build`; rechecked on 1.8.5 on 2026-10-21)

Every finding is either fixed or triaged below. Nothing is open. Slither 0.11.6 and Aderyn 0.6.8 were rerun on 2026-10-19 after emergency closeout (U-80). Slither reports the same 6 timestamp results (S-4); Aderyn retains the same one high and four low categories. Its refreshed report also includes the existing U-69 `setOrgCap` call, which was missing from the older saved report, and the new admin closeout entry. Both were rerun again on 2026-10-19 after sfrxUSD staking and the admin call (U-81, U-82), with the same versions run through `uvx` and `pnpm dlx`. Slither again reports only the 6 timestamp results; S-6 now also covers three new zero checks, and S-7 to S-9 are triaged below. Aderyn adds instances to A-H1, A-L1, and A-L3 only. Both were rerun a third time on 2026-10-19 after the two share classes and the yearly fee (U-83, U-84). Slither reports 7 timestamp results (S-4 gains the fee's elapsed-time math) and nothing else once S-10 and S-11 are handled; Aderyn adds A-H1 instances and one A-L5. Both were rerun a fourth time on 2026-10-20 after staking and the share classes were removed, keeping the yearly fee and `execute`. Slither reports the same 7 timestamp results and nothing else; Aderyn is back to the U-80 findings plus one A-L1 instance for `execute`. Slither 0.11.6 was rerun on 2026-10-21 after `execute` was deleted and the B-4c, B-7, and D-3 fixes: the same 7 timestamp results and nothing else Aderyn 0.6.8 rerun the same day: the same one high and four low categories, with A-L1 down to 22 instances now that `execute` is gone (`aderyn-report.md` refreshed). These tools do not establish that the contracts are secure.

## Slither

First run: 11 results plus one parser error. Current run: 7 results, all S-4, triaged, exit code 0.

| ID | Detector | Where | Severity | Status |
|---|---|---|---|---|
| S-1 | parser error: "Impossible to generate IR for ClaimRegistry._recordPurchase" | `ClaimRegistry._recordPurchase` | n/a | Fixed |
| S-2 | uninitialized-state: `_claims` is never initialized | `ClaimRegistry._claims` | High | Fixed (false positive caused by S-1) |
| S-3 | shadowing-local: `setRegistry(address registry)` shadows `registry()` | `IClaimNFT`, `IReceivablesPool` | Low | Fixed |
| S-4 | timestamp: comparisons use `block.timestamp` | `ClaimRegistry` (7 instances) | Low | Triaged, accepted |
| S-5 | unindexed-event-address: `RegistrySet(address)` | `IClaimNFT`, `IReceivablesPool` | Informational | Fixed |
| S-6 | incorrect-equality: zero emergency entitlement, zero staked shares, zero excess shares | `ReceivablesPool.emergencyWithdraw`, `ClaimRegistry._accrueFee` | Medium | Triaged, false positive; suppressed on each zero-amount check. The staking checks are gone with staking (2026-10-20) |
| S-7 | uninitialized-local: `token` in `setStakingVault` | `ReceivablesPool.setStakingVault` | Medium | Gone: staking was removed (2026-10-20) |
| S-8 | unused-return: `vault.redeem` in `claimYield` | `ReceivablesPool.claimYield` | Medium | Gone: `claimYield` was removed (U-83) |
| S-9 | reentrancy-benign: `totalYieldClaimed` written after `updateVaultTknOracle` | `ReceivablesPool.claimYield` | Low | Gone: `claimYield` was removed (U-83) |
| S-10 | parser error: "Impossible to generate IR for ClaimRegistry._accrueFee", with a false uninitialized-state on `_claims` | `ClaimRegistry._accrueFee` | n/a | Fixed, same cause as S-1 |
| S-11 | reentrancy-no-eth and reentrancy-benign: state written after `updateVaultTknOracle` | `ReceivablesPool.deposit`, `withdraw`, `redeem`, `fundPurchase`, `restake`, `emergencyUnstake` | Medium | Gone: staking was removed (2026-10-20) |
| S-12 | reentrancy-no-eth: `stakedShares` and share balances written after the swap | `ReceivablesPool._takeStakedCash`, `deposit` | Medium | Gone: staking was removed (2026-10-20) |

**S-1, S-2.** Slither could not build IR for `(price + Math.mulDiv(price, feeBps, BPS, Math.Rounding.Ceil)).toUint128()`, a `using SafeCast` call on a parenthesized expression that mixes `uint128` and `uint256`. It skipped the function, so it never saw the writes to `_claims` there and reported the mapping as uninitialized. The expression now computes `fee` and `due` as `uint256` locals first and calls `due.toUint128()`. Slither parses every function and S-2 no longer appears. Behavior is unchanged, and `testFuzz_purchaseClaim_amountDueRoundsUp` covers it.

**S-3.** Interface parameters renamed to `registry_`, matching the implementations.

**S-4.** The six comparisons are the guaranty deadline, approval expiry (twice), the due date for `Overdue` (twice), and the write-off grace. Each window is days or months long (14 days, 180 days, 60 days by default), so a sequencer shifting a timestamp by seconds can't change an outcome that matters. On Fraxtal the sequencer is centralized anyway, which `SECURITY.md` lists as a trust assumption. These are the business rules from PRD section 7, so they stay.

**S-5.** `registry` is now `indexed` on both `RegistrySet` events. The event signature, and so topic0, doesn't change.

**S-6.** Emergency cash entitlement deliberately comes from actual token balance plus past distributions. Rejecting a zero claim cannot strand a positive entitlement: a donation only increases cumulative receipts and entitlement, and rounding can defer tiny amounts until further cash arrives. The comparison is a zero-payment guard, not an expectation that a token balance equals a fixed target. The inline suppression is limited to that check; fuzz tests exercise repeated receipts, varied claim order, and rounding.

**S-6 (staking).** `unstakeAll` rejects an empty share balance and `claimYield` rejects zero excess shares. Both compare our own computed amounts to zero to refuse no-op calls; neither expects a balance to hit a target.

**S-8.** `claimYield` books `assets = vault.previewRedeem(excess)` before calling `redeem`, so the event and `totalYieldClaimed` are written before the external call. It refreshes the redeemer's oracle first, and the redeemer's own refresh is a no-op later in the same block, so `redeem` pays exactly the previewed amount. The fork test confirms it against the real redeemer.

**S-9.** The only call before the write is `updateVaultTknOracle()` on the admin-chosen redeemer, inside a `nonReentrant` function. The refresh has to come first so the excess-share math and the redeem use the same price.

**S-6 (fee).** `_accrueFee` returns early when no fee accrued; the comparison is on our own computed amount.

**S-10.** `(c.amountDue + fee).toUint128()` hit the same Slither IR gap as S-1. It now sums into a `uint256` local first.

**S-11.** Every staked-class path first calls the redeemer's `updateVaultTknOracle()` so the pool's quote (`previewDeposit`, `previewWithdraw`, `previewRedeem`) is the price the swap will use in the same block. The refresh moves no tokens, the redeemer is admin-chosen (Frax's), and every caller is `nonReentrant`. The writes after it are the pool's bookkeeping for the quoted swap, which only then runs.

**S-12.** Earlier drafts booked `stakedShares` and minted staked shares from the swap's return value. Now the pool books the quoted amounts, then swaps, then reverts with `StakingSwapMismatch` if the swap differs from the quote (`test_deposit_stakedRevertsIfTheSwapDiffersFromTheQuote`).

## Aderyn

1 high, 4 low. All triaged. Current run on 2026-10-20.

| ID | Finding | Where | Status |
|---|---|---|---|
| A-H1 | Reentrancy: state change after external call | `ClaimNFT.setRegistry`, `ReceivablesPool.setRegistry`, `ClaimRegistry.setOrgCap` | Triaged, false positive. The staking instances are gone with staking (2026-10-20) |
| A-L1 | Centralization risk (22 instances) | admin, underwriter, attester, pauser functions | Triaged, by design |
| A-L2 | Large numeric literal `10_000` | `ClaimRegistry.BPS` | Triaged, accepted |
| A-L3 | Unchecked return of `_grantRole` | four constructors | Triaged, accepted |
| A-L5 | Public function not used internally | `ReceivablesPool.totalAssets` | Gone: back to the ERC-4626 `public` override, which Aderyn doesn't flag (2026-10-20) |
| A-L4 | Unsafe `ERC721._mint` | `ClaimNFT.mint` | Triaged, by design |

**A-H1.** Before writing `registry`, `setRegistry` calls `IClaimRegistry(registry_).pool()` (or `.nft()`) to confirm the registry points back at this contract. That interface function is `view`, so Solidity compiles the call to `STATICCALL`, and the EVM rejects any state change during it. The callee can't reenter to change anything. The function is also admin-only and works once. The check exists because a wrong registry would brick the pool or NFT for good, since the address can never change (FR-C5). Tests: `test_setRegistry_revertsWhenRegistryPointsElsewhere` in both `ClaimNFT.t.sol` and `ReceivablesPool.t.sol`.

`setStakingVault` calls `asset()` and `vaultTkn()` on the candidate vault, both `view`, so `STATICCALL`. `deposit`, `restake`, and `emergencyUnstake` are the S-11 oracle refresh.

The refreshed report also flags `setOrgCap` calling `orgs.orgCount()` before storing the override. That interface call is `view` and therefore a `STATICCALL` too; it cannot reenter to change state. The org registry is an immutable reference to our own non-upgradeable contract, and the setter is admin-only.

**A-L1.** The roles are the product. PRD section 4 assigns them to Safes: underwriting, attesting, parameter changes, and pausing. `SECURITY.md` lists every role, what it can call, and what it would take to abuse it. The added `activateEmergencyMode` lets the admin permanently close operations, but only shareholders can claim their own emergency cash; there is no admin sweep. Root admin control can still manufacture claims through role grants and fake officers. This is an accepted trust assumption, not protection against admin compromise. The U-82 `execute`, which let the admin move every token the pool held, was deleted on 2026-10-21, so the admin has no call that moves pool cash directly.

**A-L2.** `BPS` is the basis-point denominator. `10_000` is the conventional way to write it and reads better than `1e4` next to `feeBps` and `advanceRateBps`.

**A-L3.** `_grantRole` returns false only when the account already holds the role. In a constructor nothing holds any role yet, so it always returns true.

**A-L4.** The only recipient is the pool (`nft.mint(address(pool), claimId)` in `ClaimRegistry.purchaseClaim`). The pool isn't an `IERC721Receiver`, and since transfers are disabled (U-19) the token never moves, so `_safeMint` would only add a callback that reverts. forge lint flags the same line, and it is suppressed there with this reason.

## forge lint

`forge build` runs forge's linter. It reports nothing now. How each earlier finding was handled:

| Lint | Where | Status |
|---|---|---|
| non-reentrant-not-first | `ReceivablesPool.fundPurchase` | Fixed: `nonReentrant` now comes before `onlyRegistry` |
| block-timestamp | `ClaimRegistry` | Excluded in `foundry.toml` for the same reason as S-4 |
| reentrancy-events (9) | `ClaimRegistry.submitClaim`, `settle`, `_recordPurchase`, `callGuarantor`, `writeOff`, `_accrueFee`; `ReceivablesPool.emergencyWithdraw` (the last four from forge 1.8.5) | Suppressed inline. Each event is emitted before any external call that can change state. The lint counts `SafeCast`/`Math` library calls and `view` calls as external calls |
| reentrancy-no-eth (3) | `ClaimRegistry.purchaseClaim`, `settle` | Suppressed inline. All state is written before the calls. The lint points at the OpenZeppelin guard's own status write, and the callees are our own NFT and pool plus frxUSD (a plain ERC-20, U-31) |
| unsafe-oz-erc721-mint | `ClaimNFT.mint` | Suppressed inline, same reason as A-L4 |
| environment-read-across-mutation (16) | tests | Fixed: tests read time with `vm.getBlockTimestamp()` |

forge 1.8.5 (2026-10-20, security campaign D-4) added six warnings in `src/` that 1.8.3 didn't report: `reentrancy-events` on `GuarantorCalled`, `ClaimWrittenOff`, and `FeeAccrued` in `ClaimRegistry` and on `EmergencyWithdrawal` in `ReceivablesPool`, and `arbitrary-send-eth` and `reentrancy-eth` on `ReceivablesPool.execute`. On 2026-10-21 the `execute` two went with `execute`, and the four `reentrancy-events` were suppressed inline with a reason, like the earlier ones: only `SafeCast`/`Math` library calls or `view` calls precede those events. `forge build` on 1.8.5 now reports nothing in `src/`. The same campaign ran Slither with all 102 detectors, `slither-check-erc` for ERC-20 and ERC-4626, and checked OpenZeppelin 5.3.0 against every published advisory: nothing new beyond the seven S-4 timestamp results. See `audits/security-tooling.md`.

## Reentrancy, reviewed by hand

The tools disagree about reentrancy, so here is the review:

- Every function that moves tokens is `nonReentrant`: `purchaseClaim`, `settle`, `fundPurchase`, `deposit`, `mint`, `withdraw`, `redeem`, `emergencyWithdraw`.
- `purchaseClaim` writes every piece of state and emits its event before calling `nft.mint` and `pool.fundPurchase`.
- `settle` updates `amountPaid`, `orgOutstanding`, and the claim state, and emits its events, before calling `pool.recordPrincipalReturned` and `frxUSD.safeTransferFrom`.
- `writeOff` writes state and emits before `pool.realizeLoss`.
- The only external contracts called are our own pool and NFT, the org registry (views only), frxUSD, and an optional ERC-1271 guarantor wallet during `submitClaim`. The guarantor check runs through `SignatureChecker` as a `STATICCALL`.
