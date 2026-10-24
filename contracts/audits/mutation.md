# Mutation testing

Security campaign, Workstream D item 1. Run on 2026-10-20 against the suite at commit `43e8408` (before the campaign's own tests landed).

## Setup

- Gambit 1.0.6, solc 0.8.28 (foundry's svm copy), remapping `@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/`.
- Files: `src/ReceivablesPool.sol`, `src/ClaimRegistry.sol`.
- Operators: `binary-op-mutation` (arithmetic and comparison swaps, including `>=`/`>`), `unary-operator-mutation`, `require-mutation`, `assignment-mutation`, `if-statement-mutation` (condition forced to `true`/`false`), `delete-expression-mutation`, `swap-arguments-operator-mutation`. Left out: `function-call-mutation`, `swap-arguments-function-mutation` and `elim-delegate-mutation`. Gambit has no event-argument operator, so event noise came only from statement deletion. The suite checks events with `expectEmit`, so every deleted `emit` was killed. The contracts use custom-error `if` guards, not `require`, so `require-mutation` produced no mutants.
- Kill criterion: `forge test --fail-fast --no-match-path 'test/fork/*'` (default profile: 1,000 fuzz runs, 256x50 invariant runs) fails. Gambit compiles every mutant first, so a mutant that doesn't compile is never generated.
- Runner: `test/security/run-mutants.sh`. It never touches `src/`. It copies `contracts/` into N throwaway workers, checks that the unmutated suite passes, and then runs the mutants in parallel. It writes `results.tsv` and `survivors.diff`. 5 workers took about 12 minutes.

To rerun only today's survivors against the campaign tests:

```sh
# keep the generated mutants from the first run, or regenerate (ids are deterministic for unchanged sources)
WORK_DIR=/tmp/mut-gen test/security/run-mutants.sh            # full run, generates mutants into /tmp/mut-gen/gambit_out
ONLY="331 371 427" MUTANTS_DIR=/tmp/mut-gen/gambit_out WORK_DIR=/tmp/mut-rerun test/security/run-mutants.sh
```

Mutant ids depend on the source text. If `src/` changed, rerun the whole set instead of passing `ONLY`.

## Totals

| File | Operator | Mutants | Killed | Survived |
|---|---|---|---|---|
| ReceivablesPool.sol | if-statement | 56 | 56 | 0 |
| ReceivablesPool.sol | assignment | 22 | 22 | 0 |
| ReceivablesPool.sol | binary-op | 20 | 20 | 0 |
| ReceivablesPool.sol | delete-expression | 20 | 20 | 0 |
| ReceivablesPool.sol | swap-arguments-operator | 6 | 6 | 0 |
| ClaimRegistry.sol | binary-op | 85 | 84 | 1 |
| ClaimRegistry.sol | if-statement | 80 | 79 | 1 |
| ClaimRegistry.sol | delete-expression | 64 | 64 | 0 |
| ClaimRegistry.sol | assignment | 59 | 58 | 1 |
| ClaimRegistry.sol | swap-arguments-operator | 26 | 26 | 0 |
| ClaimRegistry.sol | unary-operator | 2 | 2 | 0 |
| **Total** | | **440** | **437** | **3** |

Mutation score: 99.3% (100% on the pool). No timeouts.

## Survivors

| Mutant | Where | Mutation | Verdict | Test that kills it |
|---|---|---|---|---|
| 331 | `ClaimRegistry.sol:421` (`_storeClaim`) | `c.id = claimId` becomes `c.id = 1` | **Real gap (Info).** No test reads `getClaim(id).id` for a claim after the first. The field is only a stored copy, and the contracts key everything by the mapping key. Off-chain readers decode the struct with its `id` field (`packages/adapters/shared/claims.ts`), so a wrong value would mislabel claims there. | Submit two claims and assert `registry.getClaim(2).id == 2`. Better: assert `getClaim(id).id == id` inside `_recordStates` of the invariant handler. |
| 371 | `ClaimRegistry.sol:447` (`_checkPurchase`) | `if (price > idle) revert InsufficientIdleCash(price, idle)` becomes `if (false) ...` | **Equivalent.** `pool.fundPurchase` makes the same check with the same values (`amount > idleCash()`) and reverts with the same error, selector and arguments. The whole transaction rolls back, including the registry writes and the NFT mint made before the pool call. No observable behavior differs. The registry-side check is a duplicate guard that gives a clearer revert site. | Not killable through the external interface. Only a mocked pool that skips its own check (a unit test with `vm.mockCall` on `fundPurchase`) would tell them apart. That would test the duplicate, not a property. |
| 427 | `ClaimRegistry.sol:499` (`_pendingFee`) | `elapsed = block.timestamp - c.feeAccruedAt` becomes `block.timestamp % c.feeAccruedAt` | **Equivalent in practice.** `x % a == x - a` whenever `a <= x < 2a`. `feeAccruedAt` is a real timestamp (about 1.79e9) set at purchase and at each accrual, so the two differ only once more than about 56 years pass without an accrual. `_pendingFee` returns early for every state where `feeAccruedAt` could be 0. The fee fuzz test bounds elapsed at 3 years (`ClaimRegistry.fuzz.t.sol:80`). | Widen the fee fuzz test's elapsed bound to the `uint40` range: `bound(elapsed, 0, type(uint40).max - START_TIME)`. The expected fee is linear in elapsed, so any warp past `2 * feeAccruedAt` kills it. Worth doing because it also covers the fee math's overflow headroom. |

### Rerun against the campaign tests (2026-10-20, about 22:10)

The three survivors were rerun against a snapshot of `contracts/` that included the campaign tests landed so far (`AccessMatrix`, `DeployConfig`, `Limits`, `PoolEconomics`, `Reentrancy`, `RegistryEdges`). The unmutated baseline passed: 379 tests in 22 suites.

| Mutant | Result | Killed by |
|---|---|---|
| 331 | survived | still needs the `getClaim(2).id == 2` assertion |
| 371 | survived | equivalent, as expected |
| 427 | **killed** | `Limits.t.sol: testFuzz_accrueFee_neverOverflowsAtTheDeployedCap` (warps far enough that `ts % feeAccruedAt != ts - feeAccruedAt`) |

Mutation score with the campaign tests: 438/440. The only non-equivalent survivor is 331.

No pool mutant survived. Every `if` guard, accounting update, and comparison in `ReceivablesPool` (cap room, idle cash, emergency entitlement, `maxRedeem` balance check, `_update` freeze) is pinned by at least one failing test.

## Caveats

- One run, default fuzz seed. A mutant counted as killed only by a fuzz or invariant test could survive under another seed. Kills by a fuzz-only test are not separated out.
- The fork tests (`test/fork/*`, `test/security/FrxUsdFork.t.sol`) were excluded because they need an RPC. The Halmos `check_*` functions don't run under `forge test` and don't count.
- `function-call-mutation` was left out. It replaces calls with one of their arguments, which mostly targets `Math.min`/`mulDiv` calls that the binary-op mutants already reach.
