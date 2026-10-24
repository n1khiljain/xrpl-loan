# Status

Last updated 2026-10-24. Branch `xrpl-migration`. The project moved from Frax/Fraxtal to the XRP Ledger for an XRPL hackathon (Lending & Borrowing track); the Frax-era status, PRD, and runbook are in `docs/archive/frax/`.

## Plan

| Phase | What | State |
|---|---|---|
| 0 | Understand the repo, agree the plan | Done |
| 1 | Remove Frax and EVM, add XRPL foundations (config, custodial wallets, xrpl.js), B@B-only branding | Done |
| 2 | Generalize from club reimbursements to any receivable (Receivable model with a type) | Next |
| 3 | Native XRPL lending: credentials, permissioned domain, private single asset vault, loan broker, first-loss cover, loans | |
| 4 | Auto-repay when the payer pays (QuickNode Streams webhook, WebSocket fallback) | Needs a decision on who submits LoanPay |
| 5 | AI underwriter | Needs a model provider and key |
| 6 | Seeded end-to-end demo, explorer links, README | |

## Where Phase 1 left things

- Network: XRPL Devnet. Checked 2026-10-24: Devnet has SingleAssetVault, LendingProtocol, Credentials, and PermissionedDomains enabled; Testnet lacks the first two. RLUSD isn't issued on Devnet, so the loan asset will be a stand-in RLUSD from the app's own issuer (Phase 3 setup script).
- Each person gets a custodial XRPL wallet on first sign-in, encrypted with `WALLET_ENCRYPTION_KEY` and funded by the Devnet faucet. The wallet card on Verification shows the address, balances, and explorer links.
- KYC: Privy identity token proves the email, staff approve on `/admin/kyc`.
- The claim lifecycle (draft, sign-off, submit, approve, reject, cancel, report, call the guarantor, write off) runs in Postgres through `claim-actions`. Funding ("Get paid") and repayment show a "not live yet" notice until Phases 3 and 4.
- The lender page explains the vault; deposits come in Phase 3.
- Devnet resets now and then, wiping accounts. Re-run `pnpm local` (and in Phase 3 the setup script) after a reset.

## Watch out for

- Privy: turn on "Return user data in an identity token" in the Privy dashboard, or emails stay unverified.
- `WALLET_ENCRYPTION_KEY` encrypts every custodial seed. Losing it loses the wallets (on Devnet that only means re-seeding).
- The landing page's "paid" screenshot still shows the "Payments aren't live yet" notice; re-shoot it after Phase 4.
