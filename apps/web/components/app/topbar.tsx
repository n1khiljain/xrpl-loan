"use client";

import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ClientLockup } from "@/components/brand/logos-context";
import { Button } from "@/components/ui/button";
import { areaFor } from "./app-shell";
import { cn } from "@/lib/utils";

function AreaAction() {
  const area = areaFor(usePathname() ?? "/");
  if (area === "member") {
    return (
      <Button asChild>
        <Link href="/receivables/new/">
          <Plus strokeWidth={2.2} /> Expedite a payment
        </Link>
      </Button>
    );
  }
  if (area === "lender") {
    return (
      <Button asChild>
        <Link href="/lend/?view=deposit">Deposit</Link>
      </Button>
    );
  }
  return null;
}

/**
 * The page header from the design: a crumb, a title, and the area's main action. On phones it adds the lockup row
 * the sidebar carries on desktop. Pass `action={null}` to hide the action, or your own node to replace it, and `back`
 * for a page one level down (a single loan) so there's a way back to its list.
 */
export function Topbar({
  title,
  crumb,
  action,
  back,
  className,
}: {
  title: ReactNode;
  crumb?: ReactNode;
  action?: ReactNode | null;
  back?: { href: string; label: string };
  className?: string;
}) {
  return (
    <header className={cn("mb-5 flex flex-col gap-4 lg:mb-6", className)}>
      <div className="flex items-center justify-between lg:hidden">
        <span className="flex text-xl">
          <ClientLockup />
        </span>
        <Link
          href="/"
          data-testid="main-site-phone"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm font-medium transition-colors"
        >
          <ArrowLeft aria-hidden className="size-4" /> Main site
        </Link>
      </div>
      {back ? (
        <Link
          href={back.href}
          data-testid="back-link"
          className="text-muted-foreground hover:text-foreground -mb-2 flex w-fit items-center gap-1.5 text-sm font-medium transition-colors"
        >
          <ArrowLeft aria-hidden className="size-4" /> {back.label}
        </Link>
      ) : null}
      <div className="flex min-h-16 items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {crumb ? <span className="text-muted-foreground truncate text-xs">{crumb}</span> : null}
          <h1 className="text-[22px] font-bold tracking-tight sm:text-2xl">{title}</h1>
        </div>
        <div className="hidden sm:block">{action === undefined ? <AreaAction /> : action}</div>
      </div>
    </header>
  );
}
