# XRPL Receivables

Get paid now for money you're owed. A student org member waiting weeks on an ASUC reimbursement gets it today from a lending vault on the XRP Ledger, and sends it back to the vault when ASUC pays. Built by Blockchain at Berkeley for an XRPL hackathon (Lending & Borrowing track).

**Test networks only.** The app runs on XRPL Devnet, the one network with the Single Asset Vault (XLS-65) and Lending Protocol (XLS-66) amendments enabled. No real money moves.

Where things stand: [STATUS.md](STATUS.md). Repo rules: [CLAUDE.md](CLAUDE.md).

## How it works today

- **Sign in** with an email code or Google (Privy). The app makes you a custodial XRPL wallet and funds it with test XRP from the Devnet faucet.
- **Get verified.** Your Privy identity token proves your email; a reviewer approves you on the admin KYC page.
- **Ask for a reimbursement.** Enter the amount and CalLink request, upload receipts, and pick an officer to sign off. The officer agrees to cover what's left if ASUC never pays.
- **Review.** An underwriter approves or rejects it. Attesters handle the exceptions: a payer that rejected or short-paid, or an overdue claim.
- **Get paid and send it back.** Coming next: funding is an XLS-66 loan from a private, credential-gated vault, and repayment happens automatically when the payer pays.

| On screen | In the code |
|---|---|
| reimbursement | claim |
| officer sign-off | guaranty, by the guarantor |
| You got paid / Paid | `Funded` |
| Closed out | `Settled`, `Recovered` |
| Officer asked to cover | `GuarantorCalled` |

## Run it locally

Needs Node 24, pnpm 10, Deno 2, Docker, and the Supabase CLI (2.122+).

```bash
pnpm install
pnpm local
```

`pnpm local` starts Supabase and the edge functions, signs up four demo people (a member, an officer, a lender, an admin) whose wallets are funded on Devnet, adds reimbursements in several states, and serves the site at http://localhost:3000. The sign-in screen offers the demo people as one-click buttons, so you don't need a Privy app locally. The keys it uses (a Privy test key and a wallet encryption key) are generated into `apps/web/e2e/.cache/`, which git ignores.

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
| `PRIVY_APP_ID`, `PRIVY_VERIFICATION_KEY` | functions | Privy app and its verification key. Turn on "Return user data in an identity token" in the Privy dashboard. |
| `NEXT_PUBLIC_PRIVY_APP_ID` | web | The same Privy app |
| `WALLET_ENCRYPTION_KEY` | functions | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts every custodial seed. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web | Supabase project; the anon key only reaches functions |
| `NEXT_PUBLIC_DEMO_SESSIONS` | web | `true` only for local demo builds |
