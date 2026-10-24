import { CornerDownLeft } from "lucide-react";
import Link from "next/link";
import { ClientLockup } from "@/components/brand/logos-context";
import { SectionLink } from "@/components/landing/section-link";

/* eslint-disable @next/next/no-img-element */

const CONTACT = "admin@blockchain.berkeley.edu";

// X's and LinkedIn's marks as image files (Simple Icons, CC0), only to link to B@B's profiles
const SOCIALS = [
  { label: "Blockchain at Berkeley on X", href: "https://x.com/CalBlockchain", icon: "/images/landing/x-logo.svg", tilt: "-rotate-[5deg]" },
  { label: "Blockchain at Berkeley on LinkedIn", href: "https://www.linkedin.com/company/blockchain-at-berkeley", icon: "/images/landing/linkedin-logo.svg", tilt: "rotate-[4deg]" },
] as const;

const LINKS = [
  { label: "Home", href: "#top" },
  { label: "How it works", href: "#how" },
  { label: "For lenders", href: "/lend/" },
  { label: "Launch app", href: "/claims/" },
] as const;

export function LandingFooter() {
  return (
    <footer className="relative h-dvh min-h-[720px] w-full p-2 sm:p-3 lg:p-4">
      <img src="/images/landing/footer-glow.webp" alt="" width={1868} height={1432} loading="lazy" className="bg-ink size-full rounded-3xl object-cover object-center" />
      <div className="text-on-ink absolute inset-0 flex flex-col p-2 sm:p-3 lg:p-4">
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 pt-8 sm:gap-8 lg:gap-10">
          <h2 className="display-type max-w-sm text-center text-2xl sm:max-w-2xl sm:text-3xl lg:max-w-3xl lg:text-4xl xl:max-w-4xl xl:text-5xl 2xl:text-6xl">
            Get reimbursed for your next club expense.
          </h2>
          <div className="flex flex-col items-center gap-2 sm:gap-3">
            <div className="flex gap-2 sm:gap-3 lg:gap-4">
              {SOCIALS.map((s) => (
                <a
                  key={s.href}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={s.label}
                  title={s.label}
                  className={`border-border bg-on-ink text-ink block rounded-lg border p-2 transition-transform duration-300 hover:-translate-y-1 sm:rounded-xl sm:p-2.5 sm:hover:-translate-y-2 lg:p-3 ${s.tilt}`}
                >
                  <img src={s.icon} alt="" width={20} height={20} className="size-4 sm:size-5" />
                </a>
              ))}
            </div>
            <p className="text-on-ink/60 px-4 text-center text-sm font-medium sm:text-base">Follow Blockchain at Berkeley</p>
          </div>
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
              <p className="text-on-ink/60 text-xs leading-relaxed lg:text-[13px]">Built by Blockchain at Berkeley in collaboration with Frax. frxUSD is issued by Frax.</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 p-4 sm:w-[30%] sm:gap-4 sm:p-6 lg:gap-5 lg:p-8 xl:p-12">
            <p className="text-sm font-medium sm:text-base lg:text-lg">Stay in touch</p>
            {/* the original's newsletter field; this site has no backend, so it opens an email instead */}
            <a
              href={`mailto:${CONTACT}`}
              className="bg-ink/70 border-on-ink/20 flex h-11 w-full items-center justify-between gap-2 rounded-xl border p-[2px] lg:h-12"
            >
              <span className="text-on-ink/60 min-w-0 truncate px-3 text-sm lg:px-4">{CONTACT}</span>
              <span className="bg-on-ink/15 hover:bg-on-ink/25 flex h-full shrink-0 items-center gap-2 rounded-[10px] px-4 text-sm transition-colors lg:px-5">
                <CornerDownLeft aria-hidden className="size-4" />
                Email us
              </span>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
