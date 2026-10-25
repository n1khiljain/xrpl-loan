"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownToLine,
  ChartColumn,
  FileText,
  Handshake,
  House,
  IdCard,
  Landmark,
  Inbox,
  LogOut,
  type LucideIcon,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import type { LogoFiles } from "@/components/brand/lockup-view";
import { LockupView } from "@/components/brand/lockup-view";
import { useCall, useMe } from "@/hooks/use-api";
import { useSession } from "@/lib/session/context";
import type { OffchainReceivable } from "@/lib/types";
import { Avatar } from "./avatar";
import { cn } from "@/lib/utils";

export type Area = "member" | "lender" | "admin";

type NavItem = { key: string; label: string; href: string; icon: LucideIcon; badge?: number; danger?: boolean; primary?: boolean };

/** Which part of the app a path belongs to; the sidebar and tab bar follow it. */
export function areaFor(pathname: string): Area {
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/lend")) return "lender";
  return "member";
}

function activeKey(pathname: string, view: string | null): string {
  const p = pathname.replace(/\/$/, "") || "/";
  if (p === "/receivables") return view === "guaranties" ? "guaranties" : view === "receivables" ? "receivables" : "home";
  if (p === "/receivables/new") return "new";
  if (p === "/receivable") return "receivables";
  if (p === "/guarantee") return "guaranties";
  if (p === "/onboard") return "verify";
  if (p === "/lend/stats") return "stats";
  if (p === "/lend") return view === "deposit" ? "deposit" : "pool";
  const admin = p.split("/")[2];
  return admin ?? "queue";
}

/** Guaranty requests waiting on this person, for the sidebar badge. Shares its cache with nothing else. */
function useGuarantyRequests(wallet: string | undefined) {
  const call = useCall();
  const session = useSession();
  return useQuery({
    queryKey: ["receivables", "mine", "raw"],
    enabled: session.status === "signed-in" && Boolean(wallet),
    queryFn: () => call<{ receivables: OffchainReceivable[] }>("receivables"),
    select: (data) => data.receivables.filter((c) => c.guarantorWallet === wallet && c.packetHash && !c.guarantySigned).length,
    staleTime: 30_000,
  });
}

function navFor(area: Area, guaranties: number): NavItem[] {
  if (area === "lender") {
    return [
      { key: "pool", label: "Vault", href: "/lend/", icon: Landmark },
      { key: "deposit", label: "Deposit and withdraw", href: "/lend/?view=deposit", icon: ArrowDownToLine, primary: true },
      { key: "stats", label: "Vault stats", href: "/lend/stats/", icon: ChartColumn },
    ];
  }
  if (area === "admin") {
    return [
      { key: "queue", label: "Review queue", href: "/admin/", icon: Inbox },
      { key: "exceptions", label: "Exceptions", href: "/admin/exceptions/", icon: AlertTriangle },
      { key: "params", label: "Parameters", href: "/admin/params/", icon: SlidersHorizontal },
      { key: "orgs", label: "Businesses and approvers", href: "/admin/orgs/", icon: Users },
      { key: "kyc", label: "KYC status", href: "/admin/kyc/", icon: IdCard },
    ];
  }
  return [
    { key: "home", label: "Home", href: "/receivables/", icon: House },
    { key: "new", label: "Expedite a payment", href: "/receivables/new/", icon: Plus, primary: true },
    { key: "receivables", label: "My loans", href: "/receivables/?view=receivables", icon: FileText },
    { key: "guaranties", label: "Sign-offs", href: "/receivables/?view=guaranties", icon: Handshake, badge: guaranties || undefined },
    { key: "verify", label: "Verification", href: "/onboard/", icon: ShieldCheck },
  ];
}

const SECTION: Record<Area, string> = { member: "Borrower", lender: "Lender", admin: "Admin" };


function Sidebar({ area, logos, active }: { area: Area; logos: LogoFiles; active: string }) {
  const session = useSession();
  const me = useMe();
  const wallet = me.data?.profile?.wallet;
  const guaranties = useGuarantyRequests(wallet);
  const items = navFor(area, guaranties.data ?? 0);
  const name = me.data?.profile?.displayName ?? (session.status === "signed-in" ? "Signed in" : "Not signed in");
  const meta = me.data?.profile?.email ?? SECTION[area];
  const others: { href: string; label: string }[] = [
    ...(area !== "member" ? [{ href: "/receivables/", label: "Member home" }] : []),
    ...(area !== "lender" ? [{ href: "/lend/", label: "Lend to the vault" }] : []),
    ...(area !== "admin" && me.data?.staffRole ? [{ href: "/admin/", label: "Admin" }] : []),
  ];

  return (
    // the ink column runs the full page height; the nav inside it sticks to the top while the page scrolls
    <div className="bg-ink hidden w-64 shrink-0 lg:block">
      <nav aria-label={SECTION[area]} className="text-on-ink sticky top-0 flex h-screen flex-col overflow-hidden px-4 pt-6 pb-4">
        <div aria-hidden className="hex-texture pointer-events-none absolute inset-x-0 bottom-0 h-[360px] opacity-55" />
        <div aria-hidden className="bg-fade-ink-up pointer-events-none absolute inset-x-0 bottom-0 h-[360px]" />
        <Link href={area === "admin" ? "/admin/" : area === "lender" ? "/lend/" : "/receivables/"} className="relative px-2 text-2xl" aria-label="Home">
          <LockupView files={logos} tone="on-dark" />
        </Link>
        <div className="eyebrow text-on-ink/50 relative mx-2 mt-7 mb-2.5">{SECTION[area]}</div>
        <ul className="relative flex flex-col gap-0.5">
          {items.map((item) => {
            const on = item.key === active;
            const Icon = item.icon;
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "flex h-11 items-center gap-3 rounded-sm px-3 text-sm",
                    on ? "bg-on-ink/10 text-on-ink font-semibold" : "text-on-ink/65 hover:text-on-ink font-medium",
                  )}
                >
                  <Icon className="size-[18px]" strokeWidth={1.7} />
                  <span className="flex-1">{item.label}</span>
                  {item.badge ? (
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", item.danger ? "bg-danger-soft text-danger" : "bg-highlight text-highlight-contrast")}>
                      {item.badge}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="relative mt-auto flex flex-col gap-2.5">
          {others.length ? (
            <div className="flex flex-col gap-0.5">
              {others.map((o) => (
                <Link key={o.href} href={o.href} className="text-on-ink/60 hover:text-on-ink rounded-sm px-3 py-1.5 text-[13px] font-medium">
                  {o.label}
                </Link>
              ))}
            </div>
          ) : null}
          <div className="border-on-ink/10 bg-on-ink/7 flex items-center gap-2.5 rounded-lg border p-3 backdrop-blur">
            <Avatar name={me.data?.profile?.displayName} onInk />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[13px] font-semibold">{name}</span>
              <span className="text-on-ink/60 truncate text-[11px]">{meta}</span>
            </span>
            {session.status === "signed-in" ? (
              <button
                type="button"
                onClick={() => void session.logout()}
                aria-label="Sign out"
                data-testid="sign-out"
                className="text-on-ink/60 hover:text-on-ink hover:bg-on-ink/10 flex size-8 items-center justify-center rounded-full"
              >
                <LogOut className="size-4" />
              </button>
            ) : null}
          </div>
          <p className="text-on-ink/45 px-1 text-[10px] leading-snug">Built by Blockchain at Berkeley on the XRP Ledger. Test network only.</p>
        </div>
      </nav>
    </div>
  );
}

function TabBar({ area, active }: { area: Area; active: string }) {
  const me = useMe();
  const guaranties = useGuarantyRequests(me.data?.profile?.wallet);
  const all = navFor(area, guaranties.data ?? 0);
  // the phone bar keeps five: Home, My receivables, Sell, Guaranties, and Me (verification and profile)
  const items =
    area === "member"
      ? [all[0], all[2], all[1], all[3], { key: "verify", label: "Verification and profile", href: "/onboard/", icon: UserRound }]
      : area === "admin"
        ? all.slice(0, 4)
        : all;
  return (
    <div className="bg-fade-tabbar pointer-events-none fixed inset-x-0 bottom-0 z-40 flex h-24 items-center justify-center lg:hidden">
      <nav aria-label={`${SECTION[area]} navigation`} className="bg-surface shadow-float pointer-events-auto flex items-center gap-1 rounded-full p-1.5">
        {items.map((item) => {
          if (!item) return null;
          const on = item.key === active;
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-label={item.label}
              aria-current={on ? "page" : undefined}
              className={cn(
                "relative flex items-center justify-center rounded-full",
                item.primary ? "bg-primary text-primary-foreground size-[52px]" : on ? "bg-divider text-foreground h-11 w-[52px]" : "text-muted-foreground h-11 w-[52px]",
              )}
            >
              <Icon className="size-[21px]" strokeWidth={on || item.primary ? 2.2 : 1.8} />
              {item.badge ? <span className="bg-highlight absolute top-2 right-3 size-2 rounded-full" /> : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function Chrome({ logos, children }: { logos: LogoFiles; children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const view = useSearchParams().get("view");
  const session = useSession();
  const area = areaFor(pathname);
  const active = activeKey(pathname, view);
  // the landing page has its own header; signed-out gated pages show the full-screen sign-in instead of the chrome
  const bare = pathname === "/" || (session.status === "signed-out" && area !== "lender");
  if (bare) return <>{children}</>;
  return (
    <div className="flex min-h-[calc(100vh-var(--banner-h,0px))]">
      <Sidebar area={area} logos={logos} active={active} />
      <main className="min-w-0 flex-1 px-4 pt-4 pb-32 sm:px-6 lg:p-6">{children}</main>
      <TabBar area={area} active={active} />
    </div>
  );
}

/**
 * The app frame from the design canvas: a dark sidebar on desktop, a floating pill tab bar on phones. Pages draw
 * their own top bar with <Topbar>. `logos` comes from the server layout, which can see public/brand.
 */
export function AppShell({ logos, children }: { logos: LogoFiles; children: ReactNode }) {
  return (
    <Suspense fallback={<>{children}</>}>
      <Chrome logos={logos}>{children}</Chrome>
    </Suspense>
  );
}

