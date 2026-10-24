# Security

Contracts for B@B x Frax college org financing: `ClaimRegistry`, `ReceivablesPool`, `ClaimNFT`, `OrgRegistry`, and the testnet-only `MockFrxUSD`. Solidity 0.8.28, `evm_version = "shanghai"`, OpenZeppelin Contracts 5.3.0. Nothing is upgradeable (U-03).

This is an unaudited MVP. It's rehearsed on Fraxtal testnet, and the October 11, 2026 hackathon puts real frxUSD in it on Fraxtal mainnet (U-68), with purchases limited by `perClaimCap`, each org's cap, and what Frax deposits. Report a vulnerability through a private GitHub security advisory on this repository, not in a public issue.

## Roles

Who holds each role comes from `deployments/<network>.json` (`roles`). On `local`, placeholder roles fall back to the deployer. On every other network the deploy script refuses to run until each role is a real address, then the deployer renounces every role it was not assigned (U-40).

| Role | Contract | Held by | Can call |
|---|---|---|---|
| `DEFAULT_ADMIN_ROLE` | `ClaimRegistry` | Admin Safe (`roles.admin`) | `setParams`, `setOrgCap`, `unpause`, `grantRole`, `revokeRole` |
| `UNDERWRITER_ROLE` | `ClaimRegistry` | Underwriter Safe (`roles.underwriter`) | `approveClaim`, `rejectClaim` |
| `ATTESTER_ROLE` | `ClaimRegistry` | Attester Safe (`roles.attester`) | `callGuarantor`, `writeOff` |
| `PAUSER_ROLE` | `ClaimRegistry` | Admin Safe and `roles.emergencyPauser` (a single key) | `pause` |
| `DEFAULT_ADMIN_ROLE` | `ReceivablesPool` | Admin Safe | `setRegistry` (once), `setLenderAllowed`, `setAllowlistEnabled`, `setDepositCap`, `activateEmergencyMode` (permanent), `grantRole`, `revokeRole` |
| `DEFAULT_ADMIN_ROLE` | `ClaimNFT` | Admin Safe | `setRegistry` (once), `setBaseURI`, `grantRole`, `revokeRole` |
| `DEFAULT_ADMIN_ROLE` | `OrgRegistry` | Admin Safe | `addOrg`, `setOrgActive`, `setOfficer`, `grantRole`, `revokeRole` |
| Registry | `ReceivablesPool`, `ClaimNFT` | The `ClaimRegistry` contract, set once and never changed (FR-C5) | `fundPurchase`, `recordPrincipalReturned`, `realizeLoss`, `mint` |
| Claimant | `ClaimRegistry` | The claim's `recipient`, the wallet that submitted it | `submitClaim`, `cancelClaim` (own `Submitted` claim), `purchaseClaim` (own `Approved` claim) |
| Guarantor | offchain | An active officer of the org who is not the claimant (U-34), checked at submission and again at purchase | Signs the EIP-712 `Guaranty`. Has no onchain call of its own. Pays like anyone else with `settle` |
| Anyone | `ClaimRegistry` | Any address | `settle` on a `Funded`, `GuarantorCalled`, or `WrittenOff` claim, even while paused |
| Lender | `ReceivablesPool` | Allowlisted addresses while the allowlist is on (U-15) | `deposit`, `mint` |
| Share holder | `ReceivablesPool` | Anyone holding pool shares | Normally `withdraw`, `redeem` (up to idle cash, even while paused), `transfer` (U-42). After emergency activation, only `emergencyWithdraw` for their own entitlement |
| Deployer | all | The wallet running `Deploy.s.sol` | Temporary admin during the deploy. Renounces on every network except `local` |

The admin role does not include underwriting, attesting, or pausing unless those roles are granted separately (FR-C13). The admin can grant them, so the admin Safe is the root of trust.

### What each role could do if compromised

| Role | Worst case | What limits it |
|---|---|---|
| Admin Safe | Add an org and a fake officer, grant itself underwriter, and buy made-up claims until idle cash runs out. It could also raise `feeBps` to 100% for future purchases, raise or lower caps, permanently activate emergency closeout, close deposits, or point NFT metadata anywhere | Safe threshold and signers (U-13). Every step emits an event, but the steps can be batched without a response window. It has no call that moves pool cash directly, so it cannot drain the pool in one step. Emergency activation cannot redirect shareholder funds: only holders claim their own cash entitlement. Terms of claims already purchased never change |
| Underwriter Safe | Approve bad claims for colluding claimants who have a real officer's guaranty | `perClaimCap`, the org's cap (`orgCap`: its override or `perOrgCap`), and idle cash. Each claim still needs a valid EIP-712 guaranty from an active officer |
| Attester Safe | Call a guarantor early with `AsucRejected` or `PartialShortfall`, then write the claim off after the grace period, which books a loss and lowers the share price | Can't move funds. Written-off claims still accept payment and recover in full. Every call and write-off is an event with a reason |
| Emergency pauser key | Pause new submissions, approvals, purchases, and deposits | Can't unpause. `settle`, `withdraw`, and `redeem` stay open (U-26). The admin unpauses and revokes the key |
| Deployer | Nothing after the deploy on non-local networks | Renounces all roles. `test_deploy_nonLocalHandsRolesToSafesAndRenounces` checks it |

## Trust assumptions

PRD section 12 lists Fraxtal and the frxUSD issuer. The rest follow from the design.

### Fraxtal (U-01)

Per L2BEAT's Fraxtal page:

- **Centralized sequencer.** One operator orders transactions. It can censor, delay, or reorder them, including settlements, pauses, and withdrawals, and it sets `block.timestamp`. Every time rule here is a window of days (14-day approval, 180-day due date, 60-day grace), so small timestamp shifts don't change outcomes.
- **Centralized proposer.** One party posts state roots to L1.
- **No working proof system.** Nobody can prove a state root wrong, so an L1 withdrawal trusts the proposer.
- **Instantly upgradeable system contracts.** Frax can change the chain's contracts with no delay or exit window.

Pool funds are only as safe as the people running Fraxtal.

### frxUSD issuer (U-31)

We assume frxUSD on Fraxtal behaves like a plain ERC-20: no transfer hooks, no fee on transfer, no rebasing, and 18 decimals. The deploy script checks the decimals. A fork probe on 2026-10-20 (block 42,873,553, `test/security/FrxUsdFork.t.sol`, finding D-1 in `audits/security-campaign.md`) confirmed transfers have no fee or hook, and found what the issuer can do:

- frxUSD is an EIP-1967 proxy upgraded through the Fraxtal ProxyAdmin predeploy. The token owner, the ProxyAdmin owner, and the timelock are one 3-of-5 Gnosis Safe, `0xC4EB45d80DC1F079045E75D5d55de8eD1c1090E6`.
- The owner can pause the token, which halts every pool flow.
- The owner or a freezer can freeze an account, and only the owner thaws. Freezing the pool blocks redeem, withdraw, `emergencyWithdraw`, and settlements into the pool, while `maxRedeem` still reports a positive amount. Freezing the registry blocks every settlement. Freezing a claimant makes `purchaseClaim` revert; freezing a payer blocks only that payer's `settle`. No account had ever been frozen at that block.
- The owner can burn any account's balance with `burnFrxUsd`, no allowance needed. Burning the pool's frxUSD lowers the share price with no write-off booked. In emergency mode the remaining holders split what is left on a first-come basis (see the emergency accounting below); nobody's `emergencyWithdraw` reverts from it.
- Upgrading the token can change any of the assumptions above.

Pool accounting reads `balanceOf(pool)`. A fee-on-transfer or rebasing change would break I-1 and I-7.

### Keys and Safes (U-13)

- Admin, underwriter, and attester are Safes on Fraxtal. Their signers and thresholds are trusted.
- Signers use Frax's Safe UI (U-27), and we trust it to show transactions accurately.
- The emergency pauser is a single key.

### Offchain checks the contracts don't enforce

- **KYC (U-24, U-36).** The underwriter confirms on net.frax.com that the claimant and guarantor passed KYC before approving. The contracts store no KYC flag.
- **The guaranty (U-10).** The signature is onchain evidence of the officer's promise. Collecting from a guarantor happens offchain.
- **The claim packet (U-20).** Only `packetHash` goes onchain. The underwriter must check that the receipts and CalLink number behind it are real. No names, emails, receipts, or CalLink numbers are stored onchain.
- **ASUC outcomes.** The attester decides when ASUC rejected or short-paid a claim, from claimant reports and ASUC records.
- **Reject reason codes (U-48).** The contract only requires a nonzero code. The admin app enforces the list.

### Design choices that carry risk

- **No timelock (U-12).** Parameter changes take effect in the same transaction. They apply only to later approvals and purchases.
- **Not upgradeable (U-03).** A bug means pausing, deploying new contracts, and moving lenders over. No one can change deployed code.
- **Registry wired once (FR-C5).** A wrong address would brick the pool or NFT, so `setRegistry` checks that the registry points back.
- **Liquidity.** Withdrawals are capped at idle cash (FR-C4). While claims are outstanding, lenders may not be able to exit in full.
- **Lenders take the losses (FR-C12).** A write-off lowers the share price for every share holder.
- **Built for one lender (U-79).** Unpaid principal on a `GuarantorCalled` claim counts at full value until `writeOff`, 60 days later. With two lenders, the first to exit in that window gets par and the other takes the whole loss (`test_redeem_exitDuringTheGraceShiftsTheLossToTheOtherLender`). Frax is the only lender in the pilot, so nobody else can be hurt. A second lender needs an exit haircut on that principal, and share transfers limited to allowlisted addresses, first.
- **Money after the last share (U-79).** Once every share is redeemed, the 6-decimal virtual shares own the pool, so a later payment on a written-off claim can't be reached by anyone, not even by depositing again (`test_settle_paymentAfterTheLastLenderLeavesIsStranded`). The lender keeps some shares while any written-off claim could still be paid (`docs/RUNBOOK.md`, "Seeding the pool with Frax's 40,000").
- **Transferable shares (U-42).** The allowlist gates deposits, not who ends up holding shares.
- **Permanent emergency closeout (U-80).** The pool admin can activate emergency mode independently of the registry. It permanently stops deposits, purchases, ordinary withdrawals/redemptions, and all share transfers. Neither unpausing the registry nor changing pool parameters reverses it. The emergency pauser key cannot activate it. Share ownership stays fixed and each holder calls `emergencyWithdraw(receiver)` for their own entitlement; there is no delegated claim or admin sweep. This can close the product permanently if the admin is compromised, but does not let that admin take another holder's entitlement.
- **No arbitrary call (U-82).** The pool had an admin `execute` fallback; it was removed on 2026-10-21 (security campaign B-4b, B-4c). A token stuck in the pool, or a bug this code didn't anticipate, now means pausing and a new deployment (U-03).
- **The fee accrues over time (U-84).** `feeBps` is a yearly rate on unpaid principal, snapshotted at purchase and added to `amountDue` on each payment, guarantor call, and write-off, rounded up each time. It stops once principal is paid and freezes at write-off. The amount owed changes every second, so a payer who approves exactly `amountRemaining` can fall a few wei short; the app approves an hour's extra fee, and `settle` only takes what's owed.
- **`perClaimCap` is checked at submit and approval, not at purchase (U-43).**
- **ERC-1271 guarantors (FR-C7).** For a smart-wallet guarantor, the wallet's `isValidSignature` decides validity. Contract signatures can be revoked, so validity is checked once, at submission.
- **`MockFrxUSD` (FR-C18).** Anyone can mint it. The deploy script deploys it only when `frxUSD` is null and refuses on Fraxtal mainnet (chain 252), decided by `block.chainid`, not the file. Outside local, the admin, underwriter, and attester must be three distinct contracts (Safes).
- **Compiler target (U-35, U-39).** Shanghai, which is why OpenZeppelin is pinned to 5.3.0.

## Properties the tests enforce

Invariants from PRD section 13 (`test/invariant/Invariants.t.sol`, 256 runs, depth 50, `fail_on_revert = true`):

- I-1: `totalAssets() == frxUSD.balanceOf(pool) + outstandingPrincipal`
- I-2: `outstandingPrincipal` is the unpaid principal across `Funded` and `GuarantorCalled` claims, and each org's `orgOutstanding` matches its share
- I-3: `amountPaid <= amountDue` for every claim
- I-4: the share price only drops on `writeOff`, allowing 1 wei of rounding
- I-5: at every purchase, the org's outstanding principal stays within its cap, which is `perOrgCap` unless the admin set an override with `setOrgCap` (U-69)
- I-6: terminal states never change, and `WrittenOff` can only move to `Recovered`
- I-7: frxUSD leaves the pool only through `purchaseClaim` and lender withdrawals
- I-8: what lenders can redeem never exceeds `totalAssets()`

A second, adversarial campaign (`test/invariant/AdversarialInvariants.t.sol`) adds an outsider holding transferred shares, an allowance spender, third-party payers, emergency mode, over-cap purchase attempts, and fees from 0 to 100%. It strengthens I-4 (a write-off lowers the price by exactly the loss per share) and I-5 (every over-cap attempt reverts with the expected error), and adds:

- I-9: no action moves value from one share holder to another beyond rounding, and NAV changes reach every holder pro rata
- I-10: `totalLosses` equals the written-off principal, and purchased principal equals outstanding plus losses plus principal returned
- I-11: in emergency mode, payouts plus idle cash equal what came in, and each holder's paid plus claimable equals its pro rata share

It held on three seeded runs of 2,000 × 300. It scopes out deposits while `totalAssets < 1e18` with shares outstanding (A-1). `audits/security-campaign.md` lists every finding and the tests that pin them.

Other controls: custom errors only, `SafeERC20` for every token call, `nonReentrant` on every function that moves tokens, checks-effects-interactions, no `tx.origin`, no `delegatecall`, no inline assembly in our code. `audits/static-analysis.md` has the Slither and Aderyn triage, and `audits/coverage.md` has coverage.

## Emergency distribution accounting (U-80)

Once emergency mode is activated, real share balances and total supply cannot change. Each holder's cumulative cash entitlement is:

`floor((idleCash + totalEmergencyWithdrawn) * balanceOf(owner) / totalSupply) - emergencyWithdrawn(owner)`

The result is capped at idle cash and never negative: if cash leaves the pool without a withdrawal (the frxUSD owner burning or seizing the pool's balance, D-1), a holder who already took more than its share of what is left gets 0, and the others take what is there, first come first served, instead of hitting an underflow or a failed transfer (`test_emergencyWithdraw_outflowLeavesEveryHolderAbleToDrawWhatIsThere`). Without such an outflow the cap never binds and claim order changes nothing.

Every successful claim updates the owner's and pool's cumulative payouts before transferring frxUSD. A failed token transfer rolls those updates back. Claim order does not change entitlement unless cash left the pool some other way. Shares are retained rather than burned, so a holder can claim all of today's entitlement and still receive its share of later settlements, fees, donations, and recoveries after a write-off. No virtual shares take a fraction of these distributions. With multiple holders, less than one frxUSD wei per holder can remain as rounding dust; future receipts may make it claimable.

The calculation uses neither registry calls nor ERC-4626 asset valuation. It can therefore distribute idle cash even if the registry is unavailable or outstanding-principal accounting makes normal withdrawals revert. It still relies on correct share balances, token balances and transfers, the pool code, and chain availability. It cannot recall money already paid to claimants, force settlement, recover inaccessible shareholder keys, or repair every possible contract bug. If zero shares remain before activation, this mechanism cannot reconstruct historical ownership or rescue already-stranded funds. Normal operation retains the U-79 risks above.

Emergency payouts reduce remaining `totalAssets` while shares stay fixed, so the normal-operation I-4 share-price condition does not apply to emergency mode. The additional fuzz tests check cash conservation, per-holder entitlement limits, order independence, and rounding across repeated receipts; unit tests cover frozen ownership, authorization, reentrancy, transfer rollback, broken registry/NAV, ordinary settlement, and late recoveries. The fork rehearsal also exercises closeout against real frxUSD at its pinned block. Existing deployments cannot gain this code; a new deployment and migration are required (U-03).
