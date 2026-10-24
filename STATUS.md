# Status

Last updated 2026-10-21 by Claude. If you're an AI agent: read this, then `CLAUDE.md` (the repo rules), then `docs/RUNBOOK.md` for the step you're on. Update this file when something here changes.

Live testnet preview: https://fraxnet-college.andrewjliu22.workers.dev (landing), with the app behind Sign in. Deployed by hand; see "Hosted preview" in `docs/RUNBOOK.md`.

The October 11 hackathon runs on **Fraxtal mainnet with real frxUSD** (U-68). Testnet is where we rehearse it.

## Deadlines

These come from the team channel and are fixed.

- **October 11, 2026:** hackathon launch on mainnet, the first live use. Target: $10,000 in reimbursement claims bought against real hackathon expenses.
- **Rest of the semester:** B@B's own internal receivables run through the platform, working toward $50,000 lent in total (hackathon plus internal). Onboard the first outside orgs, Venture and Entrepreneurship at Berkeley among them.
- **Mid-December:** three orgs onboarded and live, closing out Semester 1. The team and Frax decide on a Semester 2 engagement.
- **Next semester:** move from a subsidized pilot to a project funded by its own revenue. Go-to-market: club fairs, ASUC relations, outreach across campus clubs.

As of September 27 that's 14 days out. The PRD's build milestones (section 14) put the testnet deploy at October 2 to 3 and a full B@B dry run on October 9 to 10, with code freeze the night of October 10. The PRD assumed the hackathon would stay on testnet; it doesn't anymore, so the mainnet deploy has to land by October 10 too.

## Done

- Contracts (claim registry, ERC-4626 pool, claim NFT, org registry) with unit, fuzz, and invariant tests, static analysis triaged. Not audited.
- Emergency closeout (2026-10-19, U-80): the pool admin can permanently stop deposits, purchases, regular withdrawals, and share transfers. Each shareholder can claim its proportion of idle cash with `emergencyWithdraw`, retaining rights to later settlements and written-off recoveries. This route is independent of registry availability and ERC-4626 valuation. Contract calls and Safe instructions are in RUNBOOK step 12; no emergency web screen yet. Requires a new deployment; no network deployment was performed. Normal operation still has the U-79 risks below. Not audited.
- A yearly fee and an admin call (2026-10-19, U-82, U-84). The fee is now a yearly rate on unpaid principal, still 0 for the pilot; the claim form shows the most it could be by the due date, and the pay screen adds an hour of fee so a full payment still closes the claim. The admin Safe also got `execute`, an any-call fallback from the pool; it was removed on 2026-10-21 after the security campaign (B-4b, B-4c), so no role can move pool cash directly. sfrxUSD staking and the staked/unstaked share classes (U-81, U-83) were added the same day and removed on 2026-10-20 at the product owner's request: the pool is back to one ERC-4626 vault holding only frxUSD. Tested: 340 contract tests, the six Fraxtal mainnet fork tests, 100% coverage on `src/`, Slither and Aderyn rerun, adapter and web unit tests, typecheck, and lint. The Playwright suite and edge-function tests still need the local Docker stack and Deno. Not deployed, not audited.
- Security campaign (2026-10-21, branch `security-campaign`): adversarial tests, a second invariant handler, mutation testing, Medusa, Halmos, and a probe of the real frxUSD's admin powers. No outsider or claimant can drain the pool, and nothing Critical was found. The serious findings are off-chain: KYC is granted per FraxNet organization (E-2a), and chain 252 accepts `isTestnet: true`, which can deploy the mintable mock token or turn on the simulated payout (E-1). In the contracts, the fairness findings need a second lender (U-79), and the admin's `execute` could forgive a claim without booking a loss or block emergency withdrawals. Frax's owner Safe can freeze, pause, or burn the pool's frxUSD (U-85). Contract fixes so far (2026-10-21): `execute` deleted (B-4b), emergency withdrawals capped at idle cash and never underflow after a frxUSD burn (B-4c), purchases need the guarantor to still be an active officer (B-7), `maxMint` no longer reverts for a huge deposit cap (D-3), forge 1.8.5 lint clean (D-4), mutant 331 killed (D-5). Off-chain fixes the same day: `isTestnet` is derived from the chain ID and mainnet configs refuse every mock; the deploy script requires three distinct Safes; `isBusiness: null` no longer passes KYC; the webhook refuses replays and never overrides a manual rejection; the guarantor's typed data is built in the browser; invites, gas drips, payouts, cash-out addresses, sign-in tokens, and the seed are tightened; the site sends a CSP and only Safe UIs may frame it. New migration `once_keys`. Not deployed: the contracts need a fresh deployment, and Andrew deploys the functions, migration, and Worker. Check sign-in and Safe App loading on the hosted site after the CSP goes out. Still open: KYC per FraxNet organization (E-2a, waiting on Frax, U-77) and the second-lender limits (U-79). `contracts/audits/security-campaign.md` has every finding.
- Supabase backend: schema, private receipt storage, 16 edge functions. Hosted project `thrroafmcnkjagkqhfjg` is live with migrations and functions deployed.
- Web app on the B@B design canvas: claimant, guarantor, lender, and admin Safe App screens, desktop and phone. Hosted as a Cloudflare Worker at the URL above.
- Sign-in through Privy ("FraxNet College (testnet)", dev mode, 150-user cap): separate Sign in and Create account tabs, Google or an emailed code typed on the page, 30 days signed in per device (U-70). Setup only asks for a name. Onboarding works live. Andrew's wallet is staff (underwriter).
- testnet FRAX for gas in the deployer, pauser, lender, gas-drip, and payout wallets
- Per-org caps: the admin Safe can give one org its own cap (`setOrgCap`, U-69). Blockchain at Berkeley gets 50,000, every other org stays on the 10,000 default. Set from `/admin/orgs/`.
- Landing page rebuilt on the Project One template's layout and motion, with our copy, tokens, and a hero on frax.com's own Earth footage with a strip of 21 club logos (U-72, U-74). Template used with the author's permission, given by DM; club consent claimed by the product owner, not documented. Frax hasn't seen it yet. Its "How it works" shots are of the current app.
- The whole app restyled to match the landing (U-75), screen by screen with a before and after for each: sign-in and account setup, verification, sign-off, home, the reimbursement form (org picked for you when there's one, one amount field, "Take less" for a smaller amount), the reimbursement page (one readable page with the card beside it), cash out, the pool, and every admin page. Claim cards change color and finish by state and play a short moment on approval, payment, and close-out.
- One theme, light. Dark mode and its toggle are gone (U-76, which conflicts with BRAND.md's dark default).
- Pool review before Frax's 40,000 (2026-10-16): the pool is OpenZeppelin's ERC-4626 with an allowlist, a deposit cap, and withdrawals capped at idle cash. Rechecked against Maple Finance's pools, rehearsed against Fraxtal mainnet's real frxUSD on a fork (`contracts/test/fork/`), and the rehearsal caught a bug where the last lender couldn't redeem every share after a write-off, now fixed. 303 tests, 100% coverage, Slither clean apart from the accepted timestamp notes. Two single-lender assumptions are written down in `contracts/SECURITY.md` (U-79). Not audited.
- Connect FraxNet (U-77): after account setup, members sign in to FraxNet through Frax's OAuth app and their organization's `verified` flag sets KYC. Nobody unverified can start or submit a reimbursement or sign off, and Approve in the review queue waits for both people. `/admin/kyc/` stays as the fallback. Built and tested end to end locally against a mock FraxNet. Deployed to the hosted testnet app on 2026-10-10 (migration, functions, Worker), pointed at FraxNet staging (`net-test.frax.com`). Frax registered our redirect URIs the same day. Waiting on the two secrets below before the first real connect.
- `pnpm local` runs the whole stack on this machine (anvil, contracts, Supabase, functions, a seeded demo, the web app) with a picker to sign in as any demo person. See "Click around locally" in `docs/RUNBOOK.md`.
- README screenshots retaken on September 27 from `pnpm --filter web readme-shots`.
- CI green on `main`: contracts, static analysis, workspace checks, Supabase tests, full Playwright suite

## Blocked, and on whom

| What | Who | Why it matters |
|---|---|---|
| Three Safes on Fraxtal testnet (admin, underwriter, attester), 2 of 3 signers each | 3 B@B signers send Andrew a wallet address | The contracts can't deploy until their roles point at real Safes. Nothing past onboarding works until then. |
| Test frxUSD minted: 10,000 to the lender `0x230235d2316845267f209aAAfd91459787831848`, 3,000 to the payout wallet `0xDaDB01E870eAe3E3C249bDa901D35e17aB07B87D` | Frax. The token at `0xfc00...0001` has zero supply and only Frax's Safe can mint it (U-67) | Without it nobody can get paid, the pool can't be seeded, and "simulate ASUC payout" has nothing to send. |
| Approve the "Cloudflare Workers and Pages" GitHub app on BerkeleyBlockchain, just this repo | A BerkeleyBlockchain org owner | Turns on deploy-on-push to `main`. Until then Andrew deploys by hand. |
| Repo About: website and description | An org owner | Cosmetic. Values are in the team message. |
| Sign-off on the co-branded look (U-38, U-65) and answers to the open questions at the bottom of `docs/UNCERTAINTIES.md` | Frax | Needed before outside orgs join. |
| Three Safes on Fraxtal **mainnet**, 2 of 3 signers each. Can be the same signers as testnet, but they're new Safes | 3 B@B signers | Nothing deploys to mainnet without them. |
| Frax's 40,000 frxUSD deposit into the mainnet pool, and the address it comes from. Roger coordinates; the steps are in `docs/RUNBOOK.md`, "Seeding the pool with Frax's 40,000" | Frax, with Roger | This is the money claims are bought with. Frax is the only lender for now; adding another is one admin Safe transaction, but the pool should change first (U-79). |
| Confirm that `verified` on a personal FraxNet organization means that person passed KYC (redirect URIs and scopes are done) | Frax | We treat it that way now (U-77). |
| `FRAXNET_CLIENT_ID` and `FRAXNET_CLIENT_SECRET` set as Supabase secrets on the hosted project | Andrew | Connect FraxNet answers "isn't set up on this server yet" until then. The secret only goes in Supabase, never in a file in the repo. |
| A production FraxNet app for mainnet, and a fresh staging secret | Frax | Mainnet stays on the mock FraxNet and manual KYC until then (U-77). |
| Partner API base URL (or agreement to confirm KYC by hand) and the Frax Mesh address (or agreement that cash-out waits) | Frax | `deployments/fraxtal.json` won't load without both (U-68). The API is due October 2. |
| Production Privy app, mainnet Supabase project, mainnet Worker | Andrew | The testnet ones stay for rehearsals. Privy dev mode caps sign-ins at 150. |

## Next, once the testnet Safes exist

1. Put the three Safe addresses and the pauser in `deployments/fraxtal-testnet.json`, run the config and deploy tests, dry-run the deploy (RUNBOOK steps 3 and 4).
2. Andrew runs the one `--broadcast` command (step 5). Nobody else, and never CI or an agent.
3. Verify the roles, commit the deployed addresses, redeploy the site, turn on the chain sync (steps 5 and 7).
4. Each signer adds the Safe App at `https://fraxnet-college.andrewjliu22.workers.dev/admin/` (step 9).
5. When Frax's frxUSD arrives: allowlist the lender, deposit, add the first org and its officers, and walk one real claim end to end (steps 6 and 10).

## Then mainnet, by October 10

Same steps against `deployments/fraxtal.json`; the differences are in `docs/RUNBOOK.md` under "Fraxtal mainnet". After adding Blockchain at Berkeley, the admin Safe sets its cap to 50,000 before anyone sells a claim. Andrew runs the broadcast, never CI or an agent.

## Watch out for

- **The pool is the real limit now.** B@B's own cap is 50,000, so the org cap no longer sits on the $10,000 target. But a claim can only be bought if the pool has enough idle cash at that moment, so Frax has to have at least 10,000 in before October 11. B@B's cap is also the whole pool at the 50,000 deposit cap, so underwriters leave room for other orgs by hand.
- $2,500 per claim, so the $10,000 target is at least four claims. A bigger bill can only sell $2,500 of itself.
- The $50,000 semester total matches `poolDepositCap`, but "lent" counts money that comes back and goes out again, so that one has room.
- KYC status: members and officers now have to be verified before they can sell or sign off. On testnet that comes from Connect FraxNet (U-77); anywhere FraxNet can't answer, an underwriter confirms each person with Frax and records it at `/admin/kyc/` (U-07, U-36). Persona takes 1 to 3 business days, so officers should start verifying on net.frax.com early.
- The yellow testnet banner is off while only the team uses the site (U-66). Turn it on before outside members sign in. It's still the old full-width yellow bar, so restyle it to match the rest of the app first.
- Mainnet sign-in needs its own production Privy app. The testnet app stays in dev mode (150 users).
- The contracts aren't audited, and the hackathon puts real money in them. U-68 asks Frax whether they want a review first.

## Where things live

- What to build and why: `docs/PRD.md`. How it's built: `docs/SYSTEM_DESIGN.md`. Neither is edited.
- Every call Frax hasn't confirmed: `docs/UNCERTAINTIES.md`, U-01 to U-80.
- step-by-step deploy and hosting: `docs/RUNBOOK.md`, starting at "Hosted preview". Mainnet differences are the last section.
- Private keys and function secrets are only on Andrew's machine, never in the repo. Ask him if you need to act as one of the wallets.
