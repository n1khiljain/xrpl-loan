import Link from "next/link";
import { ClientLockup } from "@/components/brand/logos-context";
import { SectionLink } from "@/components/landing/section-link";

/* eslint-disable @next/next/no-img-element */

const LINKS = [
  { label: "Home", href: "#top" },
  { label: "How it works", href: "#how" },
  { label: "For lenders", href: "/lend/" },
  { label: "Launch app", href: "/receivables/" },
] as const;

export function LandingFooter() {
  return (
    <footer className="relative h-dvh min-h-[720px] w-full p-2 sm:p-3 lg:p-4">
      <img src="/images/landing/footer-glow.webp" alt="" width={1868} height={1432} loading="lazy" className="bg-ink size-full rounded-3xl object-cover object-center" />
      <div className="text-on-ink absolute inset-0 flex flex-col p-2 sm:p-3 lg:p-4">
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 pt-8 sm:gap-8 lg:gap-10">
          <h2 className="display-type max-w-sm text-center text-2xl sm:max-w-2xl sm:text-3xl lg:max-w-3xl lg:text-4xl xl:max-w-4xl xl:text-5xl 2xl:text-6xl">
            Expedite the next payment you choose.
          </h2>
          <p className="text-on-ink/70 max-w-xl text-center text-sm leading-relaxed sm:text-base">
            Upfront loans for businesses. Interest depends on the loan horizon.
          </p>
        </div>

        <div className="border-on-ink/25 flex flex-col rounded-b-3xl border-t border-dashed backdrop-blur-2xl sm:flex-row">
          <div className="border-on-ink/25 flex flex-col justify-between gap-5 p-4 sm:w-[70%] sm:border-r sm:border-dashed sm:p-6 lg:p-8 xl:p-10">
            <nav aria-label="Footer" className="grid grid-cols-2 gap-3 sm:flex sm:flex-col sm:gap-1">
              {LINKS.map((l) => (
                l.href.startsWith("#") ? (
                  <SectionLink key={l.href} href={l.href as `#${string}`} className="hover:text-on-ink/70 w-fit text-sm font-medium transition-colors sm:text-base lg:text-lg">
                    {l.label}
                  </SectionLink>
                ) : (
                <Link key={l.href} href={l.href} className="hover:text-on-ink/70 w-fit text-sm font-medium transition-colors sm:text-base lg:text-lg">
                  {l.label}
                </Link>
                )
              ))}
            </nav>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-6">
              <span className="text-base">
                <ClientLockup tone="on-dark" />
              </span>
              <p className="text-on-ink/60 text-xs leading-relaxed lg:text-[13px]">Install on the XRP Ledger. Runs on XRPL test networks only; no real money moves.</p>
            </div>
          </div>
          <div className="flex flex-col justify-end gap-3 p-4 sm:w-[30%] sm:gap-4 sm:p-6 lg:gap-5 lg:p-8 xl:p-12">
            <p className="text-sm font-medium sm:text-base lg:text-lg">Install</p>
            <p className="text-on-ink/60 text-sm leading-relaxed">
              Liquidity for a transaction, transfer, or payment, paid back with interest.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
