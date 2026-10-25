"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ClientLockup } from "@/components/brand/logos-context";
import { SectionLink } from "@/components/landing/section-link";
import { Button } from "@/components/ui/button";

/*
 * The landing's top bar, after smallest.ai's: the wordmark on the left, the page's sections in the middle, and
 * sign-in beside the main call to action on the right. It stays pinned and frosts over the page as it scrolls under.
 * On phones the links fold into a menu below the bar.
 */

const NAV_LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#product", label: "Product" },
  { href: "/lend/", label: "For lenders" },
  { href: "#faq", label: "FAQ" },
] as const;

/** Section links glide on this page; the rest are ordinary routes. */
function NavLink({ href, ...rest }: { href: string; className: string; onClick?: () => void; children: React.ReactNode }) {
  return href.startsWith("#") ? <SectionLink href={href as `#${string}`} {...rest} /> : <Link href={href} {...rest} />;
}

export function LandingNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="border-divider bg-surface/85 sticky top-0 z-50 w-full border-b backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between gap-6 px-4 sm:px-6 lg:h-[72px] lg:px-10">
        <SectionLink href="#top" aria-label="Home" className="flex items-center text-xl">
          <ClientLockup />
        </SectionLink>
        <nav aria-label="Main" className="mr-auto hidden items-center gap-1 text-sm lg:ml-4 lg:flex">
          {NAV_LINKS.map((link) => (
            <NavLink key={link.href} href={link.href} className="text-foreground/80 hover:text-foreground px-4 py-2 font-medium transition-colors">
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <Button asChild variant="secondary">
            <Link href="/receivables/">Log in</Link>
          </Button>
          {/* sign-up and log-in are the same email or Google step; sign-up lands on onboarding, where a new account is set up */}
          <Button asChild>
            <Link href="/onboard/">Sign up</Link>
          </Button>
        </div>
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="bg-surface-muted text-foreground flex size-10 items-center justify-center rounded-full lg:hidden"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open ? (
        <nav aria-label="Main" className="border-divider flex flex-col gap-1 border-t px-4 py-3 sm:px-6 lg:hidden">
          {NAV_LINKS.map((link) => (
            <NavLink key={link.href} href={link.href} onClick={() => setOpen(false)} className="text-foreground px-2 py-3 text-base font-medium">
              {link.label}
            </NavLink>
          ))}
          <div className="mt-2 flex gap-2">
            <Button asChild variant="secondary" className="flex-1">
              <Link href="/receivables/" onClick={() => setOpen(false)}>
                Log in
              </Link>
            </Button>
            <Button asChild className="flex-1">
              <Link href="/onboard/" onClick={() => setOpen(false)}>
                Sign up
              </Link>
            </Button>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
