"use client";

import { Menu, X } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ClientLockup } from "@/components/brand/logos-context";
import { SectionLink } from "@/components/landing/section-link";
import { Button } from "@/components/ui/button";
import { EASE } from "@/components/motion";

const NAV_LINKS = [
  { href: "#how", label: "How it works" },
  { href: "/lend/", label: "For lenders" },
  { href: "#faq", label: "FAQ" },
] as const;

/** Section links glide on this page; the rest are ordinary routes. */
function NavLink({ href, ...rest }: { href: string; className: string; onClick?: () => void; children: React.ReactNode }) {
  return href.startsWith("#") ? <SectionLink href={href as `#${string}`} {...rest} /> : <Link href={href} {...rest} />;
}

/** A floating pill that slides away while you scroll down and comes back when you scroll up. */
export function LandingNav() {
  const [visible, setVisible] = useState(true);
  const [open, setOpen] = useState(false);
  const last = useRef(0);
  const delta = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const diff = y - last.current;
      delta.current = Math.sign(delta.current) === Math.sign(diff) ? delta.current + diff : diff;
      if (y < 50 || delta.current < -50) {
        setVisible(true);
        delta.current = 0;
      } else if (delta.current > 120 && y > 150) {
        setVisible(false);
        setOpen(false);
      }
      last.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center px-4 pt-4 lg:pt-6">
      <motion.header
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: visible ? 1 : 0.6, opacity: visible ? 1 : 0, y: visible ? 0 : -24 }}
        transition={{ duration: 0.6, ease: EASE }}
        className="border-on-ink/15 bg-ink text-on-ink shadow-float pointer-events-auto flex h-14 w-full max-w-[960px] items-center justify-between rounded-full border pr-2 pl-5 lg:h-16 lg:pl-7"
        style={{ visibility: visible ? "visible" : "hidden" }}
      >
        <SectionLink href="#top" aria-label="Home" className="text-base lg:text-xl">
          <ClientLockup tone="on-dark" />
        </SectionLink>
        <nav aria-label="Main" className="hidden items-center gap-1 text-sm lg:flex">
          {NAV_LINKS.map((link) => (
            <NavLink key={link.href} href={link.href} className="text-on-ink/80 hover:text-on-ink rounded-full px-4 py-2.5 font-medium">
              {link.label}
            </NavLink>
          ))}
          <Button asChild variant="light" className="ml-2">
            <Link href="/claims/">Sign in</Link>
          </Button>
        </nav>
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="bg-on-ink/10 text-on-ink flex size-10 items-center justify-center rounded-full lg:hidden"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </motion.header>
      {open ? (
        <motion.nav
          aria-label="Main"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-on-ink/15 bg-ink/95 shadow-float pointer-events-auto mt-2 flex w-full max-w-[960px] flex-col gap-1 rounded-2xl border p-2 backdrop-blur lg:hidden"
        >
          {NAV_LINKS.map((link) => (
            <NavLink key={link.href} href={link.href} onClick={() => setOpen(false)} className="text-on-ink rounded-xl px-4 py-3 text-sm font-medium">
              {link.label}
            </NavLink>
          ))}
          <Button asChild variant="light" className="mt-1">
            <Link href="/claims/" onClick={() => setOpen(false)}>
              Sign in
            </Link>
          </Button>
        </motion.nav>
      ) : null}
    </div>
  );
}
