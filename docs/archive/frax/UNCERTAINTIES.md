# Open decisions for Frax

Project: College org financing and tokenized receivables on FraxNet (Blockchain at Berkeley x Frax)
Owner: Andrew Liu
Last updated: 2026-09-24

## How to use this file

Every choice in this project was made by the B@B team as our best call, not confirmed by Frax. We build on these choices now and send this whole list to Frax once the MVP is built, then fix things based on their reply.

Each entry follows the same shape:

- **How it works now:** what we built
- **Alternative:** the other choice we are unsure about
- **Why we chose this:** our reasoning
- **What we need from Frax:** the exact question
- **Cost to change:** what breaks or has to be redone if Frax picks the alternative
- **Status:** `open`, `sent`, `answered`, or `changed`

### Rules for Claude Code

- When you make a judgment call that Frax has not confirmed, add an entry here in the same format. Do not stop the build to ask.
- Keep every choice listed here behind config, an adapter interface, or an admin setter where possible, so a "no" from Frax is a config or adapter change, not a rewrite.
- When code depends on an open entry, add a comment in the code with the entry ID, for example `// UNCERTAIN: U-07`.
- Do not delete entries. Mark them `answered` or `changed` and note the reply and the date.
- Questions for ASUC or other parties go in the "Not for Frax" section at the bottom.

---

## Chain and network

### U-01: Deploy on Fraxtal
- **How it works now:** Contracts deploy to Fraxtal (chain 252). The MVP runs on Fraxtal testnet (chain 2523, settles to Hoodi).
- **Alternative:** Ethereum mainnet, or another chain where FraxNet cross-chain mint is supported (Base, Arbitrum).
- **Why we chose this:** frxUSD and sfrxUSD are native on Fraxtal, gas is near zero, and the product showcases Frax's own chain.
- **What we need from Frax:** Is Fraxtal the chain you want this on? FraxNet's cross-chain mint list and fiat liquidation addresses do not include Fraxtal, so is that fine for you?
- **Cost to change:** Low. Network is a config value. Cash-out routing (U-12) changes.
- **Status:** open

### U-02: Testnet choice for MVP
- **How it works now:** The MVP runs on Fraxtal testnet using Frax's test frxUSD at `0xfc00000000000000000000000000000000000001`. Sepolia is a separate config target that deploys a `MockFrxUSD` because Frax has no Sepolia deployment.
- **Alternative:** Run the MVP on Sepolia with a mock token only.
- **Why we chose this:** Fraxtal testnet uses Frax's real test token, so the demo is closer to production.
- **What we need from Frax:** Do you have or plan a Sepolia frxUSD deployment? Which testnet do you want the demo on?
- **Cost to change:** Low. Config only.
- **Status:** open

### U-03: Contracts are not upgradeable
- **How it works now:** Immutable contracts with pause, caps, and redeploy through config when a new version is needed.
- **Alternative:** UUPS or transparent proxies, which is what FraxNet's own contracts use (beacon and transparent proxies).
- **Why we chose this:** Fewer audit findings (storage layout, initializer bugs) and a small capped pilot does not need upgrades.
- **What we need from Frax:** Do you require upgradeability to match your stack or your audit firm's expectations?
- **Cost to change:** Medium. Initializers, storage gaps, and new tests.
- **Status:** open

## Accounts, identity, and gas

### U-04: Users log in with Privy embedded wallets
- **How it works now:** Privy embedded wallets on Fraxtal are the login and signing layer. FraxNet is used for KYC and fiat ramps through a `FraxNetClient` adapter.
- **Alternative:** Users log in with FraxNet accounts and transactions go through FraxNet's transaction initiation API.
- **Why we chose this:** The public FraxNet Orchestration API has no accounts or auth and only handles mint, redeem, and bridge. We could not confirm FraxNet can call arbitrary contracts for a user.
- **What we need from Frax:** Please share the partner API docs or a sandbox for identity and KYC, account read and write, and transaction initiation (promised in the project overview). Can transaction initiation call our contracts on Fraxtal, or only send frxUSD?
- **Cost to change:** Medium. Swap the auth provider and the adapter implementation. Contracts do not change.
- **Status:** open

### U-05: Gas sponsorship method
- **How it works now:** Frax sponsors gas. We built a backend gas drip: each new wallet gets a small FRAX amount from a Frax-funded hot wallet. It sits behind a `GasSponsor` interface.
- **Alternative:** An ERC-4337 paymaster run by Frax, or an ERC-2771 meta-transaction relayer.
- **Why we chose this:** No public paymaster supports Fraxtal (Pimlico does not list it) and Fraxtal gas costs fractions of a cent.
- **What we need from Frax:** Which method do you want on mainnet, and who holds the drip wallet key?
- **Cost to change:** Low for a relayer. Medium for a paymaster (needs smart accounts).
- **Status:** open

### U-06: Who gets KYC'd
- **How it works now:** The claim recipient (member or treasurer) and the guarantor officer each complete KYC on https://net.frax.com. We do not KYB the org.
- **Alternative:** KYB the org as a business.
- **Why we chose this:** Most student orgs are not incorporated, so KYB would likely fail. ASUC pays individuals, not orgs.
- **What we need from Frax:** Does your compliance setup accept individual KYC for this product? Do you need KYB anywhere?
- **Cost to change:** Low in code. Could affect onboarding time (Persona takes 1 to 3 business days).
- **Status:** open

### U-07: Reading KYC status if the partner API is not ready
- **How it works now:** Users always complete real KYC on https://net.frax.com. `FraxNetClient` reads their status through Frax's partner API if it's ready by Friday, October 2. If not, an underwriter confirms each user's status with Frax and marks it in the admin app, and the mock adapter is used in development.
- **Alternative:** Delay the demo until real KYC works.
- **Why we chose this:** The overview says the timeline assumes working interfaces "or very soon to be," so we do not block on them.
- **What we need from Frax:** Which interfaces exist today and when do the rest ship? Who is our engineering point of contact?
- **Cost to change:** None if the adapter holds.
- **Status:** open

## Product and credit terms

### U-08: Interest free to start
- **How it works now:** The fee rate is an admin-settable value set to 0. Fee logic stays in the contract. No subsidy contract in the MVP.
- **Alternative:** Orgs pay nothing but lenders earn a real rate paid by Frax (the structure described in the overview), which needs a subsidy contract.
- **Why we chose this:** Frax said it will be interest free to start, and Frax is the only lender in the MVP.
- **What we need from Frax:** When do fees turn on, and should lenders earn a rate funded by Frax before then?
- **Cost to change:** Medium. Add `SubsidyManager` and tests.
- **Status:** open

### U-09: Receivable purchase vs loan
- **How it works now:** The pool buys the receivable at a discount (currently 0). Functions and UI use purchase language: `purchaseClaim`, `discount`, `settle`. The claim NFT moves to the pool.
- **Alternative:** Model it as a loan with `borrow`, `interest`, `repay`.
- **Why we chose this:** Under the California Financing Law, loans under $5,000 are treated as consumer loans needing a license, while factoring falls outside that licensing requirement. Recourse to a guarantor may still make it look like a loan. This is not legal advice.
- **What we need from Frax:** Please have your counsel confirm purchase vs loan framing and how much recourse is acceptable.
- **Cost to change:** Low now (renames), high after an audit.
- **Status:** open

### U-10: Guarantor recourse
- **How it works now:** An officer signs an EIP-712 guaranty from their wallet before a claim can be approved. The signature is stored onchain as evidence. Enforcement is offchain.
- **Alternative:** No personal guarantor, with the org's future ASUC funding as recourse instead, or no recourse.
- **Why we chose this:** The overview names an officer guarantor.
- **What we need from Frax:** Does your counsel accept a student officer personally guaranteeing? Who enforces it?
- **Cost to change:** Low. Remove the signature check.
- **Status:** open

### U-11: Recipient can be a member or the org treasurer
- **How it works now:** Each claim sets its own `recipient` wallet, either the member who fronted the money or the org treasurer, plus an `orgId` and a `guarantor`.
- **Alternative:** Only members, or only treasurers.
- **Why we chose this:** ASUC reimburses the individual who paid, but some orgs front costs from a treasurer. Supporting both covers every case.
- **What we need from Frax:** Any compliance problem with funding either kind of recipient?
- **Cost to change:** Low. Restrict in the approval check.
- **Status:** open

### U-12: Limits are set at runtime, not hardcoded
- **How it works now:** The admin multisig can change advance rate, per-claim cap, per-org cap, pool cap, fee rate, and overdue window. Each change emits an event. The claimant requests any amount up to the limits, and the underwriter can approve that amount or less.
- **Alternative:** Fixed limits set at deploy, or timelocked changes.
- **Why we chose this:** Terms will change as we learn from real repayment data.
- **What we need from Frax:** Should limit changes go through a timelock or need a Frax signer?
- **Cost to change:** Low. Wrap setters in a timelock.
- **Status:** open

### U-13: B@B multisig approves claims
- **How it works now:** A Safe multisig on Fraxtal holds the underwriter role (approves claims) and a separate attester role (marks settled, overdue, or rejected). Admin uses Frax's Safe UI at safe.mainnet.frax.com.
- **Alternative:** Frax holds the underwriter role, or claims under a limit auto-approve.
- **Why we chose this:** Manual review is safest for a pilot and gives clean data for a later credit model.
- **What we need from Frax:** Do you want signers on the underwriter or admin Safe? Who should hold which role?
- **Cost to change:** Low. Role assignment only.
- **Status:** open

### U-14: Overdue window
- **How it works now:** A claim is overdue 180 days after funding. Admin-settable.
- **Alternative:** A shorter window such as 90 or 120 days.
- **Why we chose this:** Reported ASUC reimbursement waits run up to six months.
- **What we need from Frax:** What window do you want before the guarantor is called?
- **Cost to change:** None. Config value.
- **Status:** open

### U-15: Lender deposits are allowlisted
- **How it works now:** Only allowlisted addresses can deposit into the pool. Frax is the only lender in the MVP.
- **Alternative:** Open deposits from day one.
- **Why we chose this:** At a 0 fee, lenders earn nothing and absorb defaults, so only Frax should be exposed.
- **What we need from Frax:** When do you want third-party LPs, and do LPs need KYC?
- **Cost to change:** None. Admin toggle.
- **Status:** open

### U-16: Idle pool cash is not put to work
- **How it works now:** Idle frxUSD sits in the pool.
- **Alternative:** Park idle cash in sfrxUSD so lenders earn Treasury yield while it waits.
- **Why we chose this:** A second yield source adds audit surface before the pilot proves out.
- **What we need from Frax:** Do you want sfrxUSD integration in the first version or later?
- **Cost to change:** Medium. New strategy logic and tests.
- **Status:** open

## Money movement

### U-17: Cash-out to bank on testnet is simulated
- **How it works now:** On testnet, frxUSD moves to the recipient for real. The bank transfer step is a simulated screen labeled as testnet. On mainnet, cash-out sends frxUSD over Frax Mesh to the user's FraxNet liquidation address on Ethereum.
- **Alternative:** Skip cash-out until mainnet, or use a different off-ramp.
- **Why we chose this:** Liquidation addresses and Bridge.xyz bank transfers only exist on mainnet.
- **What we need from Frax:** Does Frax Mesh run on testnet? Can a Mesh transfer target a liquidation address directly? Is there a testnet sandbox for the fiat ramp?
- **Cost to change:** Low. Adapter swap.
- **Status:** open

### U-18: Settlement is manual in v1
- **How it works now:** After ASUC pays, the recipient settles the claim with frxUSD. The attester role marks claims overdue or rejected.
- **Alternative:** ASUC pays a FraxNet virtual account that forwards frxUSD straight to the pool, so claims settle automatically.
- **Why we chose this:** ASUC pays the member's own bank account, so automatic settlement needs ASUC to pay a third party (see A-01).
- **What we need from Frax:** Can a FraxNet virtual account deliver frxUSD to a contract address on Fraxtal, and include a reference so we can match the payment to a claim?
- **Cost to change:** Medium. Add a sweeper that holds the attester role.
- **Status:** open

## Data and infrastructure

### U-19: One NFT per claim
- **How it works now:** Each funded claim mints an ERC-721 that moves to the pool.
- **Alternative:** Track claims only in contract storage.
- **Why we chose this:** The overview title says "tokenized receivables," and an NFT lets receivables be sold or pooled later.
- **What we need from Frax:** Do you want the NFT, and should it be transferable?
- **Cost to change:** Low.
- **Status:** open

### U-20: Receipts stay offchain
- **How it works now:** Receipts and ASUC reference numbers live in a private Supabase bucket. Only a `keccak256` hash of the claim packet goes onchain.
- **Alternative:** Store documents in FraxNet's systems or on IPFS.
- **Why we chose this:** Receipts contain student names and purchase details.
- **What we need from Frax:** Do you need a copy of claim documents for compliance, and where should they live?
- **Cost to change:** Low.
- **Status:** open

### U-21: Hosting format
- **How it works now:** The frontend builds as a static export. All server work runs in Supabase Edge Functions.
- **Alternative:** A Next.js server deployment on Vercel or Frax's infrastructure.
- **Why we chose this:** A static export can go on any host, and the overview says Frax deploys it at a frax.com subdomain.
- **What we need from Frax:** What build format do you want for college.frax.com, and who owns the Supabase project?
- **Cost to change:** Low.
- **Status:** open

### U-22: Indexing with Goldsky
- **How it works now:** On testnet, the dashboard reads contract state and logs over RPC. On mainnet, a Goldsky subgraph built from our ABI powers lender dashboard history. Both sit behind a `ChainReader` adapter.
- **Alternative:** The Graph, or a self-hosted Ponder indexer.
- **Why we chose this:** Frax's docs list Goldsky for Fraxtal mainnet and it supports subgraphs built straight from an ABI. Frax's docs list Goldsky's Fraxtal testnet support as coming soon.
- **What we need from Frax:** Do you already use an indexer we should share?
- **Cost to change:** Low.
- **Status:** open

### U-23: Admin manages the org registry
- **How it works now:** The admin adds orgs and assigns officers. Orgs do not register themselves.
- **Alternative:** Self-service org signup with verification.
- **Why we chose this:** Small pilot with orgs we know personally.
- **What we need from Frax:** Fine for the pilot?
- **Cost to change:** Medium.
- **Status:** open

## Added with the PRD (2026-09-23)

### U-24: KYC is checked by the underwriter, not onchain
- **How it works now:** The underwriter checks the claimant's and guarantor's KYC status in the admin app before approving. The contracts do not store a KYC flag.
- **Alternative:** An onchain verified-address registry that `purchaseClaim` checks, written by a backend key after FraxNet reports approval.
- **Why we chose this:** No hot key with onchain write power, and every approval already passes through a human.
- **What we need from Frax:** Do you need KYC enforced onchain for compliance, or is an underwriter check enough?
- **Cost to change:** Medium. New registry, a backend signer, and tests.
- **Status:** open

### U-25: Test frxUSD on Fraxtal testnet
- **How it works now:** Config points at Frax's test frxUSD (`0xfc00000000000000000000000000000000000001`). If we can't get test tokens, config switches to `MockFrxUSD` on Fraxtal testnet. "Simulate ASUC payout" needs a mintable token.
- **Alternative:** Frax mints test frxUSD to us and runs a faucet.
- **Why we chose this:** The Frax testnet faucet only gives FRAX for gas.
- **What we need from Frax:** Can you send test frxUSD to seed the pool, and is there a faucet for claimants?
- **Cost to change:** None. Config value.
- **Status:** open

### U-26: What pause blocks
- **How it works now:** Pause blocks submit, approve, purchase, and deposit. Settle and lender withdraw stay open. Only the admin can unpause.
- **Alternative:** Pause freezes everything, including withdrawals.
- **Why we chose this:** Money should always be able to come back to the pool and go back to lenders.
- **What we need from Frax:** Should an emergency pause also freeze withdrawals?
- **Cost to change:** Low.
- **Status:** open

### U-27: Admin actions run as a Safe App
- **How it works now:** The admin pages load inside Frax's Safe UI (safe.testnet.frax.com, safe.mainnet.frax.com) as a Safe App and propose Safe transactions. Outside a Safe they export Transaction Builder JSON.
- **Alternative:** Propose transactions through the Safe Transaction Service API from our own app.
- **Why we chose this:** No extra backend, and signers use a UI they already trust.
- **What we need from Frax:** Can we register a custom Safe App on your Safe UI deployments?
- **Cost to change:** Low.
- **Status:** open

### U-28: Approval then "Get paid" as two steps
- **How it works now:** The underwriter approves an amount. The claimant presses "Get paid" within 14 days (`approvalExpiry`) to receive funds.
- **Alternative:** Funds go out automatically when the approval executes.
- **Why we chose this:** The overview describes orgs "drawing funds," and the claimant confirms the final amount before taking it.
- **What we need from Frax:** Any preference?
- **Cost to change:** Low.
- **Status:** open

### U-29: ASUC short payment goes to the guarantor
- **How it works now:** If ASUC pays less than the amount due, the claimant settles what ASUC paid, and the attester calls the guarantor for the rest with reason `PARTIAL_SHORTFALL`.
- **Alternative:** The pool absorbs short payments below a threshold.
- **Why we chose this:** Keeps the pool whole and uses one recourse path.
- **What we need from Frax:** Is guarantor recourse for small shortfalls acceptable?
- **Cost to change:** Low.
- **Status:** open

### U-30: Initial limit values
- **How it works now:** `perClaimCap` 2,500 frxUSD, `perOrgCap` 10,000 frxUSD, `writeOffGrace` 60 days. All admin-settable.
- **Alternative:** Values Frax picks.
- **Why we chose this:** Most club reimbursements are small, and the caps bound the loss from any one claim or org.
- **What we need from Frax:** What starting values do you want?
- **Cost to change:** None. Config values.
- **Status:** open

### U-31: frxUSD issuer controls
- **How it works now:** We assume frxUSD behaves as a standard ERC-20 on Fraxtal. `SECURITY.md` lists any issuer freeze or blocklist power as a trust assumption.
- **Alternative:** Handle frozen balances explicitly in the contracts.
- **Why we chose this:** We could not find frxUSD's Fraxtal freeze or blocklist behavior in the public docs.
- **What we need from Frax:** Can frxUSD on Fraxtal freeze or block an address, and under what policy?
- **Cost to change:** Low for documentation. Medium if contracts must handle frozen transfers.
- **Status:** open

### U-32: What the $50K seed means
- **How it works now:** `poolDepositCap` is 50,000 frxUSD, and Frax deposits the seed. Settled claims free up cash for new claims, so total purchased volume can exceed $50K.
- **Alternative:** The $50K caps cumulative purchased volume, not pool size.
- **Why we chose this:** The overview says Frax seeds the pool "for the first $50,000 in loan volume," which could mean either.
- **What we need from Frax:** Is $50K a cap on pool size or on cumulative volume? From which address will you deposit?
- **Cost to change:** Low. Add a cumulative volume counter and cap.
- **Status:** open

### U-33: Testnet MVP at the hackathon
- **How it works now:** The October 11 launch runs on Fraxtal testnet. Pilot orgs go through the full flow with their real claims, but no real money moves.
- **Alternative:** Launch on mainnet with real frxUSD and capped exposure.
- **Why we chose this:** 18 days is not enough time for an external audit, and testnet removes the risk of losing real funds.
- **What we need from Frax:** The overview calls the hackathon a launch "against real reimbursement volume." Do you expect real money on October 11?
- **Cost to change:** High on the timeline. The code only needs a config change, but mainnet needs an audit and real KYC first.
- **Status:** changed 2026-09-24: the hackathon moved to mainnet, see U-68

### U-34: Guarantor must be a different person from the claimant
- **How it works now:** `submitClaim` rejects a guaranty signed by the claimant, even when the claimant is an officer.
- **Alternative:** Allow a treasurer to guarantee their own claim.
- **Why we chose this:** A self-guaranty adds no recourse beyond the claimant.
- **What we need from Frax:** Agree?
- **Cost to change:** Low.
- **Status:** open

### U-35: Compile for the Shanghai EVM version
- **How it works now:** Contracts compile with Solidity 0.8.28 and `evm_version = "shanghai"`, so they can't use transient storage or other Cancun opcodes.
- **Alternative:** Compile for Cancun, which allows `ReentrancyGuardTransient` and cheaper reentrancy guards.
- **Why we chose this:** We could not confirm from public docs which OP Stack hardforks Fraxtal mainnet and testnet have activated, and Shanghai is the safer target.
- **What we need from Frax:** Does Fraxtal support Cancun opcodes (MCOPY, TSTORE, TLOAD) on mainnet and testnet?
- **Cost to change:** Low. One foundry.toml line and a recompile.
- **Status:** open

### U-36: How our app learns a user passed KYC on net.frax.com
- **How it works now:** Users verify on https://net.frax.com, not in our app. Our app links out, then reads status through `FraxNetClient.getVerificationStatus(wallet)`. Until Frax's API exists, underwriters set status manually after confirming with Frax, and each manual change is logged.
- **Alternative:** Frax sends a webhook to our backend when a linked user is approved, or FraxNet issues an onchain attestation we can read.
- **Why we chose this:** FraxNet already runs Persona KYC, and Frax owns compliance, so we don't collect identity data.
- **What we need from Frax:** What endpoint or webhook tells us a given wallet's verification status? Does the result include individual vs business and the date approved?
- **Cost to change:** Low. Adapter only.
- **Status:** open

### U-37: Linking a FraxNet account to the wallet used in our app
- **How it works now:** FraxNet sign-in uses a passkey or password, so accounts are not wallets. Onboarding shows the user their wallet address from our app and asks them to add it to their FraxNet account. Status lookup is by that wallet address. For cash-out, the user pastes their liquidation address from FraxNet if the API can't return it.
- **Alternative:** Look users up by email, or have FraxNet sign an OAuth-style link between the two accounts.
- **Why we chose this:** A wallet address is the only identifier both systems are sure to share.
- **What we need from Frax:** How are wallets attached to a FraxNet account? Can one account hold several wallets? Can the API look up an account by wallet or by email? Can we read a user's liquidation address?
- **Cost to change:** Low to medium, depending on the lookup Frax provides.
- **Status:** open

### U-38: Co-branded design
- **How it works now:** The app is Blockchain at Berkeley branded, in collaboration with Frax, using Frax's visual theme as described in `docs/BRAND.md`. Logos come only from official files each org provides.
- **Alternative:** Fully Frax-branded (it lives at college.frax.com), or fully B@B-branded with a "powered by Frax" mark.
- **Why we chose this:** B@B builds and runs the product, and Frax hosts it and funds the pool.
- **What we need from Frax:** Approval of the co-branded lockup and screens, official logo files and brand tokens, and any rules for using the Frax name on college.frax.com.
- **Cost to change:** Low if everything goes through design tokens.
- **Status:** open

## Added in phase 1 (2026-09-23)

### U-39: OpenZeppelin is pinned to v5.3.0
- **How it works now:** Contracts use OpenZeppelin Contracts v5.3.0. Releases 5.4 and later use the `mcopy` opcode (in `SignatureChecker` through `Bytes.sol`, and in `Arrays` and `Memory`), which does not compile for `evm_version = "shanghai"` (U-35).
- **Alternative:** Compile for Cancun and move to the latest v5 release.
- **Why we chose this:** As long as we target Shanghai, 5.3.0 is the newest v5 release that compiles. The parts we use (ERC-4626, ERC-721, AccessControl, EIP-712, SignatureChecker) are the same audited code.
- **What we need from Frax:** Same question as U-35. If Fraxtal supports Cancun, we upgrade OpenZeppelin with it.
- **Cost to change:** Low. Bump the submodule, change one foundry.toml line, rerun the tests.
- **Status:** open

### U-40: Deploy stops on placeholder roles on every network except local (doc conflict)
- **How it works now:** `Deploy.s.sol` stops if any role in the network config is still `SET_AFTER_SAFE_CREATED` on every network except `local`, where those roles fall back to the deployer. This follows PRD section 10. `SYSTEM_DESIGN.md` section 2.7 step 2 says to stop only when `isTestnet` is false, which would let fraxtal-testnet deploy with placeholder roles. The PRD wins.
- **Alternative:** Follow SYSTEM_DESIGN and allow placeholder roles on testnets.
- **Why we chose this:** The repo rules say the PRD wins a conflict. A testnet deploy where the deployer keeps every role would also need a second round of role transfers.
- **What we need from Frax:** Nothing. This is an internal doc conflict; the SYSTEM_DESIGN owner should update section 2.7.
- **Cost to change:** Low. One condition in the deploy script.
- **Status:** open

### U-41: The NFT metadata base URI comes from `nftBaseUri` in the network config
- **How it works now:** Each `deployments/*.json` has a top-level `nftBaseUri`. The deploy script passes it to `ClaimNFT.setBaseURI`, or skips the call when it is null so the admin can set it once the Supabase project exists. `local` points at the local Supabase functions URL.
- **Alternative:** An env var at deploy time, or a URL built from `NEXT_PUBLIC_SUPABASE_URL`.
- **Why we chose this:** FR-C17 says the deploy script reads parameters from the network config, and the SYSTEM_DESIGN schema has no field for this.
- **What we need from Frax:** Who owns the Supabase project (U-21), and what metadata URL to use for college.frax.com.
- **Cost to change:** Low. The phase 2 zod schema must include `nftBaseUri: string | null`.
- **Status:** open

### U-42: The lender allowlist checks the caller and the share receiver; pool shares are transferable
- **How it works now:** With the allowlist on, `deposit` and `mint` require both `msg.sender` and `receiver` to be allowlisted. `maxDeposit(receiver)` can only see the receiver, so it can overstate the limit for a caller who is not allowlisted. Pool shares are a standard ERC-20, and anyone who receives shares by transfer can redeem them.
- **Alternative:** Check only the receiver, or also restrict share transfers to allowlisted addresses.
- **Why we chose this:** "Only allowlisted addresses can deposit" reads most naturally as the depositor, and checking the receiver stops an allowlisted lender from minting shares straight to an outside address. Blocking transfers adds code for little gain while Frax is the only lender.
- **What we need from Frax:** Should pool shares be transferable, and should someone who got shares by transfer be able to redeem?
- **Cost to change:** Low. Override `_update` on the pool to gate transfers.
- **Status:** open

### U-43: Lowering `perClaimCap` does not block purchase of claims already approved
- **How it works now:** Per FR-C9, `purchaseClaim` checks only the per-org cap and idle cash. The per-claim cap is checked at submit and at approval. If the admin lowers `perClaimCap` after an approval, the claimant can still purchase at the approved amount until the approval expires.
- **Alternative:** Recheck `perClaimCap` at purchase.
- **Why we chose this:** FR-C9 lists the purchase checks explicitly, and the underwriter can reject an approved claim if the new cap should apply.
- **What we need from Frax:** Should a lowered per-claim cap apply to approvals already granted?
- **Cost to change:** Low. One check and a test.
- **Status:** open

### U-44: Writing off a claim that only owes fee
- **How it works now:** If the principal is fully paid but some fee is not, `writeOff` still moves the claim to `WrittenOff` with `writtenOffPrincipal = 0`, and the pool books no loss. The claim keeps accepting payments.
- **Alternative:** Make `writeOff` revert when no principal is unpaid.
- **Why we chose this:** The attester can close out a called claim after the grace period no matter what is left. At `feeBps = 0` this case cannot happen.
- **What we need from Frax:** Nothing until fees turn on (U-08).
- **Cost to change:** Low.
- **Status:** open

### U-45: An approval stops being purchasable at `approvalExpiresAt`
- **How it works now:** `purchaseClaim` works while `block.timestamp < approvalExpiresAt` and `isApprovalExpired` is true from that second on. The other boundaries come from SYSTEM_DESIGN: a guaranty is valid through its `deadline` second, and overdue and write-off checks pass at `dueAt` and `writeOffEligibleAt`.
- **Alternative:** Allow purchase through the `approvalExpiresAt` second.
- **Why we chose this:** PRD section 7 says "before expiry."
- **What we need from Frax:** Nothing.
- **Cost to change:** None.
- **Status:** open

### U-46: `totalLosses` is gross, not net of recoveries
- **How it works now:** `ReceivablesPool.totalLosses()` counts all principal ever written off. Payments after a write-off raise pool assets and the share price but do not lower `totalLosses`. Recoveries can be summed from `ClaimSettlementPaid` events on written-off claims.
- **Alternative:** Add a `totalRecovered` counter, or net recoveries out of `totalLosses`.
- **Why we chose this:** SYSTEM_DESIGN makes `realizeLoss` the only writer of `totalLosses`, and the events already carry recoveries.
- **What we need from Frax:** On the lender dashboard, should "realized losses" be gross or net of recoveries?
- **Cost to change:** Low. One counter, one registry call, and tests.
- **Status:** open

### U-47: `fraxtal.json` names the production adapters before their endpoints exist
- **How it works now:** `deployments/fraxtal.json` uses the production adapters from PRD section 10 (`real`, `drip`, `mesh`, `goldsky`) with `fraxnet.apiBase` and `fraxMesh` set to null, because Frax has not shared the partner API base or the Mesh contract. The SYSTEM_DESIGN section 3 cross-checks (`fraxnet: 'real'` needs `apiBase`, `cashOut: 'mesh'` needs `fraxMesh`) will reject this file until both are filled in. That is on purpose: a mainnet build should not start with missing endpoints.
- **Alternative:** Put mock and simulated adapters in `fraxtal.json` so it validates today.
- **Why we chose this:** Mainnet is out of MVP scope, and a mainnet file that validates with mocks could ship by mistake.
- **What we need from Frax:** The partner API base URL (U-36) and the Frax Mesh OFT address on Fraxtal (U-17).
- **Cost to change:** None. Config values. Phase 2 config tests should expect this file to fail those two checks until then.
- **Status:** open

### U-48: Reject reason codes are checked by the admin app, not onchain
- **How it works now:** `rejectClaim` requires a nonzero `bytes32` code. The fixed list (`MISSING_RECEIPTS`, `NOT_REIMBURSABLE`, `DUPLICATE`, `KYC_NOT_APPROVED`, `OVER_LIMIT`, `OTHER`) lives in the admin app.
- **Alternative:** An onchain list of allowed codes that the admin manages.
- **Why we chose this:** Adding a code should not need a transaction, the code only explains the rejection, and the underwriter is a trusted Safe.
- **What we need from Frax:** Nothing.
- **Cost to change:** Low.
- **Status:** open

## Added in phase 2 (2026-09-24)

### U-49: Three edge functions don't take a Privy token (doc conflict)
- **How it works now:** Every edge function checks the caller's Privy access token except three. `nft-metadata` is public. `fraxnet-webhook` checks an HMAC SHA-256 signature made with `FRAXNET_WEBHOOK_SECRET`. `chain-sync` accepts a staff member's Privy token or the `CHAIN_SYNC_SECRET` bearer that pg_cron sends.
- **Alternative:** Require a Privy token on every function, as PRD FR-B1 says ("each function verifies the caller's Privy access token").
- **Why we chose this:** SYSTEM_DESIGN 5.2 already exempts `nft-metadata` and `fraxnet-webhook`, and none of these callers (NFT marketplaces, Frax's servers, pg_cron) has a Privy account. The PRD wins conflicts, but read literally it would break NFT metadata and the webhook. None of the three returns personal data or trusts unsigned input.
- **What we need from Frax:** If Frax sends webhooks, will it sign them with a shared secret, or use some other scheme?
- **Cost to change:** Low. The checks live in one shared module.
- **Status:** open

### U-50: A wallet is tied to a Privy user by a signed message
- **How it works now:** A Privy access token names the user (`sub`) but not their wallets. The first `POST /me` sends the wallet address and a `personal_sign` signature over a message that names the Privy user ID and the time. The function checks the signature with viem, rejects messages older than 10 minutes, and stores the pair in `profiles`. After that, every function looks up the caller's wallet by their Privy user ID, and any wallet in a request body must match it. One wallet per Privy user.
- **Alternative:** Read linked wallets from a Privy identity token, or call Privy's server API with an app secret.
- **Why we chose this:** It needs no Privy dashboard setting and no extra secret, and it proves the caller holds the key, not only that Privy says the wallet is linked.
- **What we need from Frax:** Nothing. This is between us and Privy.
- **Cost to change:** Low. One function in `_shared/auth.ts`.
- **Status:** open

### U-51: The FraxNet webhook payload is a guess
- **How it works now:** `fraxnet-webhook` expects `POST` with JSON `{ "wallet": "0x...", "status": "approved", "kind": "individual", "approvedAt": "..." }` and an `x-fraxnet-signature` header holding the hex HMAC SHA-256 of the raw body. A status from the webhook is stored with `kyc_source = 'fraxnet_api'`.
- **Alternative:** Whatever shape and header Frax documents, or polling only.
- **Why we chose this:** SYSTEM_DESIGN 5.2 names HMAC SHA-256. Frax hasn't published webhooks, so the field names are placeholders.
- **What we need from Frax:** Do you send webhooks when a linked user's verification changes? What are the payload fields, the signature header, and the signing scheme? Is there a timestamp for replay protection?
- **Cost to change:** Low. One parser and one test.
- **Status:** open

### U-52: The Goldsky subgraph schema is assumed
- **How it works now:** The `goldsky` ChainReader reads history from `goldskyUrl` (null in every config for now) and current state over RPC. Its queries assume Goldsky's instant subgraph built from our ABI: one entity per event, event parameters as fields, `block_number` and `transactionHash_` fields, and IDs of transaction hash plus log index.
- **Alternative:** A hand-written subgraph with claim entities that track current state, or Ponder.
- **Why we chose this:** U-22 picks Goldsky and an ABI-built subgraph. Current state stays on RPC so a lagging indexer never shows the wrong claim state or pool balance.
- **What we need from Frax:** Do you already run a Goldsky account for Fraxtal we should deploy under? Who owns the subgraph?
- **Cost to change:** Low. Field names in one file, tested against a fake subgraph.
- **Status:** open

### U-53: Frax Mesh is treated as a LayerZero V2 OFT
- **How it works now:** The `mesh` cash-out calls the contract at `fraxMesh` with LayerZero V2 OFT functions: `token`, `approvalRequired`, `sharedDecimals`, `quoteOFT`, `quoteSend`, and `send`. It approves frxUSD first only if the OFT asks for approval, sends to Ethereum (endpoint ID 30101), rounds the amount down to the OFT's shared decimals, and pays the quoted native fee. It refuses an OFT whose `token()` isn't frxUSD.
- **Alternative:** A Frax-specific Mesh contract or API with a different call shape.
- **Why we chose this:** Frax bridges frxUSD with LayerZero OFTs, and we could not find public Mesh contract docs.
- **What we need from Frax:** The Mesh contract address on Fraxtal and its interface. Does sending to a FraxNet liquidation address need any compose message or extra options?
- **Cost to change:** Low. `cash-out/mesh.ts` and `cash-out/oft.ts`.
- **Status:** open

### U-54: "Simulate ASUC payout" mints from a server key, and only MockFrxUSD
- **How it works now:** On testnets, `simulate-payout` sends `MockFrxUSD.mint` to the claimant from `PAYOUT_PRIVATE_KEY`, a testnet-only key that holds only gas. It mints the amount still due minus what the wallet already holds, so repeat calls don't mint more. On a network whose `frxUSD` is set (Frax's test frxUSD on Fraxtal testnet), it refuses, because we can't mint that token (U-25). It also refuses whenever the config has `isTestnet: false`, whatever the feature flag says.
- **Alternative:** Return the mint call for the claimant's wallet to send, or pay out from a wallet Frax funds with test frxUSD.
- **Why we chose this:** FR-B10 says the function mints, and a server-side mint keeps the demo to one button. MockFrxUSD's mint is open to anyone, so the key protects nothing but gas.
- **What we need from Frax:** If the testnet pool uses your test frxUSD, can you fund a payout wallet so the simulation can transfer instead of mint?
- **Cost to change:** Low. One function.
- **Status:** open

### U-55: A guaranty signature is valid for 7 days
- **How it works now:** The EIP-712 guaranty the guarantor signs has a deadline 7 days after they open it, matching the invite expiry (FR-B5). The claimant must call `submitClaim` before then, or the guarantor signs again.
- **Alternative:** A longer deadline, or one tied to the approval expiry.
- **Why we chose this:** A short window limits how long a signed guaranty sits unused, and the nonce already voids it if the guarantor signs something else first.
- **What we need from Frax:** Nothing, unless your counsel wants a specific window for the guaranty.
- **Cost to change:** Low. One constant.
- **Status:** open

### U-56: Email addresses are self-reported
- **How it works now:** Users type their email into the app on `POST /me`. We use it only for the FR-B9 notifications. It isn't verified and never goes onchain.
- **Alternative:** Read a verified email from Privy's API (needs a Privy app secret) or from FraxNet once its API exists.
- **Why we chose this:** Privy access tokens don't carry the email, and a wrong address only means a missed notification.
- **What we need from Frax:** Can the partner API return the verified email on a FraxNet account, so we don't store our own copy?
- **Cost to change:** Low.
- **Status:** open

### U-57: Receipts are readable by underwriters, not all staff (doc conflict)
- **How it works now:** `documents-read` returns a signed URL to the claimant, the org's active officers (which includes the guarantor), and staff with the underwriter role. Attesters and admins can see a claim's document list but not the files.
- **Alternative:** Let all staff read receipts, as SYSTEM_DESIGN 5.2 says ("Claimant, officers, staff").
- **Why we chose this:** PRD FR-B3 says "Only the claimant, the org's officers, and underwriters can read them," and the PRD wins conflicts.
- **What we need from Frax:** Should attesters see receipts when deciding whether to call a guarantor?
- **Cost to change:** Low. One check.
- **Status:** open

### U-58: Claimants can report an ASUC outcome only while the claim is purchased and not yet called
- **How it works now:** `report-outcome` checks the claim's state on the chain and accepts a report only in `Funded`. A later report replaces the earlier one. After the attester calls the guarantor, the claimant can't report.
- **Alternative:** Accept reports in any state after purchase.
- **Why we chose this:** A report exists to prompt the attester's call (FR-B11). Once they've acted, it has no use.
- **What we need from Frax:** Nothing.
- **Cost to change:** Low.
- **Status:** open

### U-59: Once Frax's API answers, it overrides a manual KYC status
- **How it works now:** Until the partner API exists, underwriters set statuses by hand (U-36). When `FraxNetClient` returns a real answer, `kyc-status` writes it with `kyc_source = 'fraxnet_api'`, even if an underwriter set a different status earlier. The manual history stays in `admin_actions`.
- **Alternative:** Keep manual statuses until an underwriter clears them.
- **Why we chose this:** Frax owns KYC, so its answer should win once it's available.
- **What we need from Frax:** Agree?
- **Cost to change:** Low.
- **Status:** open

## Added in phase 3 (2026-09-24)

### U-60: A `directory` function lists org officers and, for staff, people's KYC
- **How it works now:** SYSTEM_DESIGN 5.2 has no function that returns other people's names, but the wizard needs an org's officers to pick a guarantor (PRD 8.1 step 4) and the review queue needs the claimant's and guarantor's KYC status (FR-F7). `directory?view=orgs` returns active orgs with their active officers' display names and titles to any signed-in user. `directory?view=people` returns names and KYC status for a list of wallets, to staff only. No emails, no receipts.
- **Alternative:** Fold these into `me` and `claims`, or show wallet addresses instead of names.
- **Why we chose this:** One small read-only function keeps the other handlers unchanged, and FR-F8 rules out addresses on claimant screens.
- **What we need from Frax:** Nothing technical. Flagging it because any signed-in member can see officer names for every active org. Is that fine for the pilot?
- **Cost to change:** Low. One function and two web hooks.
- **Status:** open

### U-61: "Open in Frax Safe" link format
- **How it works now:** Outside a Safe, admin pages link to `<safeUi>/apps/open?safe=<prefix>:<address>&appUrl=<page>`, the Safe{Wallet} format. The chain prefixes are our guess: `fraxtal` for mainnet and `fraxtal-testnet` for testnet. Local has no Safe UI, so the link is hidden there.
- **Alternative:** Whatever path and EIP-3770 short names safe.frax.com and safe.testnet.frax.com actually use.
- **Why we chose this:** Frax's Safe UI is a Safe{Wallet} deployment, so the upstream URL format is the likeliest.
- **What we need from Frax:** The short names your Safe UI uses for Fraxtal and Fraxtal testnet, and whether `/apps/open` works for a custom Safe App URL.
- **Cost to change:** Low. One map in `apps/web/lib/safe.ts`.
- **Status:** open

### U-62: Tests sign in with an injected session on local only
- **How it works now:** Privy's hosted email login can't run in CI, so on the `local` network the app accepts a session that Playwright injects: an anvil key and a token signed with a throwaway test key that the locally served functions trust. The functions still verify the token the same way they verify a real Privy token. Any build for another network ignores it. For clicking around by hand, `scripts/local-demo.ts` makes the same kind of session for four demo personas, and a local build also reads it from `sessionStorage`.
- **Alternative:** Mock Privy's SDK in the browser, or run Privy's test accounts against a real Privy app.
- **Why we chose this:** It keeps every server-side check in the test path and needs no Privy credentials in CI.
- **What we need from Frax:** Nothing. Listed so reviewers know the path exists and where it stops.
- **Cost to change:** Low. `apps/web/lib/session/` and the e2e harness.
- **Status:** open

### U-63: Two places where claimant screens break FR-F8 (doc conflict)
- **How it works now:** FR-F8 says claimant and guarantor screens show no hex addresses and mention frxUSD once. Onboarding shows the wallet address, because PRD 8.1 step 2 has the user add it to FraxNet (U-37). The footer on every page says "frxUSD is issued by Frax," because BRAND.md requires that text, so a screen that also explains settling in frxUSD mentions it twice.
- **Alternative:** Hide the address behind a copy button with no visible text, and drop the frxUSD sentence from the footer on claimant pages.
- **Why we chose this:** The address is the one step that can't work without it, and the footer text is a brand rule. Everywhere else, claimant and guarantor screens show dollars only.
- **What we need from Frax:** Once FraxNet can link a wallet without the user pasting an address, we can drop it. Is that on Frax's roadmap?
- **Cost to change:** Low. Copy changes in two components.
- **Status:** open

### U-64: The Safe App is registered at `/admin/`, with a second manifest there
- **How it works now:** Safe{Wallet} loads a custom Safe App by fetching `<app URL>/manifest.json`. We register `https://<site>/admin/` so signers land on the review queue, so `apps/web/public/admin/manifest.json` sits next to the root one that SYSTEM_DESIGN 6.4 names. Both point at the same icon in `public/brand/`. `public/_headers` sends `Access-Control-Allow-Origin: *` for the manifests and icons on hosts that read it (Cloudflare Pages, Netlify).
- **Alternative:** Register the site root, so signers start on the landing page and click through to Admin.
- **Why we chose this:** Signers only need the admin pages, and a test keeps the two manifests in sync.
- **What we need from Frax:** Does your Safe UI deployment fetch the manifest the same way as upstream Safe{Wallet}, and which headers does your host need for it?
- **Cost to change:** Low. One file and a runbook step.
- **Status:** open

### U-65: The B@B design canvas replaces BRAND.md's provisional look (doc conflict)
- **How it works now:** The tokens in `apps/web/app/globals.css` come from the B@B design team's "B@B x Frax College Screens" canvas, as BRAND.md allows ("the design team replaces them with official values"). That canvas is light by default, uses blue gradient panels with film grain, pill buttons, 14 to 28 px radii, Manrope for text, Archivo Expanded for display type, and ink `#0A0B24` as the primary action color, with gold `#FFC72C` for highlights. The lockup puts Frax first, a thin rule, then B@B. The logo files are the PNGs from that canvas. Dark stays available with the same tokens. BRAND.md itself isn't edited. Since 2026-09-27 the type, panels, and ink follow the landing page instead (U-75); the lockup, pill buttons, radii, and claim card gradients still come from the canvas.
- **Alternative:** BRAND.md's wording: dark by default, mostly monochrome, one B@B accent, Inter, 4 px radius, B@B first in the lockup.
- **Why we chose this:** It's the design team's latest direction, and the product owner picked it on 2026-09-24. Every value still lives in tokens, so Frax's feedback is a token change.
- **What we need from Frax:** Does this co-branded look, and Frax's logo appearing first in the lockup, work for you (U-38)?
- **Cost to change:** Low for colors, type, and radii (tokens). Medium for the gradient and card treatments, which are components.
- **Status:** open

### U-66: The testnet banner is off (doc conflict)
- **How it works now:** FR-F9 says every page shows a testnet banner when the config says `isTestnet: true`. The banner and the "The transfer is real on Fraxtal testnet" box on the cash-out screen now sit behind `features.testnetBanner` in `deployments/*.json`, which is `false` on every network. The product owner asked for them gone on 2026-09-24 because they get in the way and everyone using the build knows it's testnet. The "Simulate ASUC payout" button and the "(simulated)" labels on a finished cash-out stay, since they say what a button does or what didn't really happen (U-17, U-25).
- **Alternative:** Show the banner on every testnet page, as FR-F9 says.
- **Why we chose this:** The only people using the testnet build right now are the team. The flag brings it back with a one-line config change once outside members use it.
- **What we need from Frax:** Nothing yet. We'll turn the banner back on before anyone outside the team uses the pilot, unless you'd rather it stay on now.
- **Cost to change:** Low: set `features.testnetBanner` to `true`.
- **Status:** open

### U-67: The testnet uses Frax's real test frxUSD, and the payout transfers it (doc conflict)
- **How it works now:** `deployments/fraxtal-testnet.json` keeps Frax's test frxUSD (`0xfc00000000000000000000000000000000000001`), not MockFrxUSD. On 2026-09-24 that token had a total supply of 0, no minters, no bridge, and an owner that is Frax's 2-of-5 Safe (`0xb3C842f78206af341A6b72d03E3cF7338Ee0C704`), so only Frax can create it. FR-B10 says "simulate ASUC payout" mints mock frxUSD. On this config it instead transfers test frxUSD from the payout wallet (`PAYOUT_PRIVATE_KEY`), and answers `payout_empty` when that wallet can't cover the amount due. MockFrxUSD networks still mint.
- **Alternative:** MockFrxUSD on Fraxtal testnet (`"frxUSD": null`), which anyone can mint.
- **Why we chose this:** The product owner wants the pilot on the real token, not a stand-in.
- **What we need from Frax:** Test frxUSD minted to two wallets: the seeding lender (10,000 covers four claims at the per-claim cap) and the payout wallet (a few thousand for demo payouts). Or add us as a minter.
- **Cost to change:** None. Config value, and the payout function handles both.
- **Status:** open

## Added for the mainnet hackathon (2026-09-24)

### U-68: The October 11 hackathon runs on Fraxtal mainnet with real frxUSD (doc conflict)
- **How it works now:** On 2026-09-24 the product owner set the October 11 hackathon as the first live use, on Fraxtal mainnet with real frxUSD. That replaces the testnet launch in U-33 and PRD section 14. Fraxtal testnet stays as the rehearsal network. `deployments/fraxtal.json` already has the mainnet terms (`perClaimCap` 2,500, `perOrgCap` 10,000, `poolDepositCap` 50,000, fee 0, simulated payout off), and still fails validation until Frax shares the partner API base (U-36) and the Mesh address (U-17, U-53). It reads the chain over rpc, not the Goldsky reader PRD section 10 names, until a subgraph exists (U-52).
- **Alternative:** Keep the hackathon on testnet, as U-33 and the PRD say.
- **Why we chose this:** The team's target is $10,000 of real hackathon expenses bought by the pool. That only means something with real money.
- **What we need from Frax:** The real frxUSD deposit for the mainnet pool (at least 10,000, up to 50,000) and from which address. The partner API base URL, or agreement that underwriters confirm KYC by hand at `/admin/kyc/` for the hackathon (U-07). The Mesh address on Fraxtal mainnet, or agreement that cash-out waits and members keep frxUSD in their wallet. Whether you want a review of the contracts before real money goes in, since they aren't audited.
- **Cost to change:** Low in code, config only. High on the checklist: mainnet Safes, a production Privy app, and a Supabase project for mainnet all have to exist by October 10.
- **Status:** open

### U-69: The admin can give one org its own cap
- **How it works now:** `ClaimRegistry.setOrgCap(orgId, cap)` sets an override for one org, admin only, with an `OrgCapSet` event. `orgCap(orgId)` returns the override if there is one, otherwise `perOrgCap`, and `purchaseClaim` checks against that. A cap of 0 clears the override. For the hackathon, Blockchain at Berkeley gets 50,000 and every other org stays on `perOrgCap` (10,000). I-5 is checked against the org's own cap. The PRD only has the one `perOrgCap` (FR-C10).
- **Alternative:** Raise `perOrgCap` for everyone, or keep B@B at 10,000 and settle claims between purchases to stay under it.
- **Why we chose this:** B@B runs the hackathon and its own internal receivables, working toward $50,000 this semester. At 10,000 the hackathon target alone would sit exactly on the cap. Outside orgs are new and should stay at 10,000.
- **What we need from Frax:** Agree that B@B can carry up to 50,000 outstanding, which is the whole pool at the current deposit cap?
- **Cost to change:** Low. Clearing the override is one admin Safe call.
- **Status:** open

### U-70: Sign-in also offers Google, with the code entered on our own screen (doc conflict)
- **How it works now:** FR-F2 says Privy handles login by email. The sign-in screen now has separate "Sign in" and "Create account" tabs, "Continue with Google" first, and an emailed code typed on the same page instead of in Privy's modal. "Sign in" with an email code won't create a new account, so a mistyped email doesn't leave someone in an empty second account. Account setup takes the email from the login and only asks for a name. Privy's session lasts 30 days on a device. Lenders and admins still connect a wallet through Privy's modal. On 2026-09-27 the tabs were briefly dropped for a single screen, then brought back at the product owner's request: a separate Create account side is clearer for someone new. Whether Privy lets a Google sign-in reach an account first made with an emailed code for the same address isn't confirmed; the email fallback covers those people either way.
- **Alternative:** Email code only, through Privy's modal, as FR-F2 says.
- **Why we chose this:** The product owner found asking for a code on every sign-in, plus a second email field at setup, confusing. Berkeley accounts are Google accounts, so Google makes coming back one tap, and links opened in a phone's in-app browser (which doesn't share the login) cost one tap instead of a trip to the inbox.
- **What we need from Frax:** Nothing, unless FraxNet needs the login email to match the email on the FraxNet account.
- **Cost to change:** Low. Turn Google off in the Privy dashboard and drop the button.
- **Status:** open

### U-71: Student-facing screens say "reimbursement", "sign off", and "send it to Frax" (doc conflict)
- **How it works now:** The PRD and CLAUDE.md name the product words as sell a claim, purchase price, amount due, settle, guarantor, and guaranty. Students read "claim" as insurance and "sell" as giving something up, so every screen and email now says: "Get reimbursed now" for selling a claim, "reimbursement" for claim, "officer sign-off" for guaranty, "Send it to Frax" for settle, "Closed out" for Settled and Recovered, and "Officer asked to cover" for a guarantor call. The officer's sign-off screen still says plainly that if ASUC never pays, they pay Frax what's left. Contracts, events, functions, and the database keep the PRD terms. Nothing says loan, borrow, interest, or repay (U-09). The README has the mapping.
- **Alternative:** Keep "sell a claim" and "settle" on screen, as the PRD says.
- **Why we chose this:** The product owner found students confused by "sell a claim" (insurance? a loan?). The new words describe what happens to them without calling it debt.
- **What we need from Frax:** Does "Get reimbursed now" and "send it to Frax" work for your counsel as purchase language? And is naming Frax as the one who's paid back fine while Frax is the only lender?
- **Cost to change:** Low. Copy only.
- **Status:** open

## Added with the new landing page (2026-09-26)

### U-72: The landing page uses a third-party template's layout and motion (doc conflict)
- **How it works now:** The home page (`apps/web/app/page.tsx`, `components/landing/`) takes its section layout and animations from Project One, a landing page template by Atharvsinh Jadav (ObsidianUI). Its repo is marked "proprietary, all rights reserved", and he gave the product owner permission to use it by direct message. We also use his near-black and zinc greys for the dark panels (the page keeps the app's light background and the hero the canvas's blue gradient) and his fonts (Figtree and Geist Mono), which the whole app has used since 2026-09-27 (U-75), plus his own glow and cloud art. The "No fees" and "Open to lenders" cards show Frax's own 3D FRAX and frxUSD token renders from frax.com/brand, where he had a chart ring and a portfolio chart. The footer links to Blockchain at Berkeley on X and LinkedIn. Two feature cards use his original backgrounds at the product owner's request: a 3D Bitcoin coin, and an AI-generated astronaut on a pile of coins (some stamped "IPO" and "CREATOR TOKEN", mostly under the card's dark fade) with the NASA insignia blurred out. His memecoin and NFT avatars were other projects' art. Their spot now shows one of this app's claim cards over the same glow, stepping from In review to Closed out. The hero's strip shows 21 real Berkeley clubs' logos, ClubMash's top 20 (theclubmash.com/rankings, leaving out Blockchain at Berkeley) plus Codeology, cut out in white from their CalLink or website logos. The product owner says every one of these clubs consented on 2026-09-27; that consent isn't written down in this repo. The copy is ours. Animation turns off for anyone who asks their device for reduced motion, and the footer's contact is admin@blockchain.berkeley.edu. BRAND.md's landing is one headline, one sentence, and one button; this page is longer and keeps two buttons, "Get reimbursed now" and "Lend to the pool", like the page it replaces. It adds one dependency, `motion`.
- **Alternative:** Keep the previous single-screen landing, or ask the B@B design team for an original layout.
- **Why we chose this:** The product owner wanted a fuller landing page for the hackathon launch, and this layout walks a member through the whole flow with the real screens.
- **What we need from Frax:** Does this landing page work for you as part of the co-branded look (U-38, U-65), including its different palette and fonts, and a Bitcoin coin on a frxUSD product? It's the first thing hackathon members see.
- **Cost to change:** Low. The old page is one revert away, and the sections are self-contained components. The same frax.com/brand token renders could replace the Bitcoin and astronaut backgrounds with one line each.
- **Status:** open

### U-73: The landing hero promises payment in under 24 hours
- **How it works now:** The landing hero says "Skip the weeks of waiting on ASUC. Frax pays you in under 24 hours." The claim card walkthrough further down is headed "From receipt to paid, in a day." Payment happens once the officer signs off and a B@B underwriter approves the request, and the app tells members "Most are reviewed within a day." The PRD's success metric is a median under 24 hours from submission to approval, which is a target for most requests, not a promise for each one.
- **Alternative:** Say "usually within a day", which matches the metric and the app.
- **Why we chose this:** The product owner wants the hero to state the speed plainly, and "under 24 hours" is the clearest way to contrast with weeks or months from ASUC.
- **What we need from Frax:** Are you comfortable promising payment in under 24 hours on the landing page, given that underwriting is done by hand during the pilot and a request can wait on its officer's sign-off?
- **Cost to change:** Low. It's one sentence in `components/landing/hero.tsx` and one heading in `components/landing/card-journey.tsx`.
- **Status:** open

### U-74: The landing hero uses frax.com's hero video
- **How it works now:** The home page hero plays frax.com's own hero footage (`https://frax.com/home.mp4`, Earth at night), re-encoded to 1080p and served from `public/images/landing/earth.*`, full-bleed behind the centred headline, subline, and buttons, as plain as frax.com's own hero. Along its bottom edge runs a copy of frax.com's partner strip with the 21 clubs from U-72 as small white logos, cut out of their original logos in `public/images/landing/clubs-white/`. It replaced the earlier hero of floating claim cards on 2026-09-27 after trying both.
- **Alternative:** Source our own footage, or go back to the floating claim cards (in git history before this change).
- **Why we chose this:** The product owner compared both and chose this one: it ties the page to Frax's own look and puts the clubs up front.
- **What we need from Frax:** May we use the frax.com hero video on a co-branded page? Is its footage licensed for that, or should we source our own?
- **Cost to change:** Low. Swap the three `earth.*` files for other footage, or restore the old `components/landing/hero.tsx` from git.
- **Status:** open

### U-75: The whole app now follows the landing page's look (doc conflict)
- **How it works now:** The product owner made the landing page the source of truth for the app on 2026-09-27. The tokens in `apps/web/app/globals.css` now use Figtree for all text and headings (Geist Mono only for wallet addresses and hashes), sentence-case headings instead of uppercase Archivo, near-black `#0A0A0A` panels and actions instead of navy `#0A0B24`, black glass panels (near-black with a faint light from the top and film grain) instead of the blue gradient panels, plain black shadows, and a neutral dark theme. Gold and "officer asked to cover" panels keep a faint trace of their color. The claim card keeps its blue and gold gradients and shows a plain number and state, and its color follows the state: frosted silver while waiting (draft, in review), sky blue when approved, deep blue once paid, gold when closed out. Waiting cards are frosted glass and closed-out cards brushed gold, and on the landing and claim pages the card leans toward the mouse and plays a short moment when a state arrives: a shine on approval, the amount counting up when paid, a stamp when closed out. State chips are a colored dot and a plain label. The landing's motion is shared in `components/motion/` (rise in, card swap, expand, count up) and turns off for anyone who asks their device for reduced motion. This goes further from BRAND.md than U-65 did: BRAND.md's display type is an uppercase 800-weight face, and the design canvas's panels were blue. The one exception is the sign-in screen, which the product owner preferred as the canvas drew it: its left panel keeps the canvas's pale sky gradient with dark logos, and the form beside it keeps navy `#0A0B24`, while its card and headline follow the new look. The FraxNet identity panel on the verification screen also keeps the canvas's blue gradient, since it's Frax's own step.
- **Alternative:** Keep the design canvas's look in the app (U-65) and the landing's only on the landing page (U-72).
- **Why we chose this:** The landing and the app read as one product, and the landing is the look the product owner settled on after many rounds.
- **What we need from Frax:** Does the app's new near-black, Figtree, sentence-case look work for you as the co-branded look (U-38)?
- **Cost to change:** Low. It's tokens and a few shared components; the old values are in git history.
- **Status:** open

### U-76: The app has one theme, light (doc conflict)
- **How it works now:** The product owner took dark mode out on 2026-09-27. There's no theme toggle in the sidebar, `globals.css` has one set of color tokens, and the app stays light even when a phone or laptop is set to dark. The sidebar, panels, and landing hero keep their near-black ink surfaces, so the dark accents are still there. A unit test fails if a `dark:` class or a dark theme block comes back. This conflicts with BRAND.md, which says dark is the default theme and light is the alternative.
- **Alternative:** Bring back the dark theme and toggle from git history, and check each restyled screen in it.
- **Why we chose this:** Every screen was restyled against the light landing, and keeping a second theme right would mean checking each one twice before October 11. One theme is simpler for members too.
- **What we need from Frax:** Is a light-only app fine for the co-branded look, given BRAND.md's dark default?
- **Cost to change:** Medium. The old dark tokens and the `next-themes` toggle are in git history, but every screen restyled under U-75 would need a dark pass.
- **Status:** open

## Added with Connect FraxNet (2026-10-08)

### U-77: Members connect FraxNet through its OAuth app, and that decides KYC (doc conflict)
- **How it works now:** Frax gave us a FraxNet app on staging (`net-test.frax.com`, client id `cea363ed-a10e-4cb7-8fa7-5cbc61673f0c`). Privy still handles sign-in and the wallet. After account setup, Verification asks the member to "Connect FraxNet": the `fraxnet-connect` function saves a sign-in attempt (state, PKCE verifier, nonce, 10 minutes) for their wallet and sends them to FraxNet's OAuth sign-in with the scopes `openid email profile org:read offline_access`. FraxNet sends them back to `/fraxnet/callback/`, and the function exchanges the code with the client secret on the server, reads `GET /me` and `GET /org`, and stores the connection with its refresh token in `fraxnet_connections` (RLS on, service role only, tokens never sent to the browser). FraxNet's API has no per-person KYC field, so we treat the organization's `verified` flag as KYC: a verified organization that isn't a business is "approved", anything else is "pending". `kyc-status` asks again on each visit to Verification, refreshing the token when it has expired (FraxNet rotates refresh tokens on every use and doesn't remember consent), and marks the connection for reconnecting if FraxNet rejects it. A FraxNet answer replaces a manual one (U-59). One FraxNet account can back only one wallet. Nobody unverified can start or submit a reimbursement or sign off as an officer (`kyc_required`), which closes U-24, and the review queue's Approve stays off until both people are verified. The underwriter's `/admin/kyc/` page stays as the fallback (U-07, U-36). The wallet address box on Verification (U-63) is gone, since FraxNet no longer needs it typed in. Testnet now uses the real FraxNet adapter against staging, where PRD section 10 has the mock, and the `FraxNetClient` interface in SYSTEM_DESIGN (`getVerificationStatus(wallet)`) became an OAuth one. Local and Sepolia keep a mock that sends the browser straight back with a code. Mainnet stays on the mock until Frax gives us a production app.
- **Alternative:** Keep the external link to net.frax.com and have an underwriter mark KYC by hand for everyone.
- **Why we chose this:** The product owner wants verification to be part of signing up, not a separate trip, and a FraxNet sign-in is the only way the API tells us anything about a person.
- **What we need from Frax:** Register `https://fraxnet-college.andrewjliu22.workers.dev/fraxnet/callback/` (and `http://127.0.0.1/fraxnet/callback/` for local testing) as redirect URIs, and allow the five scopes. Does every FraxNet user get a personal organization, and does `verified` on a non-business organization mean that person passed KYC? A production app for mainnet, and please rotate the staging secret before then.
- **Cost to change:** Medium. The manual path still works on its own; turning the gates off is two lines, and the adapter and table are self-contained.
- **Status:** open

### U-78: Connecting FraxNet adds the member's app wallet to their FraxNet account
- **How it works now:** The app already makes every member a wallet through Privy when they sign up, but nothing showed it once the address box came off Verification (U-77), and FraxNet's own onboarding asks for a wallet address before identity verification. Connect FraxNet now also asks for the `addresses:manage` scope (FraxNet's staging app allows it), and right after the member connects, `fraxnet-connect` calls `POST /org/addresses` with their app wallet, checksummed, named "FraxNet College", on chain `fraxnet.walletChainId` in the network config: Fraxtal (252) on testnet and mainnet, since FraxNet staging's examples all use Fraxtal mainnet and an EVM address is the same on every chain. FraxNet treats adding an address twice as a rename, so `kyc-status` retries on later checks until it works, and `fraxnet_connections.wallet_added_at` records when it did. It's best effort: if the member unticks the scope or FraxNet refuses the chain, connecting still works and Verification shows the address with a Copy button to paste into FraxNet instead. Connect FraxNet also opens in a new tab now, so someone making a FraxNet account doesn't lose their place in the app, and the app's tab updates by itself when they finish.
- **Alternative:** Show the address and ask members to paste it into FraxNet themselves.
- **Why we chose this:** The product owner found FraxNet's wallet step impossible for members who don't know what a wallet is, and they have no way to find the address Privy made for them.
- **What we need from Frax:** Is Fraxtal (252) the right chain to record a member's wallet on, including on staging? And does adding it this way count for FraxNet's "Add a wallet address" step before identity verification?
- **Cost to change:** Low. Set `fraxnet.walletChainId` to null to stop adding it; the Copy fallback takes over.
- **Status:** open

### U-79: The pool assumes one lender, and that lender keeps some shares while written-off claims can still be paid
- **How it works now:** Checked against Maple Finance's ERC-4626 pools (pool-v2 and its withdrawal and loan managers) before Frax's 40,000 deposit. Two behaviors are safe only because Frax is the one lender. First, unpaid principal on a `GuarantorCalled` claim counts at full value until `writeOff` 60 days later, so with two lenders the first to exit during that window gets par and the other takes the whole loss. Maple handles this by impairing a loan, which lowers the exit price at once. Second, once every share is redeemed the pool's 6-decimal virtual shares own whatever is left, so a later payment on a written-off claim can't be reached by anyone, not even by depositing again. Frax keeps at least 1 frxUSD of shares while any written-off claim could still be paid (RUNBOOK). Tests pin both behaviors down, and `SECURITY.md` lists them. Pool shares are also freely transferable (U-42).
- **Alternative:** Change the contract before the deposit: count `GuarantorCalled` principal at zero for exits (an impairment), limit share transfers to allowlisted addresses, and let the next allowlisted depositor take value left in a pool with no shares, or add a sweep that only works with no shares outstanding.
- **Why we chose this:** None of it can cost anyone money with one lender, and changing the pool's share math the day before real money goes in risks more than it saves. The fixes belong in the next version, before a second lender is allowlisted.
- **What we need from Frax:** Will Frax stay the only lender this semester? If another lender is coming, we'd ship these changes in a new pool first.
- **Cost to change:** Medium. A new pool contract and a migration of Frax's position, since nothing is upgradeable (U-03).
- **Status:** open

---

## Added with emergency closeout (2026-10-19)

### U-80: The admin Safe can permanently close the pool for shareholder emergency withdrawals
- **How it works now:** At the product owner's request, `ReceivablesPool.activateEmergencyMode()` permanently closes deposits, purchases, ordinary withdrawals/redemptions, and all share transfers. Only the existing pool admin can activate it; the emergency pauser keeps its reversible registry pause. Each shareholder calls `emergencyWithdraw(receiver)` for its own pro rata share of available cash. Shares are frozen and retained, so later settlements and written-off recoveries remain claimable even after all earlier cash was withdrawn. Claims use cumulative receipts minus past payouts, independently of the registry and ERC-4626 valuation. The admin has no sweep or ability to redirect another holder's entitlement. Normal operation still has U-79's risks; activation cannot reconstruct ownership if all shares were previously redeemed. Existing contracts need replacement because they are not upgradeable.
- **Alternative:** Keep only the existing paused-state ERC-4626 withdrawals, or give an admin a sweep of all cash to a recovery wallet.
- **Why we chose this:** A separate closeout route can distribute cash despite a broken registry or NAV view, preserve later recovery rights, and avoid making all holders trust an admin to redistribute their money. It deliberately freezes the ownership and cash-allocation rules at activation. This extends FR-C4/FR-C14: normal ERC-4626 withdrawals are closed during permanent closeout and emergency payouts lower remaining assets without burning shares, so I-4 is scoped to normal operation.
- **What we need from Frax:** Agree that only the admin Safe can activate permanent closeout, with each shareholder collecting current and future cash from its own wallet, and that resuming operations requires a new pool?
- **Cost to change:** Medium. Different authority or closeout accounting needs another pool version and review. Deployed pools cannot be upgraded.
- **Status:** open

---

## Added with sfrxUSD staking and the admin call (2026-10-19)

### U-81: The admin Safe can stake idle frxUSD into sfrxUSD and keep the yield
- **How it works now:** At the product owner's request, the pool admin opts in with `setStakingVault(0xBFc4D34Db83553725eC6c768da71D2D9c1456B55)`, Frax's `FraxtalERC4626MintRedeemer`. On Fraxtal, sfrxUSD (`0xfc…0008`) is a bridged ERC-20 with no deposit function, and it doesn't rebase. Its frxUSD price rises through the "sfrxUSD/frxUSD: Rate Transport" oracle, and the redeemer swaps at that price from its own inventory with a 0.00001% fee per leg. `stake(assets)` moves idle frxUSD in and books it as `stakedPrincipal`. `totalAssets()` counts staked principal at face value, so the share price ignores yield. `claimYield(receiver)` sends the admin's chosen wallet only the value above principal, then checks the rest still covers principal. `unstake(assets)` returns exact principal to idle cash. `unstakeAll()` redeems everything: any surplus stays with shareholders and any shortfall lowers total assets. Staking is closed in emergency mode; unstaking and claiming stay open. This departs from FR-C2 and I-1 (total assets now include staked principal) and I-7 (frxUSD can also leave to the redeemer). The real redeemer uses Cancun opcodes and runs on Fraxtal, which bears on U-35; the fork suite now runs under a Cancun profile while deployments stay on Shanghai.
- **Alternative:** Leave idle frxUSD unstaked; give the yield to shareholders by counting the position at market value; or stake automatically and unstake on demand inside purchases and withdrawals.
- **Why we chose this:** The product owner wants idle cash earning sfrxUSD yield for B@B without lenders' principal ever being spent. Counting principal at face value keeps share pricing free of the redeemer and its oracle. Manual staking keeps purchases and withdrawals free of an external swap, at the cost of the admin keeping enough idle cash for them.
- **What we need from Frax:** Agree that B@B's admin Safe keeps the sfrxUSD yield on frxUSD Frax deposits, and confirm the mint/redeemer at `0xBFc4…6B55` is the supported route on Fraxtal, with enough frxUSD inventory and a live oracle for a pool this size?
- **Cost to change:** Medium. Giving yield to shareholders or staking automatically needs another pool version. Deployed pools can't be upgraded.
- **Changed (2026-10-19):** The product owner moved the staking choice to each depositor and gave the yield to the lenders who stake. The admin no longer stakes, unstakes, or claims yield; it only sets the mint/redeemer. See U-83.
- **Changed (2026-10-20):** The product owner removed staking. The pool is back to one ERC-4626 vault holding only frxUSD, with no mint/redeemer. See U-83.
- **Status:** changed

### U-82: The admin Safe can make any call from the pool
- **How it works now:** At the product owner's request, `execute(target, value, data)` lets the pool's `DEFAULT_ADMIN_ROLE` make any `call` (never `delegatecall`) from the pool, in normal and emergency mode, as the last-resort fallback if something goes wrong. It can move every token the pool holds. Every other rule protecting lenders, from FR-C5 (only the registry pays claimants) and I-7 to U-80's "only holders claim their own emergency cash", now holds only while the admin Safe is honest. This is a deliberate exception to FR-C5 and I-7.
- **Alternative:** No arbitrary call, so recovery means pausing and redeploying; a timelock on `execute` so lenders can exit before it runs; or a narrower rescue limited to tokens other than frxUSD and sfrxUSD.
- **Why we chose this:** The product owner wants a final fallback for failures the code doesn't foresee, such as a broken redeemer, a stuck token, or a bug, and accepts that the admin Safe becomes fully trusted with lender funds.
- **What we need from Frax:** As the pool's lender, does Frax accept that the B@B admin Safe could move its deposit with one transaction, or does it want a timelock, its own signer on that Safe, or no `execute`?
- **Cost to change:** Medium. Removing it or adding a timelock needs another pool version. Deployed pools can't be upgraded.
- **Changed (2026-10-20):** Staking is gone (U-83), but the product owner kept `execute` as the last-resort fallback for a stuck token or a bug. It still can move every frxUSD the pool holds.
- **Changed (2026-10-21):** The product owner removed `execute` after the security campaign showed it can forgive a claim with no loss booked (B-4b) and lock emergency holders out (B-4c). FR-C5 and I-7 hold as the PRD writes them again. A stuck token or an unforeseen bug now means pausing and a new deployment (U-03).
- **Status:** changed

### U-83: Lenders choose a staked or unstaked share class, and purchases draw from both
- **How it works now:** At the product owner's request, the pool has two share classes, and each lender picks one at deposit. Unstaked keeps cash waiting for purchases in frxUSD. Staked swaps it into sfrxUSD through Frax's mint/redeemer in the same call, and its holders alone get the yield: the class is valued at what its sfrxUSD would redeem for. Each class has its own cash, shares, share price, and emergency payouts. Each purchase draws from both classes in proportion to the cash each has ready. The staked part unstakes exactly what it needs, and if the redeemer can't price sfrxUSD, only frxUSD already in the pool counts. The pool records how much each class paid for every claim. Repaid principal goes back in proportion to what each class is still owed, fees and post-write-off recoveries go back in proportion to what each paid, and a write-off is split the same way. Repayments to the staked class arrive as frxUSD so a student's payment never depends on Frax's redeemer, and anyone can call `restake()` to swap them in. Shares are now balances inside the pool, not an ERC-20 token, and can't be transferred, which closes the U-42 gap. Tokens sent to the pool directly are off the books. `emergencyUnstake()` lets anyone turn the staked class's sfrxUSD into frxUSD for its holders after closeout. The pool owner's yield skim from U-81 is gone. This changes FR-C1 to FR-C4 (no single ERC-4626 vault), FR-C2 and I-1 (total assets include the staked class's sfrxUSD value), I-4 (staked swaps can cost the staked class a few wei of rounding, and `restake` costs it the swap fee), and I-7 (frxUSD also moves to and from the redeemer). The lender app, adapters, and scripts use the new calls.
- **Alternative:** Two separate pools; the admin staking for everyone (U-81 as first built); or the staked class funding purchases last instead of in proportion.
- **Why we chose this:** The product owner wants staking to be each depositor's decision and its yield theirs. One pool with two ledgers keeps one registry, one purchase path, and per-claim splits that make every repayment and loss land on the right lenders.
- **What we need from Frax:** Is it fine that a staked lender's cash waiting for purchases depends on the Fraxtal mint/redeemer (its inventory, its fee, and an oracle that must be under a day old), and that purchases fall back to unstaked cash when it can't price?
- **Cost to change:** High. Another accounting model means another pool version and a migration. Deployed pools can't be upgraded.
- **Changed (2026-10-20):** The product owner removed staking and the share classes. The pool is back to the single ERC-4626 vault from U-80: one share token, frxUSD only, purchases funded from idle cash, and the fee and repayments going to all shareholders. Shares are transferable again, so the U-42 gap is back. FR-C1 to FR-C4, I-1, I-4, and I-7 hold as written, apart from `execute` (U-82). The yearly fee (U-84) and `execute` (U-82) stay.
- **Status:** changed

### U-84: The fee is a yearly rate on unpaid principal, accrued every second
- **How it works now:** At the product owner's request, `feeBps` is now a yearly rate, not a flat percentage. The rate in force at purchase is snapshotted on the claim. The fee accrues every second on the principal still unpaid and is added to `amountDue` on every payment, guarantor call, and write-off, each time rounded up in the pool's favor. Payments go to principal first, so paying principal off stops the fee. A write-off freezes it. `amountRemaining` includes the fee up to the current block, and `FeeAccrued` is emitted each time it's added. The claim form shows the most the fee could be if the money comes back by the due date. The pay screen adds an hour of fee to a full payment so it still closes the claim, and `settle` only takes what's owed. The fee goes to the lenders in proportion to what each class paid for the claim. `feeBps` stays 0 for the pilot (U-08).
- **Alternative:** Keep the flat fee charged once at purchase; charge simple interest on the full purchase price regardless of payments; or keep accruing after write-off.
- **Why we chose this:** The product owner wants the people who sell claims to pay for the time the pool's money is out, on top of the staking yield. Accruing on unpaid principal charges for exactly that, and stopping at write-off keeps a stuck claim from growing without limit.
- **What we need from Frax:** What yearly rate, if any, after the pilot? Should it keep accruing after a guarantor call or a write-off?
- **Cost to change:** Low for the rate (an admin `setParams`). Medium for how it accrues: another registry version.
- **Changed (2026-10-20):** With staking and the share classes removed (U-83), the fee goes to all shareholders as ordinary pool income.
- **Status:** open

## Added with the security campaign (2026-10-21)

### U-85: The frxUSD owner Safe can freeze, pause, or burn the pool's frxUSD
- **How it works now:** A fork probe of Fraxtal mainnet (block 42,873,553, `contracts/test/security/FrxUsdFork.t.sol`) found that one 3-of-5 Safe, `0xC4EB45d80DC1F079045E75D5d55de8eD1c1090E6`, owns frxUSD, its ProxyAdmin, and its timelock. It can upgrade the token, pause it, freeze accounts, and burn any balance with `burnFrxUsd` without an allowance. The pool does nothing about this: a freeze strands lenders and blocks settlements, a pause halts every flow, and a burn lowers the share price with no write-off booked and can make `emergencyWithdraw` revert for some holders. `contracts/SECURITY.md` (frxUSD issuer) and finding D-1 in `contracts/audits/security-campaign.md` have the details. This replaces the assumption in U-31 with what the token does.
- **Alternative:** Hold a different asset; or make `emergencyWithdraw` pay `min(entitlement, idle)` so a burn can't block it.
- **Why we chose this:** frxUSD is the product. Nothing in the pool can stop its issuer.
- **What we need from Frax:** Under what conditions would Frax freeze, pause, or burn frxUSD held by this pool, the registry, or a claimant, and would it tell B@B first? Who are the five signers on the owner Safe?
- **Cost to change:** None on our side for the answer. Low for the `emergencyWithdraw` change, but it needs another pool version.
- **Status:** open

### U-86: Privy access tokens older than 24 hours are refused
- **How it works now:** The edge functions require `exp` and `iat` on every Privy access token and refuse one issued more than 24 hours ago, whatever its `exp` says (`MAX_TOKEN_AGE` in `supabase/functions/_shared/auth.ts`, finding E-6b). Privy's access tokens last an hour and the SDK refreshes them, so signed-in members don't notice.
- **Alternative:** One hour, matching Privy's token lifetime exactly; or no age limit.
- **Why we chose this:** It bounds a leaked token without depending on Privy's exact lifetime or clock skew.
- **What we need from Frax:** Nothing.
- **Cost to change:** Low. One constant.
- **Status:** open

### U-87: A FraxNet webhook body is applied once, and never overrides a manual rejection
- **How it works now:** The webhook's HMAC covers only the body, with no timestamp or event ID (U-51), so `fraxnet-webhook` keeps each applied body's HMAC in `once_keys` and answers 409 to the same body again (finding E-2c). A status an underwriter set to rejected at `/admin/kyc/` stays rejected whatever a webhook says (E-2d). That's narrower than U-59, where FraxNet's answer through `kyc-status` still replaces a manual status. A side effect: if FraxNet ever sends the identical body twice for two real changes (approved, then rejected, then approved again with no field that differs), the second is ignored until the member presses Check again.
- **Alternative:** A signed timestamp with a 5-minute window, or a signed event ID, once Frax documents its webhook; or delete the webhook until then.
- **Why we chose this:** It stops a captured delivery from restoring revoked KYC without guessing Frax's format.
- **What we need from Frax:** If you send webhooks, will the signed body carry a timestamp or an event ID?
- **Cost to change:** Low.
- **Status:** open

### U-88: Three sign-off links per reimbursement a day, and a used link stops opening
- **How it works now:** `guarantor-invite` makes at most three links (and emails) per reimbursement in any 24 hours and answers 429 after that (finding E-3d). A link that was used to sign off answers 410, and the page says it was already signed (E-3c). The signed reimbursement stays on the officer's Sign-offs list.
- **Alternative:** A different limit, or a per-member limit across reimbursements.
- **Why we chose this:** It stops one member from flooding an officer's inbox, and three covers a lost email and a resend.
- **What we need from Frax:** Nothing.
- **Cost to change:** Low. One constant.
- **Status:** open

### U-89: The app can only be framed by Frax's Safe UIs and Safe{Wallet}
- **How it works now:** `apps/web/public/_headers` sends a Content-Security-Policy on every page. `frame-ancestors` allows the app itself, `https://safe.mainnet.frax.com`, `https://safe.testnet.frax.com`, and `https://app.safe.global` (the `safeUi` values in `deployments/*.json`), and the Safe Apps SDK in `apps/web/lib/safe.ts` accepts messages only from those origins (plus loopback on local, for the e2e stand-in Safe). `connect-src` lists the network RPCs, `*.supabase.co`, and Privy and WalletConnect; `script-src` has `'unsafe-inline'` because a static export can't carry a nonce. Findings E-5a and E-5b.
- **Alternative:** A nonce-based script policy, which needs a server instead of a static export.
- **Why we chose this:** It stops other sites from framing buttons that move money, and stops a framing page from posing as the Safe.
- **What we need from Frax:** Does your Safe UI serve Safe Apps from any origin other than safe.mainnet.frax.com and safe.testnet.frax.com?
- **Cost to change:** Low. One header line and one list.
- **Status:** open

### U-90: The review queue asks FraxNet again before showing a member as verified
- **How it works now:** The underwriter's approval is an onchain Safe transaction, so the last server check is `directory?view=people`, which the review queue reads to enable Approve. It now re-checks every connected member with FraxNet first, through the stored tokens, the same way `kyc-status` does (finding E-2f). If FraxNet doesn't answer, the stored status stands. Gas drips also go only to members whose KYC is approved (E-4a), which is narrower than FR-B7's "wallets with a profile".
- **Alternative:** Mark the status stale in the queue when FraxNet is down; or drip to any profile with a global daily cap.
- **Why we chose this:** The smallest server-side check before an approval, and it removes the throwaway-account gas drain.
- **What we need from Frax:** Nothing.
- **Cost to change:** Low.
- **Status:** open

### U-91: A FraxNet organization counts as a person only when `isBusiness` is false
- **How it works now:** Connect FraxNet approves KYC only for a verified organization whose `isBusiness` is exactly false. One FraxNet leaves out (null) stays pending (finding E-2b). Whether `verified` on a personal organization means that person passed KYC is still U-77, and finding E-2a (two people in one verified organization) waits on that answer.
- **Alternative:** Treat a missing `isBusiness` as personal, as before.
- **Why we chose this:** A missing field shouldn't grant KYC.
- **What we need from Frax:** Does `GET /org` always return `isBusiness`, on staging and production?
- **Cost to change:** Low.
- **Status:** open

---

## Not for Frax

### A-01: ASUC third-party payee (ask ASUC Finance, asucfinance@berkeley.edu)
- **How it works now:** ASUC reimburses the member who paid, by direct deposit, mailed check, or pickup.
- **Question:** Can a purchase request name a payee other than the member, such as a FraxNet virtual account? If yes, U-18 can switch to automatic settlement.
- **Status:** open

---

## Sending this to Frax

When the MVP is built:

- Collect every entry with status `open` above the "Not for Frax" line.
- Send the questions in one message, grouped by section, with the entry IDs so replies map back.
- Mark each entry `sent` with the date.
- When Frax replies, update each entry to `answered` or `changed`, then make the code changes listed under "Cost to change."

---

## Open entries to send to Frax

Generated by `node scripts/uncertainties.mjs --write` from the entries above, and CI fails if it drifts. 87 entries are open. Paste everything below the line into one message to Frax. A-01 goes to ASUC, not Frax.

---

These are the calls B@B made building the college org financing MVP that we'd like Frax to confirm or change. Each has an ID from docs/UNCERTAINTIES.md so replies can point at it, and the full entry there has what we built, the alternative, and the cost to change.

### Chain and network

- U-01 Deploy on Fraxtal
  Is Fraxtal the chain you want this on? FraxNet's cross-chain mint list and fiat liquidation addresses do not include Fraxtal, so is that fine for you?
- U-02 Testnet choice for MVP
  Do you have or plan a Sepolia frxUSD deployment? Which testnet do you want the demo on?
- U-03 Contracts are not upgradeable
  Do you require upgradeability to match your stack or your audit firm's expectations?

### Accounts, identity, and gas

- U-04 Users log in with Privy embedded wallets
  Please share the partner API docs or a sandbox for identity and KYC, account read and write, and transaction initiation (promised in the project overview). Can transaction initiation call our contracts on Fraxtal, or only send frxUSD?
- U-05 Gas sponsorship method
  Which method do you want on mainnet, and who holds the drip wallet key?
- U-06 Who gets KYC'd
  Does your compliance setup accept individual KYC for this product? Do you need KYB anywhere?
- U-07 Reading KYC status if the partner API is not ready
  Which interfaces exist today and when do the rest ship? Who is our engineering point of contact?

### Product and credit terms

- U-08 Interest free to start
  When do fees turn on, and should lenders earn a rate funded by Frax before then?
- U-09 Receivable purchase vs loan
  Please have your counsel confirm purchase vs loan framing and how much recourse is acceptable.
- U-10 Guarantor recourse
  Does your counsel accept a student officer personally guaranteeing? Who enforces it?
- U-11 Recipient can be a member or the org treasurer
  Any compliance problem with funding either kind of recipient?
- U-12 Limits are set at runtime, not hardcoded
  Should limit changes go through a timelock or need a Frax signer?
- U-13 B@B multisig approves claims
  Do you want signers on the underwriter or admin Safe? Who should hold which role?
- U-14 Overdue window
  What window do you want before the guarantor is called?
- U-15 Lender deposits are allowlisted
  When do you want third-party LPs, and do LPs need KYC?
- U-16 Idle pool cash is not put to work
  Do you want sfrxUSD integration in the first version or later?

### Money movement

- U-17 Cash-out to bank on testnet is simulated
  Does Frax Mesh run on testnet? Can a Mesh transfer target a liquidation address directly? Is there a testnet sandbox for the fiat ramp?
- U-18 Settlement is manual in v1
  Can a FraxNet virtual account deliver frxUSD to a contract address on Fraxtal, and include a reference so we can match the payment to a claim?

### Data and infrastructure

- U-19 One NFT per claim
  Do you want the NFT, and should it be transferable?
- U-20 Receipts stay offchain
  Do you need a copy of claim documents for compliance, and where should they live?
- U-21 Hosting format
  What build format do you want for college.frax.com, and who owns the Supabase project?
- U-22 Indexing with Goldsky
  Do you already use an indexer we should share?
- U-23 Admin manages the org registry
  Fine for the pilot?

### Added with the PRD (2026-09-23)

- U-24 KYC is checked by the underwriter, not onchain
  Do you need KYC enforced onchain for compliance, or is an underwriter check enough?
- U-25 Test frxUSD on Fraxtal testnet
  Can you send test frxUSD to seed the pool, and is there a faucet for claimants?
- U-26 What pause blocks
  Should an emergency pause also freeze withdrawals?
- U-27 Admin actions run as a Safe App
  Can we register a custom Safe App on your Safe UI deployments?
- U-28 Approval then "Get paid" as two steps
  Any preference?
- U-29 ASUC short payment goes to the guarantor
  Is guarantor recourse for small shortfalls acceptable?
- U-30 Initial limit values
  What starting values do you want?
- U-31 frxUSD issuer controls
  Can frxUSD on Fraxtal freeze or block an address, and under what policy?
- U-32 What the $50K seed means
  Is $50K a cap on pool size or on cumulative volume? From which address will you deposit?
- U-34 Guarantor must be a different person from the claimant
  Agree?
- U-35 Compile for the Shanghai EVM version
  Does Fraxtal support Cancun opcodes (MCOPY, TSTORE, TLOAD) on mainnet and testnet?
- U-36 How our app learns a user passed KYC on net.frax.com
  What endpoint or webhook tells us a given wallet's verification status? Does the result include individual vs business and the date approved?
- U-37 Linking a FraxNet account to the wallet used in our app
  How are wallets attached to a FraxNet account? Can one account hold several wallets? Can the API look up an account by wallet or by email? Can we read a user's liquidation address?
- U-38 Co-branded design
  Approval of the co-branded lockup and screens, official logo files and brand tokens, and any rules for using the Frax name on college.frax.com.

### Added in phase 1 (2026-09-23)

- U-39 OpenZeppelin is pinned to v5.3.0
  Same question as U-35. If Fraxtal supports Cancun, we upgrade OpenZeppelin with it.
- U-41 The NFT metadata base URI comes from `nftBaseUri` in the network config
  Who owns the Supabase project (U-21), and what metadata URL to use for college.frax.com.
- U-42 The lender allowlist checks the caller and the share receiver; pool shares are transferable
  Should pool shares be transferable, and should someone who got shares by transfer be able to redeem?
- U-43 Lowering `perClaimCap` does not block purchase of claims already approved
  Should a lowered per-claim cap apply to approvals already granted?
- U-46 `totalLosses` is gross, not net of recoveries
  On the lender dashboard, should "realized losses" be gross or net of recoveries?
- U-47 `fraxtal.json` names the production adapters before their endpoints exist
  The partner API base URL (U-36) and the Frax Mesh OFT address on Fraxtal (U-17).

### Added in phase 2 (2026-09-24)

- U-49 Three edge functions don't take a Privy token (doc conflict)
  If Frax sends webhooks, will it sign them with a shared secret, or use some other scheme?
- U-51 The FraxNet webhook payload is a guess
  Do you send webhooks when a linked user's verification changes? What are the payload fields, the signature header, and the signing scheme? Is there a timestamp for replay protection?
- U-52 The Goldsky subgraph schema is assumed
  Do you already run a Goldsky account for Fraxtal we should deploy under? Who owns the subgraph?
- U-53 Frax Mesh is treated as a LayerZero V2 OFT
  The Mesh contract address on Fraxtal and its interface. Does sending to a FraxNet liquidation address need any compose message or extra options?
- U-54 "Simulate ASUC payout" mints from a server key, and only MockFrxUSD
  If the testnet pool uses your test frxUSD, can you fund a payout wallet so the simulation can transfer instead of mint?
- U-55 A guaranty signature is valid for 7 days
  Nothing, unless your counsel wants a specific window for the guaranty.
- U-56 Email addresses are self-reported
  Can the partner API return the verified email on a FraxNet account, so we don't store our own copy?
- U-57 Receipts are readable by underwriters, not all staff (doc conflict)
  Should attesters see receipts when deciding whether to call a guarantor?
- U-59 Once Frax's API answers, it overrides a manual KYC status
  Agree?

### Added in phase 3 (2026-09-24)

- U-60 A `directory` function lists org officers and, for staff, people's KYC
  Nothing technical. Flagging it because any signed-in member can see officer names for every active org. Is that fine for the pilot?
- U-61 "Open in Frax Safe" link format
  The short names your Safe UI uses for Fraxtal and Fraxtal testnet, and whether `/apps/open` works for a custom Safe App URL.
- U-63 Two places where claimant screens break FR-F8 (doc conflict)
  Once FraxNet can link a wallet without the user pasting an address, we can drop it. Is that on Frax's roadmap?
- U-64 The Safe App is registered at `/admin/`, with a second manifest there
  Does your Safe UI deployment fetch the manifest the same way as upstream Safe{Wallet}, and which headers does your host need for it?
- U-65 The B@B design canvas replaces BRAND.md's provisional look (doc conflict)
  Does this co-branded look, and Frax's logo appearing first in the lockup, work for you (U-38)?
- U-66 The testnet banner is off (doc conflict)
  Nothing yet. We'll turn the banner back on before anyone outside the team uses the pilot, unless you'd rather it stay on now.
- U-67 The testnet uses Frax's real test frxUSD, and the payout transfers it (doc conflict)
  Test frxUSD minted to two wallets: the seeding lender (10,000 covers four claims at the per-claim cap) and the payout wallet (a few thousand for demo payouts). Or add us as a minter.

### Added for the mainnet hackathon (2026-09-24)

- U-68 The October 11 hackathon runs on Fraxtal mainnet with real frxUSD (doc conflict)
  The real frxUSD deposit for the mainnet pool (at least 10,000, up to 50,000) and from which address. The partner API base URL, or agreement that underwriters confirm KYC by hand at `/admin/kyc/` for the hackathon (U-07). The Mesh address on Fraxtal mainnet, or agreement that cash-out waits and members keep frxUSD in their wallet. Whether you want a review of the contracts before real money goes in, since they aren't audited.
- U-69 The admin can give one org its own cap
  Agree that B@B can carry up to 50,000 outstanding, which is the whole pool at the current deposit cap?
- U-70 Sign-in also offers Google, with the code entered on our own screen (doc conflict)
  Nothing, unless FraxNet needs the login email to match the email on the FraxNet account.
- U-71 Student-facing screens say "reimbursement", "sign off", and "send it to Frax" (doc conflict)
  Does "Get reimbursed now" and "send it to Frax" work for your counsel as purchase language? And is naming Frax as the one who's paid back fine while Frax is the only lender?

### Added with the new landing page (2026-09-26)

- U-72 The landing page uses a third-party template's layout and motion (doc conflict)
  Does this landing page work for you as part of the co-branded look (U-38, U-65), including its different palette and fonts, and a Bitcoin coin on a frxUSD product? It's the first thing hackathon members see.
- U-73 The landing hero promises payment in under 24 hours
  Are you comfortable promising payment in under 24 hours on the landing page, given that underwriting is done by hand during the pilot and a request can wait on its officer's sign-off?
- U-74 The landing hero uses frax.com's hero video
  May we use the frax.com hero video on a co-branded page? Is its footage licensed for that, or should we source our own?
- U-75 The whole app now follows the landing page's look (doc conflict)
  Does the app's new near-black, Figtree, sentence-case look work for you as the co-branded look (U-38)?
- U-76 The app has one theme, light (doc conflict)
  Is a light-only app fine for the co-branded look, given BRAND.md's dark default?

### Added with Connect FraxNet (2026-10-08)

- U-77 Members connect FraxNet through its OAuth app, and that decides KYC (doc conflict)
  Register `https://fraxnet-college.andrewjliu22.workers.dev/fraxnet/callback/` (and `http://127.0.0.1/fraxnet/callback/` for local testing) as redirect URIs, and allow the five scopes. Does every FraxNet user get a personal organization, and does `verified` on a non-business organization mean that person passed KYC? A production app for mainnet, and please rotate the staging secret before then.
- U-78 Connecting FraxNet adds the member's app wallet to their FraxNet account
  Is Fraxtal (252) the right chain to record a member's wallet on, including on staging? And does adding it this way count for FraxNet's "Add a wallet address" step before identity verification?
- U-79 The pool assumes one lender, and that lender keeps some shares while written-off claims can still be paid
  Will Frax stay the only lender this semester? If another lender is coming, we'd ship these changes in a new pool first.

### Added with emergency closeout (2026-10-19)

- U-80 The admin Safe can permanently close the pool for shareholder emergency withdrawals
  Agree that only the admin Safe can activate permanent closeout, with each shareholder collecting current and future cash from its own wallet, and that resuming operations requires a new pool?

### Added with sfrxUSD staking and the admin call (2026-10-19)

- U-84 The fee is a yearly rate on unpaid principal, accrued every second
  What yearly rate, if any, after the pilot? Should it keep accruing after a guarantor call or a write-off?

### Added with the security campaign (2026-10-21)

- U-85 The frxUSD owner Safe can freeze, pause, or burn the pool's frxUSD
  Under what conditions would Frax freeze, pause, or burn frxUSD held by this pool, the registry, or a claimant, and would it tell B@B first? Who are the five signers on the owner Safe?
- U-87 A FraxNet webhook body is applied once, and never overrides a manual rejection
  If you send webhooks, will the signed body carry a timestamp or an event ID?
- U-89 The app can only be framed by Frax's Safe UIs and Safe{Wallet}
  Does your Safe UI serve Safe Apps from any origin other than safe.mainnet.frax.com and safe.testnet.frax.com?
- U-91 A FraxNet organization counts as a person only when `isBusiness` is false
  Does `GET /org` always return `isBusiness`, on staging and production?

### For the record, no reply needed

U-40, U-44, U-45, U-48, U-50, U-58, U-62, U-86, U-88, U-90
