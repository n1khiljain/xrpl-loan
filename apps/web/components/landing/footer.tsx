import Link from "next/link";
import { ClientLockup } from "@/components/brand/logos-context";
import { SectionLink } from "@/components/landing/section-link";
import { config } from "@/lib/config";

/*
 * The landing's close, after smallest.ai's: the wordmark with columns of links, and a status line along the bottom.
 * The status says which XRPL test network the app runs on, from config.
 */

type FooterLink = { label: string; href: string };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "#how" },
      { label: "FAQ", href: "#faq" },
    ],
  },
  {
    title: "Borrow",
    links: [
      { label: "Expedite a payment", href: "/receivables/new/" },
      { label: "My loans", href: "/receivables/?view=receivables" },
      { label: "Approvals", href: "/receivables/?view=guaranties" },
      { label: "Verification", href: "/onboard/" },
    ],
  },
  {
    title: "Lend",
    links: [
      { label: "Lending vault", href: "/lend/" },
      { label: "Deposit and withdraw", href: "/lend/?view=deposit" },
    ],
  },
];

function FooterAnchor({ label, href }: FooterLink) {
  const className = "text-on-ink/60 hover:text-on-ink text-[15px] transition-colors";
  return href.startsWith("#") ? (
    <SectionLink href={href as `#${string}`} className={className}>
      {label}
    </SectionLink>
  ) : (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}

export function LandingFooter() {
  const network = config.network.replace("xrpl-", "");
  return (
    // after Ramp's close: the white page's rounded bottom corners lift off the Night footer underneath, so the page
    // ends on dark right after the FAQ
    <footer className="bg-ink text-on-ink w-full">
      <div aria-hidden className="bg-surface h-10 rounded-b-[2.5rem] lg:h-12 lg:rounded-b-[3rem]" />
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-12 px-4 pt-20 pb-16 sm:px-6 lg:flex-row lg:justify-between lg:px-10 lg:pt-28 lg:pb-24">
        <div className="flex flex-col gap-3">
          <span className="text-2xl">
            <ClientLockup tone="on-dark" />
          </span>
          <p className="text-on-ink/60 max-w-xs text-[15px] leading-relaxed">
            Upfront loans for businesses, from a lending vault on the XRP Ledger.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-16 gap-y-10 sm:grid-cols-3 lg:gap-x-24">
          {COLUMNS.map((col) => (
            <div key={col.title} className="flex flex-col gap-4">
              <span className="text-on-ink text-[15px] font-medium">{col.title}</span>
              <ul className="flex flex-col gap-3">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <FooterAnchor {...link} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      {/* the status bar in the glyph tint, the peach of the approved card, with Night type */}
      <div className="bg-[var(--glyph-tint)] text-ink">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-4 py-6 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10">
          <span className="flex items-center gap-2 font-medium">
            <span aria-hidden className="size-2 rounded-full bg-[var(--spot)]" />
            Running on XRPL {network}
          </span>
          <span>Test networks only. No real money moves.</span>
        </div>
      </div>
    </footer>
  );
}
