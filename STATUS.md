# Status

Last updated 2026-10-24. Branch `xrpl-migration`.

## Plan

| Phase | What | State |
|---|---|---|
| 0 | Understand the repo, agree the plan | Done |
| 1 | XRPL foundations (config, custodial wallets, xrpl.js) and Install branding | Done |
| 2 | Generalize to any payment a business wants to expedite (Receivable model with a type) | Done |
| 3 | Native XRPL lending: credentials, permissioned domain, private single asset vault, loan broker, first-loss cover, loans | Done |
| 4 | Repayment and missed payments | Repay, "Simulate payer payment", and demo loans done; automatic detection of a real payer's payment (QuickNode or WebSocket) not built |
| 5 | AI underwriter | Skipped for now |
| 6 | Seeded end-to-end demo, explorer links, README | Skipped for now |

## Where Phase 1 left things

- Network: XRPL Devnet. Checked 2026-10-24: Devnet has SingleAssetVault, LendingProtocol, Credentials, and PermissionedDomains enabled; Testnet lacks the first two. RLUSD isn't issued on Devnet, so the loan asset will be a stand-in RLUSD from the app's own issuer (Phase 3 setup script).
- Each person gets a custodial XRPL wallet on first sign-in, encrypted with `WALLET_ENCRYPTION_KEY` and funded by the Devnet faucet. The wallet card on Verification shows the address, balances, and explorer links.
- KYC: Privy identity token proves the email, staff approve on `/admin/kyc`.
- The loan request lifecycle (draft, sign-off, submit, approve, reject, cancel, report, call the approver, write off) runs in Postgres through `receivable-actions`. Funding and borrower repayment go through `loans` once `pnpm xrpl:setup` has created the vault. Automatic repayment when the original payment arrives is still Phase 4.
- Vaults run as **rolling series**. Since LendingProtocolV1_1 (on Devnet) a loan broker can only lend from a closed-ended vault, which takes deposits first, then lends, then pays out; an open-ended vault can't be given a loan broker. So each series is its own closed vault with its own loan broker and 5,000 RLUSD of first-loss cover, and new series open on a schedule. The functions find every series by reading what the broker account owns, so opening one needs no config change or redeploy. Funding picks the series that's lending, has the principal, and pays out soonest after the loan is due.
- The lender page shows one card per series: deposit into the one taking deposits, withdraw from one that's paying out. `/lend/stats/` shows deposits, outstanding debt, first-loss cover, unrealized loss, interest earned and still due, and late or defaulted loans, per series and in total.
- Missed payments: on the admin exceptions screen, staff mark a loan impaired once its due date passes (LoanManage `tfLoanImpair`; clear it with `tfLoanUnimpair`) and default it after the grace period too (`tfLoanDefault`), which writes it off and draws on first-loss cover. The ledger re-checks the timing.
- Devnet demo series (2026-10-25): series A took 25,000 RLUSD from the house lender and lends until 2027-05-13; series B takes deposits until 2026-11-01, then lends until 2027-05-20.
- Devnet resets now and then, wiping accounts. Re-run `pnpm local` and `pnpm xrpl:setup --fresh` after a reset, then open series again (see README). The setup script keeps going from whatever it already wrote down.

## Where Phase 4 left things

- Only the borrower can send LoanPay, and the borrower's key is custodial, so the app signs it for them: from the "Pay back" button, or right after the payer pays.
- Test networks only: "Simulate payer payment" on a funded loan. The stand-in RLUSD issuer, playing the payer, sends what's owed (the full invoice, tagged with the loan number) to the borrower's wallet; the wallet then pays the loan off and keeps the rest. Tested on Devnet 2026-10-25: a $2,400 payment paid off a $2,281.06 loan, and the vault earned $1.06 interest.
- Test networks only: "Demo: take it as a 5-minute loan" on an approved request. The loan is due in 5 minutes with the ledger's 60-second minimum grace period, so staff can mark the payment missed and default it live from the admin exceptions screen. Tested on Devnet: impair at the due date, default a minute later, written off.
- Not built: automatically spotting a real payer's payment (QuickNode Streams webhook or WebSocket). Needs a QuickNode endpoint and key, or a long-running listener outside Supabase.

## Where Phase 2 left things

- `receivables` replaces `claims`. Each has a `type` (invoice, card_settlement, reimbursement, other), a payer (name, optional email and XRPL address), the payer's reference (unique per borrower), and a due date. The loan's term runs to the end of that date (at most `overdueWindowSeconds` out), and the grace period is shortened to fit a short loan.
- A business and its approver are optional; without one a request goes straight to review after its documents.
- Exceptions with no approver say default handling comes with loan impairment and default on the ledger.
- Hosted backend: Supabase project `cqrbrfkhzjbpgnigktcl`, all functions deployed, secrets set (not `BROKER_SEED`/`ISSUER_SEED` yet). `APP_BASE_URL` is `http://localhost:3000` until the site is hosted.

## Watch out for

- Privy: turn on "Return user data in an identity token" in the Privy dashboard, or emails stay unverified.
- `WALLET_ENCRYPTION_KEY` encrypts every custodial seed. Losing it loses the wallets (on Devnet that only means re-seeding).
- The landing page's "paid" screenshot still shows the "Payments aren't live yet" notice; re-shoot it after Phase 4.
