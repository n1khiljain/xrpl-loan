# PRD: College org financing on FraxNet

| Field | Value |
|---|---|
| Status | Draft v1 |
| Date | 2026-09-23 |
| Owner | Andrew Liu, Blockchain at Berkeley Design and Engineering |
| Partner | Frax |
| MVP launch | Sunday, October 11, 2026 hackathon, on Fraxtal testnet |
| Sources | FraxNet_Project_Overview.pdf, fa26-frax-proj Slack channel, Frax public docs |
| Related docs | `docs/UNCERTAINTIES.md` (open decisions for Frax), `docs/SYSTEM_DESIGN.md` (architecture), `docs/BRAND.md` (co-branding), `CLAUDE.md` (repo rules), `docs/GOALS.md` (build phases) |

Every choice in this PRD that Frax has not confirmed has an ID like `U-07` that points to an entry in `UNCERTAINTIES.md`. Build it as written here. Do not block on those entries.

---

## 1. Summary

Members of student orgs pay for events and supplies out of pocket, then wait weeks or months for ASUC to reimburse them. This product lets them sell that pending reimbursement claim to a frxUSD pool and get paid right away. When ASUC pays out, the claimant settles the claim with the pool. If ASUC never pays, an officer of the org who signed as guarantor owes the remainder.

- B@B builds the smart contracts, the claimant and lender apps, and the integration with FraxNet. Users complete KYC on FraxNet itself at https://net.frax.com, and our app reads their verification status (U-36).
- The app is Blockchain at Berkeley branded, built in collaboration with Frax and using Frax's visual theme. `docs/BRAND.md` has the rules.
- Frax seeds the pool, sponsors gas, provides FraxNet APIs and an engineering contact, and hosts the app at college.frax.com.
- The MVP runs on Fraxtal testnet for the October 11 hackathon, so no real money moves (U-33). Every network-specific value lives in config, so the same code deploys to other networks later.
- The hackathon is the launch point. B@B's own reimbursements are the first claims, followed by orgs where B@B members know the leadership.

## 2. Problem

- ASUC-funded orgs must run spending through CalLink. A member pays, files a purchase request with receipts, and waits through the org's finance review and then LEAD Center approval. ASUC then pays the member by direct deposit, mailed check, or pickup at Eshleman Hall.
- ASUC allocated $1.193M to 413 student orgs for fiscal 2026. Treasurers report reimbursements taking up to six months.
- Members who can't afford to front money don't run events. The project overview found the same pattern at other campuses, with waits of three to four months even when every form is filed correctly.
- B@B's own reimbursements are the first test case.

## 3. Goals and non-goals

### MVP goals

- A claimant receives frxUSD within two minutes of pressing "Get paid" on an approved claim.
- A lender can deposit, see where every dollar of pool money is, and withdraw idle cash.
- Every claim ends in a defined onchain state: settled, recovered, rejected, cancelled, or written off.
- The contracts are audit ready: NatSpec on every external function, fuzz and invariant tests, clean or triaged static analysis, and a written list of roles and trust assumptions.
- Every choice Frax hasn't confirmed sits behind config, an admin setter, or an adapter, and is logged in `UNCERTAINTIES.md`.

### Non-goals for the MVP

- Real money or a mainnet deployment.
- Lenders other than Frax.
- Fees or interest. The fee rate starts at 0.
- Automated approval or credit scoring.
- Self-service org registration.
- sfrxUSD yield on idle pool cash (U-16).
- Cross-chain deployment of the contracts.
- Any new token.

## 4. Users and roles

| Role | Who | What they do | How they sign |
|---|---|---|---|
| Claimant | A member who fronted money, or an org treasurer who fronted it for the org (U-11) | Submits claims, receives frxUSD, settles after ASUC pays | Privy embedded wallet |
| Guarantor | An active officer of the org who is not the claimant (U-34) | Signs a guaranty; owes the remainder if ASUC doesn't pay | Privy embedded wallet, EIP-712 signature |
| Lender | Frax in the MVP, allowlisted (U-15) | Deposits frxUSD, withdraws idle cash, monitors exposure | External wallet or Safe |
| Underwriter | B@B Safe multisig (U-13) | Reviews claims, approves or rejects | Safe on Fraxtal through Frax's Safe UI |
| Attester | B@B Safe multisig, separate role grant (U-13) | Calls the guarantor on ASUC rejection, short payment, or overdue claims; writes off losses | Safe |
| Admin | B@B Safe multisig, Frax signers optional (U-13) | Changes limits, manages orgs and officers, allowlists lenders, unpauses | Safe |
| Pauser | Admin Safe plus one emergency key | Pauses new activity; cannot unpause | Safe or a single key |
| Frax ops | Frax | Funds gas sponsorship, seeds the pool, provides FraxNet APIs, hosts the app | Offchain |

## 5. MVP scope

| Area | In the MVP | On testnet |
|---|---|---|
| Claim lifecycle | Submit, guaranty, approve, reject, cancel, purchase, settle, call guarantor, recover, write off | Real, onchain |
| Lender dashboard | Deposit, withdraw, pool stats, exposure by org, claims by state | Real, onchain |
| KYC | Claimants and guarantors verify on https://net.frax.com; our app links out and reads the result | Real KYC on FraxNet. Status read through Frax's partner API if ready by Friday, October 2; otherwise an underwriter confirms it with Frax and marks it in the admin app (U-07, U-36) |
| Cash-out to bank | Move frxUSD to a bank account through FraxNet | Onchain transfer real; bank step simulated and labeled (U-17) |
| Settlement funding | Claimant turns ASUC dollars into frxUSD and settles | "Simulate ASUC payout" button mints test tokens (U-25) |
| Gas | Sponsored by Frax | Real drip from a wallet funded by the Frax testnet faucet (U-05) |
| Admin | Review queue, exceptions, limits, org registry, lender allowlist | Real, through Safe (U-27) |

## 6. Product terms

All values below are initial config, not constants. The admin can change every one at runtime. Each change emits an event and applies to later approvals and purchases. A purchased claim keeps the fee and due date it was purchased under.

| Parameter | Initial value | Meaning | Open decision |
|---|---|---|---|
| `advanceRateBps` | 10000 (100%) | Max share of face value the pool will pay | U-12 |
| `perClaimCap` | 2,500 frxUSD | Max purchase price for one claim | U-12, U-30 |
| `perOrgCap` | 10,000 frxUSD | Max outstanding principal across one org's claims | U-12, U-30 |
| `poolDepositCap` | 50,000 frxUSD | Max total lender deposits | U-32 |
| `feeBps` | 0 | Discount fee added to the amount due | U-08 |
| `overdueWindow` | 180 days | Time after purchase before a claim can be called overdue | U-14 |
| `approvalExpiry` | 14 days | Time an approval stays valid before the claimant must press "Get paid" | U-28 |
| `writeOffGrace` | 60 days | Time after the guarantor is called before a write-off is allowed | U-30 |
| `lenderAllowlistEnabled` | true | Only allowlisted addresses can deposit | U-15 |

- The claimant requests any amount up to `min(faceValue * advanceRateBps / 10000, perClaimCap)`. The underwriter approves that amount or less.
- Amount due is the purchase price plus `purchasePrice * feeBps / 10000`, rounded up in the pool's favor. At `feeBps = 0`, the claimant settles exactly what they received.
- Use purchase language everywhere: "sell your claim," "purchase price," "amount due," "settle." Never use "loan," "borrow," "interest," or "repay" in contracts, events, UI copy, or docs (U-09).
- The admin can lower a limit below current exposure. That blocks new purchases until exposure falls, and never changes claims already purchased.

## 7. Claim lifecycle

### States

| State | Meaning | Terminal |
|---|---|---|
| `Submitted` | Claim and guaranty are onchain and waiting for review | No |
| `Approved` | Underwriter approved an amount; claimant can sell until the approval expires | No |
| `Funded` | Pool bought the claim and sent frxUSD to the claimant | No |
| `GuarantorCalled` | ASUC rejected the claim, paid less, or the claim is overdue; the guarantor owes the remainder | No |
| `Settled` | Paid in full while `Funded` | Yes |
| `Recovered` | Paid in full after the guarantor was called or after a write-off | Yes |
| `WrittenOff` | Unpaid principal booked as a pool loss; still accepts payments | No |
| `Rejected` | Underwriter declined | Yes |
| `Cancelled` | Claimant withdrew before approval | Yes |

An `Approved` claim past its expiry is not a separate state. It can't be purchased until the underwriter approves it again or rejects it.

### Transitions

| From | To | Function | Caller | Rules |
|---|---|---|---|---|
| none | `Submitted` | `submitClaim` | Claimant | Org is active. Guarantor is an active officer of the org and not the claimant. Guaranty signature is valid and unexpired. If the claimant picked "treasurer," the claimant is an officer. Requested amount is within limits. Not paused. |
| `Submitted` | `Cancelled` | `cancelClaim` | Claimant | None |
| `Submitted` | `Approved` | `approveClaim` | Underwriter | Approved amount is at most the requested amount. KYC checked offchain before approving (U-24). Not paused. |
| `Approved` | `Approved` | `approveClaim` | Underwriter | Re-approval resets the expiry |
| `Submitted` or `Approved` | `Rejected` | `rejectClaim` | Underwriter | Reason code required |
| `Approved` | `Funded` | `purchaseClaim` | Claimant | Before expiry. Org outstanding plus this claim is within `perOrgCap`. Pool has enough idle cash. Org still active. Not paused. Mints the claim NFT to the pool and sends frxUSD to the claimant. |
| `Funded` | `Funded` | `settle` | Anyone | Partial payment |
| `Funded` | `Settled` | `settle` | Anyone | Payment brings the total paid to the amount due |
| `Funded` | `GuarantorCalled` | `callGuarantor` | Attester | Reason `ASUC_REJECTED` or `PARTIAL_SHORTFALL` at any time (U-29); `OVERDUE` only after the due date |
| `GuarantorCalled` | `Recovered` | `settle` | Anyone, usually the guarantor | Payment brings the total paid to the amount due |
| `GuarantorCalled` | `WrittenOff` | `writeOff` | Attester | After the write-off grace period; the pool books unpaid principal as a loss |
| `WrittenOff` | `Recovered` | `settle` | Anyone | Payment brings the total paid to the amount due; recovered principal goes back to the pool |

- `settle` never takes more than the remaining amount due.
- Anyone can call `settle` on any claim, so a guarantor, treasurer, or teammate can pay it.
- `settle` works while paused, so money can always come back to the pool (U-26).
- Any transition not in this table reverts with a custom error.

## 8. User flows

### 8.1 Claimant sells a claim

1. Log in with email through Privy. An embedded wallet is created, and the gas sponsor tops it up.
2. Press "Verify with FraxNet." A new tab opens https://net.frax.com, where the user creates a FraxNet account (passkey or password) and completes Persona KYC. They add the wallet address our app shows them to their FraxNet account (U-37). Back in our app, the status shows as not started, pending, approved, or rejected.
3. Start a claim. Pick the org, then pick "I paid for this" or "I'm the treasurer and the org paid." Enter the amount on the purchase request, the CalLink purchase request number, and a short description. Upload receipts.
4. Pick a guarantor from the org's officer list. The app emails them a signing link.
5. After the guarantor signs, review and submit. The screen shows the requested amount, the amount due, and the overdue date.
6. Track the review on a status timeline.
7. After approval, press "Get paid." frxUSD arrives in the wallet.
8. Optionally cash out to a bank account (8.6).

### 8.2 Guarantor signs a guaranty

1. Open the emailed link and log in. If not yet verified, complete KYC on https://net.frax.com the same way as a claimant.
2. Read the claim summary: claimant, org, amount, receipts, and a plain-language statement of the obligation: "If ASUC doesn't pay this claim, you owe the pool the unpaid amount."
3. Sign the EIP-712 guaranty. It's a signature, not a transaction, so no gas is needed.
4. Get an email if the guarantor is ever called on this claim.

### 8.3 Underwriter reviews claims

1. Open the admin app inside Frax's Safe UI as a Safe App (U-27).
2. See each `Submitted` claim with receipts, the CalLink number, KYC status for claimant and guarantor, current org exposure, and pool idle cash.
3. Approve with an amount, or reject with a reason code. The action becomes a Safe transaction for the other signers.
4. Once the Safe transaction executes, the claimant's timeline updates and they get an approval email.

### 8.4 Attester handles exceptions

1. The exceptions list shows overdue claims and claims the claimant reported as "ASUC rejected" or "ASUC paid less."
2. Call the guarantor with a reason. The guarantor gets an email with the amount owed.
3. After the grace period, write off anything still unpaid.
4. A payment made after a write-off moves the claim to `Recovered` automatically once it covers the amount due.

### 8.5 Lender

1. Connect an allowlisted wallet.
2. Deposit frxUSD and receive pool shares.
3. Watch the dashboard: total assets, idle cash, outstanding principal, utilization, share price, realized losses, exposure by org, and claims by state.
4. Withdraw up to the pool's idle cash.

### 8.6 Cash-out to bank

- Mainnet: on https://net.frax.com, the user links a US bank through Plaid, which creates a liquidation address on Ethereum. Our app reads that address through Frax's API, or the user pastes it from FraxNet (U-37). The app sends frxUSD from Fraxtal to that address over Frax Mesh. FraxNet converts it and pays out by ACH or wire.
- Testnet: the frxUSD transfer out of the claimant's wallet is real, sent to a configured sink address. The bank step shows a simulated status under a "Testnet: simulated bank transfer" banner (U-17).

### 8.7 Settlement after ASUC pays

- Mainnet: ASUC pays the claimant's bank. The claimant turns those dollars into frxUSD through a virtual account on https://net.frax.com, then presses "Settle." Automatic settlement waits on A-01 and U-18.
- Testnet: "Simulate ASUC payout" mints test frxUSD to the claimant, then the claimant presses "Settle."
- The claimant can report "ASUC rejected my claim" or "ASUC paid less than I asked." Either report puts the claim on the attester's exceptions list.
- Partial settlements are allowed. The claim page shows the remaining amount due after each payment.

## 9. Functional requirements

Each requirement has an ID for tests, commits, and PRs.

### Contracts

- **FR-C1** `ReceivablesPool` is an ERC-4626 vault over frxUSD, using OpenZeppelin v5 with a virtual share offset against inflation attacks.
- **FR-C2** `totalAssets()` equals the pool's frxUSD balance plus the unpaid principal of every `Funded` and `GuarantorCalled` claim.
- **FR-C3** Deposits respect the lender allowlist when it is enabled and never push total deposits past `poolDepositCap`. `maxDeposit` and `maxMint` reflect both limits.
- **FR-C4** Withdrawals are limited to idle cash. `maxWithdraw` and `maxRedeem` reflect this.
- **FR-C5** Only `ClaimRegistry` can send pool funds to claimants and book settlements or losses. The registry address is set once and can't change.
- **FR-C6** `ClaimRegistry` implements the state machine in section 7 exactly.
- **FR-C7** Guaranties are EIP-712 signatures over the claim terms with a per-guarantor nonce and a deadline. The domain includes name, version, chain ID, and the registry address. Verification uses OpenZeppelin `SignatureChecker`, so ERC-1271 smart wallets also work.
- **FR-C8** Each claim stores: ID, org ID, recipient, recipient type, guarantor, face value, requested amount, approved amount, purchase price, amount due, amount paid, packet hash, fee snapshot, and timestamps for submission, approval expiry, purchase, due date, guarantor call, and write-off eligibility.
- **FR-C9** Limits are checked at submit (advance rate, per-claim cap), at approval (per-claim cap), and at purchase (per-org cap, idle cash).
- **FR-C10** Each purchase mints an ERC-721 from `ClaimNFT` with token ID equal to the claim ID, owned by the pool. Transfers are disabled in the MVP (U-19). `tokenURI` points to a metadata endpoint that carries no personal data.
- **FR-C11** `settle` pulls frxUSD from the payer with `transferFrom`, capped at the remaining amount due. Payments go to principal first, then the fee.
- **FR-C12** `writeOff` removes the unpaid principal from outstanding principal, which lowers the share price. Payments after a write-off go back into pool assets.
- **FR-C13** Roles use OpenZeppelin `AccessControl`: `DEFAULT_ADMIN_ROLE`, `UNDERWRITER_ROLE`, `ATTESTER_ROLE`, `PAUSER_ROLE`. The admin role doesn't include underwriting or attesting unless granted separately.
- **FR-C14** Pause blocks submit, approve, purchase, and deposit. Settle and withdraw stay open (U-26). Only the admin can unpause.
- **FR-C15** `OrgRegistry` lets the admin add orgs, activate or deactivate them, and set officers active or inactive (U-23). A deactivated org blocks new submissions and purchases but not settlement.
- **FR-C16** Every state change and parameter change emits an event with enough data to rebuild state from logs alone, without extra calls.
- **FR-C17** Contracts are not upgradeable (U-03). The deploy script reads addresses and parameters from the network config.
- **FR-C18** A `MockFrxUSD` with 18 decimals and an open `mint` deploys only when the network config sets `frxUSD` to `null`. The deploy script refuses to deploy the mock on a network with `isTestnet: false`.

### Backend

- **FR-B1** All backend logic runs in Supabase Edge Functions. Each function verifies the caller's Privy access token. The browser never holds a Supabase service key, and tables deny direct anonymous access.
- **FR-B2** Store one profile per wallet: email, Privy user ID, the FraxNet account identifier if Frax's API exposes one (U-37), a mirror of KYC status, where that status came from (`fraxnet_api` or `manual`), and who set it.
- **FR-B3** Receipts upload to a private storage bucket. Each file gets a SHA-256 hash. Only the claimant, the org's officers, and underwriters can read them.
- **FR-B4** Build the claim packet as canonical JSON (org ID, recipient, face value, CalLink number, sorted document hashes, created time) and return its `keccak256` as `packetHash`. Only the hash goes onchain (U-20).
- **FR-B5** Create guarantor invite links that expire after 7 days and email them.
- **FR-B6** KYC happens on https://net.frax.com, never inside our app. The `FraxNetClient` adapter reads a wallet's verification status (by webhook or polling, depending on Frax's API) and mirrors it into the profile. Until that API exists, underwriters set the status manually in the admin app after confirming with Frax, and every manual change is logged with the underwriter's wallet and time (U-36).
- **FR-B7** Run gas sponsorship through the `GasSponsor` adapter. Top up a wallet when its FRAX balance falls below a threshold, at most once per wallet per day, and only for wallets with a profile. The drip key lives in Supabase secrets.
- **FR-B8** Serve claim NFT metadata: state, org name, amounts, and dates. No names, emails, or receipts.
- **FR-B9** Send email when a guaranty is requested, a claim is approved, a claim is funded, a claim is 14 days from its due date, and a guarantor is called.
- **FR-B10** On testnets only, "simulate ASUC payout" mints mock frxUSD to the claimant. Config turns it off on mainnet.
- **FR-B11** Record claimant reports of "ASUC rejected" and "ASUC paid less" with an optional note, and surface them in the attester's exceptions list.

### Adapters

- **FR-A1** `FraxNetClient`, `GasSponsor`, `CashOut`, and `ChainReader` each have a real and a mock implementation. The network config picks which one runs.
- **FR-A2** Swapping an implementation touches only config and that adapter's folder.

### Frontend

- **FR-F1** Next.js with `output: 'export'` so any host can serve it (U-21). Pages for a specific record use query parameters, such as `/claim?id=12`, since a static export can't pre-render unknown IDs.
- **FR-F2** Privy handles login by email and creates an embedded wallet. Lenders can connect an external wallet through Privy instead.
- **FR-F3** The target network comes from config. If the wallet is on another network, the app asks to switch.
- **FR-F4** Claimant pages: onboarding with a "Verify with FraxNet" step that opens https://net.frax.com in a new tab and a "Check my status" button, a claims list, a new-claim wizard, and a claim page with a status timeline and the one action that fits the current state (get paid, settle, report ASUC outcome, cash out).
- **FR-F5** Guarantor page: claim summary, the plain-language obligation, and a sign button.
- **FR-F6** Lender dashboard with the stats in 8.5, plus deposit and withdraw.
- **FR-F7** Admin Safe App: review queue, exceptions list, parameter editor that shows current and proposed values side by side, org registry, and lender allowlist. Each action builds a Safe transaction. Outside a Safe, the page shows an "Open in Frax Safe" link and a Transaction Builder JSON export.
- **FR-F8** Claimant and guarantor screens show amounts in dollars and mention frxUSD once per screen. No hex addresses, wei, or gas language on those screens.
- **FR-F9** Every page shows a testnet banner when the config says `isTestnet: true`.
- **FR-F10** Every claimant and guarantor screen works at 375px wide.
- **FR-F11** ABIs come from `@wagmi/cli` reading Foundry output. Addresses come from `deployments/<network>.json`. Nothing is hand-copied.
- **FR-F12** Dashboard data comes through the `ChainReader` adapter. On testnet it reads contract state and logs over RPC, since Goldsky's Fraxtal testnet support is listed as coming soon. On mainnet it uses a Goldsky subgraph (U-22).

## 10. Network config

One file per network in `deployments/`. The deploy script picks it with `NETWORK=<name>`. The frontend and edge functions read the same file.

| Network | Chain ID | frxUSD | Adapters |
|---|---|---|---|
| `local` | 31337 (Anvil) | `null`, deploys mock | All mock |
| `fraxtal-testnet` | 2523 | `0xfc00000000000000000000000000000000000001`, or `null` if Frax can't supply test frxUSD (U-25) | FraxNet real or mock (U-07), gas drip, cash-out simulated, RPC reader |
| `sepolia` | 11155111 | `null`, deploys mock (U-02) | Same as Fraxtal testnet |
| `fraxtal` | 252 | `0xfc00000000000000000000000000000000000001` | All real, simulate payout off |

Example, `deployments/fraxtal-testnet.json`:

```json
{
  "network": "fraxtal-testnet",
  "chainId": 2523,
  "isTestnet": true,
  "rpcUrl": "https://rpc.testnet.frax.com",
  "explorer": "https://hoodi.fraxscan.com",
  "safeUi": "https://safe.testnet.frax.com",
  "gasFaucet": "https://faucet.testnet.frax.com",
  "frxUSD": "0xfc00000000000000000000000000000000000001",
  "fraxnet": {
    "appUrl": "https://net.frax.com",
    "apiBase": null
  },
  "fraxMesh": null,
  "cashOutSink": "0x000000000000000000000000000000000000dEaD",
  "roles": {
    "admin": "SET_AFTER_SAFE_CREATED",
    "underwriter": "SET_AFTER_SAFE_CREATED",
    "attester": "SET_AFTER_SAFE_CREATED",
    "emergencyPauser": "SET_AFTER_SAFE_CREATED"
  },
  "params": {
    "advanceRateBps": 10000,
    "perClaimCap": "2500000000000000000000",
    "perOrgCap": "10000000000000000000000",
    "poolDepositCap": "50000000000000000000000",
    "feeBps": 0,
    "overdueWindowSeconds": 15552000,
    "approvalExpirySeconds": 1209600,
    "writeOffGraceSeconds": 5184000,
    "lenderAllowlistEnabled": true
  },
  "adapters": {
    "fraxnet": "mock",
    "gasSponsor": "drip",
    "cashOut": "simulated",
    "chainReader": "rpc"
  },
  "features": {
    "simulateAsucPayout": true
  },
  "deployed": {}
}
```

- On `local`, any role left as `SET_AFTER_SAFE_CREATED` falls back to the deployer address. On every other network the deploy script stops if a role isn't a real address.
- The deploy script writes deployed contract addresses into `deployed`.

## 11. Stack

| Layer | Choice | Why |
|---|---|---|
| Chain | Fraxtal (testnet 2523 now) | frxUSD is native there, gas is near zero, and it's Frax's own chain (U-01) |
| Contracts | Solidity 0.8.x, Foundry, OpenZeppelin v5 | Foundry fuzz and invariant testing; audited building blocks |
| Admin keys | Safe on Fraxtal through Frax's Safe UI | Safe v1.4.1 is deployed on Fraxtal, and Frax runs the UI |
| Wallets and login | Privy embedded wallets | FraxNet's public API has no accounts; Privy works on any EVM chain and viem includes Fraxtal (U-04) |
| Gas | Backend drip funded by Frax | No public paymaster supports Fraxtal (U-05) |
| Identity and bank ramps | FraxNet at https://net.frax.com: Persona KYC, Bridge.xyz virtual accounts and liquidation addresses | Users already use it; Frax owns compliance |
| Cash-out routing | Frax Mesh from Fraxtal to an Ethereum liquidation address | Under a minute, versus 7 days on the native bridge |
| Frontend | Next.js static export, viem, wagmi, Tailwind, shadcn/ui, themed per `docs/BRAND.md` | Deploys to any host, including Frax's |
| Backend | Supabase Postgres, private storage, Edge Functions | Real database and private file storage in days |
| Indexing | RPC reads on testnet, Goldsky subgraph on mainnet | Goldsky lists Fraxtal mainnet; testnet support is pending |
| CI | GitHub Actions: forge test, coverage, Slither, Aderyn, lint, Playwright | Every PR proves it didn't break the money paths |

## 12. Non-functional requirements

### Security and audit readiness

- NatSpec on every external and public function.
- Custom errors, no revert strings.
- Checks-effects-interactions everywhere, plus `nonReentrant` on every function that moves tokens.
- `SafeERC20` for every token call.
- Pinned Solidity version, no floating pragma.
- No `tx.origin`, no `delegatecall`, no inline assembly.
- `SECURITY.md` lists every role, what it can do, and every trust assumption, including Fraxtal's (centralized sequencer and proposer, no working proof system, instantly upgradeable system contracts, per L2BEAT) and frxUSD issuer controls (U-31).

### Privacy

- No names, emails, receipts, or CalLink numbers onchain. Only `packetHash`.
- Receipts are readable only by the claimant, the org's officers, and underwriters.
- Emails live only in Supabase.
- Claim NFT metadata carries no personal data (FR-B8).

### Reliability

- If an edge function fails, the claimant can still settle directly onchain from the claim page.
- Gas drip failures show a clear retry message, not a stuck spinner.

### Usability

- A new claimant can go from login to submitted claim in under 5 minutes, not counting KYC review time.
- Every error message says what happened and what to do next.

## 13. Testing and definition of done

### Contract invariants (Foundry invariant tests with handler contracts)

- **I-1** `totalAssets() == frxUSD.balanceOf(pool) + outstandingPrincipal`.
- **I-2** `outstandingPrincipal` equals the sum of unpaid principal across `Funded` and `GuarantorCalled` claims.
- **I-3** For every claim, `amountPaid <= amountDue`.
- **I-4** The share price never goes down except in `writeOff`, allowing 1 wei of rounding.
- **I-5** At every purchase, the org's outstanding principal after the purchase is within `perOrgCap`.
- **I-6** Terminal states never change. `WrittenOff` can only move to `Recovered`.
- **I-7** frxUSD leaves the pool only through `purchaseClaim` and lender `withdraw` or `redeem`.
- **I-8** The total value lenders can redeem never exceeds `totalAssets()`.

### Coverage and tooling

- Contracts: 100% line coverage and at least 95% branch coverage.
- Unit tests for every function and every revert path.
- Fuzz tests over amounts, timestamps, and parameter changes.
- Slither and Aderyn run in CI. Every finding is fixed or triaged in `audits/static-analysis.md`.
- Playwright end-to-end tests cover the claimant, guarantor, underwriter, attester, and lender flows against Anvil with mock adapters.

### Definition of done for any feature

- Tests pass in CI.
- NatSpec and events are in place for any contract change.
- Docs are updated if behavior changed.
- Any new judgment call is logged in `UNCERTAINTIES.md`, and the code is tagged `// UNCERTAIN: U-xx`.

## 14. Milestones

| Dates | Milestone | Done when |
|---|---|---|
| Thu Sep 24 to Sat Sep 26 | M0: foundation | Monorepo scaffolded, network config in place, contract interfaces and state machine frozen, wireframes for claimant and lender flows, testnet Safes created |
| Sun Sep 27 to Thu Oct 1 | M1: core build | Contracts feature complete with unit and fuzz tests; claimant and lender flows working against Anvil; Supabase schema and edge functions up; Privy login working; all adapters mocked |
| Fri Oct 2 | KYC decision | Real FraxNet KYC is either working in dev or the mock is locked in for the demo (U-07) |
| Fri Oct 2 to Sat Oct 3 | M2: testnet deploy | Contracts on Fraxtal testnet; frontend deployed to a preview URL; pool seeded with test frxUSD |
| Sun Oct 4 to Thu Oct 8 | M3: integration | Guarantor flow, admin Safe App, exceptions flow, simulated cash-out, invariant tests, static analysis triaged, design polish |
| Tue Oct 6 | KYC cutoff for pilot users | Hackathon claimants and guarantors have started KYC (Persona takes 1 to 3 business days) |
| Fri Oct 9 to Sat Oct 10 | M4: dry run and freeze | B@B runs its own reimbursements through the full flow; bug bash; code freeze Saturday night |
| Sun Oct 11 | Launch | Live at the hackathon |
| Oct 12 to Oct 18 | Frax review | `UNCERTAINTIES.md` sent to Frax in one message; replies triaged into fixes |

## 15. Workstreams

Sized for 10 to 14 people.

| Workstream | People | Owns |
|---|---|---|
| Contracts | 3 | Pool, registry, NFT, org registry, tests, invariants, `SECURITY.md`, deploy scripts |
| Frontend | 3 to 4 | Claimant, guarantor, lender, and admin apps |
| Backend and adapters | 2 | Supabase schema, edge functions, FraxNet, gas, cash-out, and chain reader adapters |
| Design | 2 | Wireframes, visual design, copy for the obligation and purchase language |
| Go-to-market and onboarding | 2 | Recruiting pilot orgs, getting officers through KYC, hackathon logistics |
| PM and QA | 1 | Milestone tracking, `UNCERTAINTIES.md`, bug bash, dry run |

## 16. Success metrics for the October 11 pilot

These are proposed targets for the testnet pilot.

- At least 5 orgs onboarded with an active officer who has passed KYC.
- At least 15 claims purchased.
- Median time from submission to approval under 24 hours.
- Median time from "Get paid" to frxUSD in the wallet under 2 minutes.
- Every purchased claim is in a defined state with no stuck transactions.
- No critical or high findings open from internal review and static analysis.

## 17. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Frax's partner API isn't ready | We can't read KYC status automatically | Users still verify on net.frax.com; underwriters mark status manually after confirming with Frax (U-07, U-36) |
| Users' FraxNet account isn't linked to the wallet they use in our app | Status lookup fails | Onboarding shows the exact address to add in FraxNet (U-37) |
| Frax hasn't approved the co-branded design | Rework before launch | Send screens to Frax by Oct 5 (U-38) |
| No test frxUSD on Fraxtal testnet | Pool can't be seeded | Config switches to `MockFrxUSD` (U-25) |
| Frax expects real money at the hackathon | Demo doesn't match expectations | Ask now (U-33) |
| KYC takes longer than 3 business days | Pilot users can't sell claims on launch day | Start pilot KYC by Oct 6 |
| Purchase vs loan treatment under California law | Product may need a license or a restructure | Purchase language now; Frax counsel review (U-09, U-10) |
| ASUC rejects or short-pays claims | Losses to the pool | Manual underwriting, per-claim and per-org caps, guarantor |
| Gas drip key leaks | Drip wallet drained | Small balance, per-wallet rate limit, key in Supabase secrets |
| frxUSD issuer can freeze the pool's balance | Lender funds stuck | Document in `SECURITY.md`; ask Frax (U-31) |
| 18-day timeline | Features slip | Scope table in section 5 is the cut line; admin actions can fall back to Safe Transaction Builder JSON |

## 18. Two items that shouldn't wait for the batch

The plan is to send every open decision to Frax at once after the MVP is built. These two block MVP scope, so they're worth asking in the channel now:

- Partner API docs or sandbox access, especially how to read a user's net.frax.com verification status by wallet address (U-04, U-07, U-36, U-37).
- Test frxUSD on Fraxtal testnet to seed the pool, and whether Frax expects real money at the hackathon (U-25, U-33).

## 19. Glossary

- **Claim:** a pending ASUC reimbursement, identified by its CalLink purchase request number.
- **Face value:** the amount on the purchase request.
- **Purchase price:** what the pool pays the claimant.
- **Amount due:** what must be paid back to the pool; purchase price plus fee.
- **Guaranty:** the officer's signed promise to pay the remainder if ASUC doesn't pay.
- **Idle cash:** frxUSD sitting in the pool, not paid out on a claim.
- **Outstanding principal:** purchase price not yet paid back on `Funded` and `GuarantorCalled` claims.
- **Liquidation address:** a FraxNet address on Ethereum that converts frxUSD to dollars and sends them to a linked bank.
- **Virtual account:** FraxNet bank account details that turn incoming dollars into frxUSD.

## 20. References

- FraxNet_Project_Overview.pdf
- Frax docs: https://github.com/FraxFinance/docs
- Fraxtal network info: https://docs.frax.com (Fraxtal, network information)
- L2BEAT Fraxtal: https://l2beat.com/scaling/projects/fraxtal
- Daily Californian ASUC spending: https://data.dailycal.org/2026-01-06-asucspending/
- STAR reimbursement guide: https://rocketry.gitbook.io/public/tutorials/submitting-reimbursements
- Paul Hastings on the California Financing Law: https://www.paulhastings.com/insights/client-alerts/the-california-financing-law-commercial-and-consumer-lenders-beware
