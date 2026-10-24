# Coverage

Target from PRD section 13: 100% lines and at least 95% branches for every file in `contracts/src` except mocks.

Every file in `src/` is at 100% on all four measures, so there are no uncovered source lines to explain.

Run on 2026-10-20 with the installed forge 1.3.5 from `contracts/` (first run 2026-09-24; the prior report used forge 1.8.3, so executable line counts differ):

```bash
forge coverage --report summary
```

The `src/` rows were rerun on 2026-10-21 with forge 1.8.5, after the campaign fixes (`execute` deleted, B-4c, B-7, D-3); 1.8.5 counts more branches. The `script/Deploy.s.sol` row is from the earlier run.

| File | % Lines | % Statements | % Branches | % Funcs |
|---|---|---|---|---|
| src/ClaimNFT.sol | 100.00% (24/24) | 100.00% (25/25) | 100.00% (6/6) | 100.00% (8/8) |
| src/ClaimRegistry.sol | 100.00% (222/222) | 100.00% (290/290) | 100.00% (48/48) | 100.00% (36/36) |
| src/OrgRegistry.sol | 100.00% (29/29) | 100.00% (26/26) | 100.00% (4/4) | 100.00% (9/9) |
| src/ReceivablesPool.sol | 100.00% (111/111) | 100.00% (133/133) | 100.00% (31/31) | 100.00% (28/28) |
| src/mocks/MockFrxUSD.sol | 100.00% (3/3) | 100.00% (1/1) | N/A (0/0) | 100.00% (2/2) |
| script/Deploy.s.sol | 88.42% (84/95) | 91.34% (116/127) | 94.12% (16/17) | 90.91% (10/11) |

`src/interfaces/*` and `src/libraries/ClaimTypes.sol` hold only declarations (interfaces, enums, structs, errors), so they have no executable lines and don't appear in the report.

Forge disables the optimizer for coverage builds. All contracts compile without it and without via-IR, so the numbers above come from the same source that ships.

## Outside `src/`

These aren't part of the target, but the gaps are listed so nobody has to guess.

`script/Deploy.s.sol`:

- `_writeDeployment` and the `vm.isContext(ScriptBroadcast)` branch in `runFor()` only execute under `forge script --broadcast`. Unit tests can't enter a broadcast context, so they cover everything up to that point, including the dry run proving nothing gets written without `--broadcast` (`test_run_localDryRunDoesNotWriteConfig`). The write path is exercised end to end by the local anvil deploy, which writes `deployments/local.json`.

`test/utils/BaseTest.sol` and `test/invariant/Handler.sol`: test helpers. The uncovered lines are early returns and helper overloads that some suites don't use, and coverage runs only one pass of the invariant campaign.

## What the tests exercise

- Unit tests for every function and every revert path, including one test per row of the PRD section 7 transition table and a matrix test that tries every (state, function) pair outside the table and expects `InvalidState` (`test/unit/ClaimLifecycle.t.sol`).
- Fuzz tests (1,000 runs each) over amounts, timestamps, and parameter changes (`test/fuzz/`).
- Emergency closeout (U-80): 17 tests in `test/unit/EmergencyWithdraw.t.sol`, including two 1,000-run fuzz campaigns for order-independent pro rata cash allocation, conservation, and repeated receipts. Unit tests cover admin-only irreversible activation, frozen share transfers and ordinary exits, blocked purchases after registry unpause, caller-only entitlements, failed-transfer rollback, reentrancy, broken registry/NAV, fee distributions, total loss, and later settlements and written-off recoveries. No emergency action is included in the original normal-operation invariant handler; these additional tests cover the separate closeout accounting. The default full run passes 328 tests with the fork suite skipped.
- Staking and the two share classes (U-81, U-83) were removed on 2026-10-20, along with `ShareClasses.t.sol` and `MockMintRedeemer.sol`. The admin call (U-82) stayed then, with six `execute` tests; `execute` and those tests were deleted on 2026-10-21 (security campaign B-4b, B-4c).
- The yearly fee (U-84): purchase, settle, and exception tests check accrual on unpaid principal, rounding up, the rate snapshot, principal paid first stopping it, and write-off freezing it; `testFuzz_settle_principalFirstThenFee` pays at random times and checks every payment matches what `amountRemaining` showed. The default full run passes 340 tests with the fork suite skipped.
- Invariants I-1 to I-8 through a handler with `fail_on_revert = true`, 256 runs, depth 50 (`test/invariant/`). A one-off tally across all 256 runs counted about 830 purchases, 410 guarantor calls, 230 write-offs, and 770 settlement payments, with 0 reverts. Two injected bugs (skipping `recordPrincipalReturned` in `settle`, and letting a written-off claim move back to `GuarantorCalled`) both failed the campaign.
- A rehearsal of the mainnet pilot against Fraxtal mainnet's real frxUSD on a local fork (`test/fork/FraxtalPilot.fork.t.sol`), with the `deployments/fraxtal.json` terms: Frax's 10 frxUSD dry run and 40,000 seed, sixteen purchases that use all the cash, fourteen settlements, two write-offs (one after a partial guarantor payment), a payment after a write-off, and Frax redeeming its whole position. It skips unless `FRAXTAL_RPC_URL` is set, so `forge test` and CI stay offline. On 2026-10-16 it found that after any write-off `maxRedeem` came out a few share-wei under the last lender's balance, so `redeem(balanceOf(owner))` reverted. Fixed in `ReceivablesPool.maxRedeem`, with `test_maxRedeem_lastLenderRedeemsEverythingAfterAWriteOff` and `testFuzz_maxRedeem_soleLenderRedeemsEverythingAfterLoss`, both of which fail without the fix.
- Reran all six fork tests on 2026-10-19, and again on 2026-10-20 after staking was removed, at the suite's pinned block 42,686,534. The added emergency test pays all idle cash to Frax, then a partial settlement and a post-write-off recovery, without burning Frax's shares or stranding a remaining balance. All six pass. No transactions are broadcast.


## Security campaign (2026-10-20 to 2026-10-21)

`audits/security-campaign.md` has the findings. What it added to the tests:

- `test/security/`: 47 adversarial unit and fuzz tests (share-price fairness, reentrancy through a hooked token, an access matrix of every dispatched selector against ten roles, cast limits, registry edges, deploy config), 9 frxUSD fork probes that skip without `FRAXTAL_RPC_URL`, and Halmos `check_*` properties that `forge test` doesn't run. Tests named `documents...` assert today's behaviour for a finding and will fail once it's fixed.
- `test/invariant/AdversarialInvariants.t.sol`: a second handler with an outsider, an allowance spender, third-party payers, emergency mode, `execute` (removed 2026-10-21), and over-cap attempts, checking 15 invariants. Seeded deep runs (`FOUNDRY_PROFILE=deep`, 2,000 runs × depth 300, 600,000 calls each) passed on three seeds with 0 reverts. It caught all 10 bugs injected into a scratch copy.
- Mutation testing with Gambit (`audits/mutation.md`): 440 mutants of `ReceivablesPool.sol` and `ClaimRegistry.sol`. The suite before the campaign killed 437. With the campaign tests it kills 438; of the two left, one is equivalent and one (`c.id = 1`) needs a single assertion.
- Medusa, 90 minutes, 26.6 million calls on `test/security/medusa/`: no failures.

With the campaign tests, `forge test` passed 380 tests and skipped 2 (the fork suites). The 2026-10-21 fixes removed nine `execute` tests (six unit, three access-matrix), added the B-4c and D-3 tests, and turned B-7's `documents...` test into a revert test.
