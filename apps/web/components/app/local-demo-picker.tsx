"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { PUBLIC_ENV } from "@/lib/env";
import { DEV_SESSION_KEY, type DevSessionSeed } from "@/lib/session/types";

type DemoPerson = { role: string; name: string; seed: DevSessionSeed };

const ROLE: Record<string, string> = {
  seller: "Borrower with loans in each state",
  guarantor: "Approver at a business",
  lender: "Lender",
  staff: "Admin (approves and reviews)",
};

/** Where each person lands, so one click shows their main screen. */
const HOME: Record<string, string> = { seller: "/receivables/", guarantor: "/receivables/", lender: "/lend/", staff: "/admin/" };

/**
 * Local demo builds only: one-click sign-in as the demo people that `pnpm demo` sets up, since real sign-in needs a
 * Privy app. Reads `public/local-demo-sessions.json`, which scripts/local-demo.ts writes and git ignores.
 */
function signInAs(person: DemoPerson) {
  // the session provider reads this on load (lib/session/providers.tsx)
  window.sessionStorage.setItem(DEV_SESSION_KEY, JSON.stringify(person.seed));
  window.location.assign(HOME[person.role] ?? "/receivables/");
}

function useDemoPeople(enabled = true) {
  return useQuery({
    queryKey: ["local-demo-sessions"],
    enabled: PUBLIC_ENV.demoSessions && enabled,
    retry: false,
    queryFn: async () => {
      const res = await fetch("/local-demo-sessions.json", { cache: "no-store" });
      if (!res.ok) throw new Error("no demo sessions");
      return (await res.json()) as DemoPerson[];
    },
  });
}

/**
 * `?as=seller` (or guarantor, lender, staff) signs this tab in as that person, so a demo can open one tab per person
 * already signed in; sessions are per tab. Mounted on every page, so it also switches a tab that's signed in as
 * someone else. It stays on the page asked for, minus `as`, and reloads because the session is read once on load.
 */
export function DemoAsSwitch() {
  const [as] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("as")));
  const people = useDemoPeople(Boolean(as));
  useEffect(() => {
    const person = as ? people.data?.find((p) => p.role === as) : undefined;
    if (!person) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("as");
    // from the landing, go to the person's main screen
    if (url.pathname === "/") url.pathname = HOME[person.role] ?? "/receivables/";
    if (window.sessionStorage.getItem(DEV_SESSION_KEY) === JSON.stringify(person.seed)) {
      window.history.replaceState(null, "", url);
      return;
    }
    window.sessionStorage.setItem(DEV_SESSION_KEY, JSON.stringify(person.seed));
    window.location.replace(url);
  }, [as, people.data]);
  return null;
}

export function LocalDemoPicker() {
  const people = useDemoPeople();

  if (!PUBLIC_ENV.demoSessions) return null;

  return (
    <div className="border-border flex flex-col gap-3 rounded-2xl border p-4" data-testid="local-demo">
      <div className="flex flex-col gap-0.5">
        <p className="text-foreground text-sm font-semibold">Local demo</p>
        <p className="text-muted-foreground text-xs">
          {people.data ? "Sign in as one of the demo people. Sign out to switch." : "Run `pnpm demo` to set up demo people to sign in as."}
        </p>
      </div>
      {people.data ? (
        <ul className="divide-divider flex flex-col divide-y">
          {people.data.map((person) => (
            <li key={person.role}>
              <button
                type="button"
                onClick={() => signInAs(person)}
                data-testid={`demo-${person.role}`}
                className="group flex w-full items-center justify-between gap-3 py-2.5 text-left"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-foreground text-sm font-semibold">{person.name}</span>
                  <span className="text-muted-foreground text-xs">{ROLE[person.role] ?? person.role}</span>
                </span>
                <ArrowRight aria-hidden className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
