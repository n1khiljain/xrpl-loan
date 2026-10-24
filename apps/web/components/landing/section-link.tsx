"use client";

import type { AnchorHTMLAttributes, MouseEvent } from "react";

/**
 * A link to a section on this page (`#how`, `#faq`) that always glides there, even when the URL already has that hash,
 * which a plain link or Next's Link skips. Reduced motion jumps instead. Scroll offset comes from the section's scroll-mt.
 */
export function SectionLink({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: `#${string}` }) {
  function go(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    const target = document.getElementById(href.slice(1));
    if (!target || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    // "#top" is the page itself, so the address stays clean
    history.replaceState(null, "", href === "#top" ? window.location.pathname : href);
  }
  return <a href={href} onClick={go} {...rest} />;
}
