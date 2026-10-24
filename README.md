# Install

Expedite a transaction, transfer, or payment. Install serves businesses that want liquidity on the ones they choose: an upfront loan from a lending vault on the XRP Ledger, paid back with interest that depends on how long the loan runs.

**Test networks only.** The app runs on XRPL Devnet, the one network with the Single Asset Vault (XLS-65) and Lending Protocol (XLS-66) amendments enabled. No real money moves.

Where things stand: [STATUS.md](STATUS.md). Repo rules: [CLAUDE.md](CLAUDE.md).

## How it works today

- **Sign in** with an email code or Google (Privy). The app makes you a custodial XRPL wallet and funds it with test XRP from the Devnet faucet.
- **Get verified.** Your Privy identity token proves your email; a reviewer approves you on the admin KYC page.
- **Ask for a loan.** Name the payment you want to expedite, enter the amount and a payment reference, upload documents, and pick someone at your business to sign off. They agree to cover what's left if that payment never arrives.
- **Review.** An underwriter approves or rejects it. Attesters handle the exceptions: a payer that rejected or short-paid, or an overdue loan.
- **Get the loan and pay it back.** Coming next: funding is an XLS-66 loan from a private, credential-gated vault, and repayment, with interest based on the loan horizon, happens when the original payment arrives.

| On screen | In the code |
|---|---|
| loan | claim |
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

`pnpm local` starts Supabase and the edge functions, signs up four demo people (a borrower, an approver, a lender, an admin) whose wallets are funded on Devnet, adds loans in several states, and serves the site at http://localhost:3000. The sign-in screen offers the demo people as one-click buttons, so you don't need a Privy app locally. The keys it uses (a Privy test key and a wallet encryption key) are generated into `apps/web/e2e/.cache/`, which git ignores.

### Real Google and email sign-in locally

Without a Privy app the local build only offers the demo people. To sign in with Google or an emailed code:

1. In the [Privy dashboard](https://dashboard.privy.io), turn on **Google** and **Email** under login methods, add `http://localhost:3000` under Configuration > App settings > Domains (if you've listed any domains there), and turn on **Return user data in an identity token**.
2. Put the app ID in `.env` (gitignored) as both `NEXT_PUBLIC_PRIVY_APP_ID` and `PRIVY_APP_ID`. The backend checks tokens against the app's published keys, so no secret or verification key is needed.
3. Run `pnpm local` again. It uses that app, so Google and email work and the demo buttons go away.

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
