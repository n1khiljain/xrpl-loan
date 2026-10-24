# Brand: Blockchain at Berkeley in collaboration with Frax

The app is a Blockchain at Berkeley product, built with Frax and styled with Frax's visual theme. It lives at college.frax.com. Frax has not approved the co-branded design yet (U-38), so every visual value lives in design tokens that can change without touching components.

## Who owns what

| Element | Comes from |
|---|---|
| Product name, voice, header lockup order | Blockchain at Berkeley |
| Overall look: palette, contrast, type feel, layout density | Frax's theme |
| Logos | Official files from each org only |
| Final token values | B@B design team, checked against Frax's brand page (frax.com/brand) and Frax's approval |

## Lockup

- Header: B@B logo, a thin "×" divider, then the Frax logo. Both logos at the same cap height.
- Clear space around the lockup equals the height of the "×".
- Footer text: "Built by Blockchain at Berkeley in collaboration with Frax. frxUSD is issued by Frax."
- Never place either logo inside a shape, recolor it, stretch it, or add effects.

## Logo files

- Put official files in `apps/web/public/brand/`: `bab-logo.svg`, `bab-logo-on-dark.svg`, `frax-logo.svg`, `frax-logo-on-dark.svg`.
- The design team gets B@B files from B@B and Frax files from Frax or frax.com/brand.
- Never redraw, trace, or recreate either logo in code, SVG, or CSS.
- If a file is missing during development, render the org name as plain text in the display font. The build does not fail.

## Look and feel

- Frax's theme is high-contrast and mostly monochrome: near-black and white surfaces, bold uppercase display type, thin rules, and lots of empty space.
- Blockchain at Berkeley adds one accent color, used only for primary actions, focus rings, and the active step in timelines.
- Don't copy Frax's engraved seal, pyramid, or currency artwork. Thin line patterns are fine as a background texture on the landing page only.
- Dark theme is the default. A light theme exists and uses the same tokens.
- Money is the main content. Amounts use tabular figures and are the largest text on claim and dashboard screens.

## Design tokens

Define these as CSS variables in `apps/web/app/globals.css`, map them into Tailwind's theme, and point shadcn/ui's variables at them. Components never use raw hex values.

The values below are provisional starting points so the build can run. The design team replaces them with official values before launch (U-38).

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0A0A0A` | `#FFFFFF` | Page background |
| `--surface` | `#141414` | `#F5F5F5` | Cards, panels |
| `--border` | `#2A2A2A` | `#E5E5E5` | Rules, card borders |
| `--text` | `#FAFAFA` | `#0A0A0A` | Body text |
| `--text-muted` | `#A3A3A3` | `#525252` | Secondary text |
| `--accent` | `#FDB515` | `#003262` | Primary buttons, focus, active step (B@B accent) |
| `--accent-contrast` | `#0A0A0A` | `#FFFFFF` | Text on the accent |
| `--success` | `#22C55E` | `#15803D` | Settled, Recovered, approved KYC |
| `--warning` | `#F59E0B` | `#B45309` | Overdue soon, pending KYC, testnet banner |
| `--danger` | `#EF4444` | `#B91C1C` | Rejected, GuarantorCalled, WrittenOff |

| Token | Value | Use |
|---|---|---|
| `--font-display` | `"Inter Tight", "Inter", system-ui, sans-serif` at weight 800, uppercase, tight tracking | Page titles, big numbers, landing headline |
| `--font-body` | `"Inter", system-ui, sans-serif` | Everything else |
| `--font-mono` | `"JetBrains Mono", ui-monospace, monospace` | Addresses and transaction hashes (admin and lender screens only) |
| `--radius` | `4px` | Cards, buttons, inputs |

- Load fonts with `next/font` so the static export bundles them.
- Every text and background pair must pass WCAG AA contrast. Add a unit test that checks the token pairs above.

## Claim state colors

| State | Token |
|---|---|
| `Submitted`, `Approved` | `--accent` |
| `Funded` | `--text` |
| `Settled`, `Recovered` | `--success` |
| `GuarantorCalled`, `WrittenOff`, `Rejected` | `--danger` |
| `Cancelled` | `--text-muted` |

Every state also shows its name as text. Color is never the only signal.

## Voice

- Plain and specific. "You'll get $240.00 now. When ASUC pays you, send $240.00 back to the pool."
- Purchase language only: sell your claim, purchase price, amount due, settle. Never loan, borrow, interest, or repay (U-09).
- Name Frax and FraxNet where they do something: "Verify your identity on FraxNet," "frxUSD is a digital dollar issued by Frax."
- Testnet banner text: "Testnet pilot. No real money moves."

## Screens that carry the brand most

- Landing page: full lockup, headline in the display font, one sentence on what it does, one button ("Sell a claim").
- Onboarding: "Verify with FraxNet" step shows the FraxNet name and opens https://net.frax.com in a new tab.
- Lender dashboard: monochrome, dense, numbers first.
- Admin Safe App: minimal branding, since it runs inside Frax's Safe UI.
