# Install

Expedite a transaction, transfer, or payment. Install serves businesses that want liquidity on the ones they choose: an upfront loan from a lending vault on the XRP Ledger, paid back with interest that depends on how long the loan runs.

**Test networks only.** The app runs on XRPL Devnet, the one network with the Single Asset Vault (XLS-65) and Lending Protocol (XLS-66) amendments enabled. No real money moves.

Where things stand: [STATUS.md](STATUS.md). Repo rules: [CLAUDE.md](CLAUDE.md).

## How it works today

- **Sign in** with an email code or Google (Privy). The app makes you a custodial XRPL wallet and funds it with test XRP from the Devnet faucet.
- **Get verified.** Your Privy identity token proves your email; a reviewer approves you on the admin KYC page.
- **Ask for a loan.** Pick the kind of payment you want to expedite (an invoice, a card settlement, a reimbursement, or something else), name the payer, the amount, the payment reference, and the date the payment arrives, and upload documents. That date is the loan's term.
- **Businesses** can have approvers: for a business's loan, one of them signs off and covers what's left if the payment never arrives. A personal loan goes straight to review.
- **Review.** An underwriter approves or rejects it. Attesters handle the exceptions: a payer that rejected or short-paid, or an overdue loan.
- **Get the loan and pay it back.** After `pnpm xrpl:setup`, an approved request becomes one loan from a private, credential-gated vault series, and the borrower pays it back from their wallet. Interest follows the yearly rate in the deployment, prorated to the loan's length, which runs to the payment's due date. Automatic repayment when the original payment arrives is still to come.

| On screen | In the code |
|---|---|
| loan | `receivables` row, `type` = `invoice`, `card_settlement`, `reimbursement`, or `other` |
| payer, payment reference, due date | `payerName` (optional `payerWallet`), `reference`, `dueDate` |
| approver sign-off | guaranty, by the guarantor |
| You got the loan / Paid | `Funded` |
| Closed out | `Settled`, `Recovered` |
| Approver asked to cover | `GuarantorCalled` |

## Run it locally

Needs Node 24, pnpm 10, Deno 2, Docker, and the Supabase CLI (2.122+).

```bash
pnpm install
pnpm local
```

`pnpm local` starts Supabase and the edge functions, signs up four demo people (a borrower, an approver, a lender, an admin) whose wallets are funded on Devnet, adds loans of each kind in several states, and serves the site at http://localhost:3000. The sign-in screen offers the demo people as one-click buttons, so you don't need a Privy app locally. The keys it uses (a Privy test key and a wallet encryption key) are generated into `apps/web/e2e/.cache/`, which git ignores.

### Real Google and email sign-in locally

Without a Privy app the local build only offers the demo people. To sign in with Google or an emailed code:

1. In the [Privy dashboard](https://dashboard.privy.io), turn on **Google** and **Email** under login methods, add `http://localhost:3000` under Configuration > App settings > Domains (if you've listed any domains there), and turn on **Return user data in an identity token**.
2. Put the app ID in `.env` (gitignored) as both `NEXT_PUBLIC_PRIVY_APP_ID` and `PRIVY_APP_ID`. The backend checks tokens against the app's published keys, so no secret or verification key is needed.
3. Run `pnpm local` again. It uses that app, so Google and email work and the demo buttons go away. `DEMO_PEOPLE=1 pnpm local` brings the demo people back even with a Privy app set.

### Vaults: rolling series

On XRPL (LendingProtocolV1_1) only a closed-ended vault can lend: it takes deposits, then lends, then pays out. So lending runs in rolling series, each its own vault with a loan broker and first-loss cover. Lenders deposit into the series taking deposits and withdraw when theirs pays out; loans come from a series that's lending.

```bash
pnpm xrpl:setup                     # issuer, broker, credential domain, and a first series (seeds go in .env)
pnpm xrpl:setup series --deposit-minutes 3 --lend-days 200 --seed 25000 --wait   # a series pre-filled by the house lender, lending in ~3 minutes
pnpm xrpl:setup series --deposit-minutes 10080 --lend-days 200                   # a series taking deposits for a week
pnpm xrpl:setup --fresh             # new accounts, e.g. after a Devnet reset
```

The hosted functions need `BROKER_SEED` and `ISSUER_SEED` from `.env` as Supabase secrets.

Tests:

```bash
supabase start && supabase db reset && supabase test db
(cd supabase/functions && deno test --allow-all)
pnpm test && pnpm lint && pnpm typecheck
```

## Environment

Every variable is listed, empty, in [.env.example](.env.example). The ones that matter:

| Variable | Where | What |
|---|---|---|
| `NETWORK`, `NEXT_PUBLIC_NETWORK` | functions, web | `xrpl-devnet` |
| `PRIVY_APP_ID` | functions | Privy app ID; tokens are checked against its published keys (`PRIVY_VERIFICATION_KEY` optionally pins one key). Turn on "Return user data in an identity token" in the Privy dashboard. |
| `NEXT_PUBLIC_PRIVY_APP_ID` | web | The same Privy app |
| `WALLET_ENCRYPTION_KEY` | functions | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts every custodial seed. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web | Supabase project; the anon key only reaches functions |
| `NEXT_PUBLIC_DEMO_SESSIONS` | web | `true` only for local demo builds |
