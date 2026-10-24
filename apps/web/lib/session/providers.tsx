"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { type ReactNode, useState, useSyncExternalStore } from "react";
import { PUBLIC_ENV } from "../env";
import { SIGNED_OUT, SessionContext } from "./context";
import { DevSessionProvider } from "./dev-provider";
import { DEV_SESSION_KEY, type DevSessionSeed } from "./types";

// Privy touches window at import, so it loads in the browser only
const PrivySessionProvider = dynamic(() => import("./privy-provider").then((m) => m.PrivySessionProvider), { ssr: false });

type ModeKind = "pending" | "dev" | "privy" | "none";

function devSeed(): DevSessionSeed | undefined {
  // the demo session is honored only in builds made with NEXT_PUBLIC_DEMO_SESSIONS=true
  if (!PUBLIC_ENV.demoSessions || typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(DEV_SESSION_KEY);
    return raw ? (JSON.parse(raw) as DevSessionSeed) : undefined;
  } catch {
    return undefined;
  }
}

function modeKind(): ModeKind {
  if (devSeed()) return "dev";
  return PUBLIC_ENV.privyAppId ? "privy" : "none";
}

const subscribeNever = () => () => {};

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false } } }),
  );
  // "pending" while prerendering and hydrating, so the static HTML and the first client render match
  const mode = useSyncExternalStore<ModeKind>(subscribeNever, modeKind, () => "pending");
  const seed = mode === "dev" ? devSeed() : undefined;

  let inner: ReactNode;
  if (seed) inner = <DevSessionProvider seed={seed}>{children}</DevSessionProvider>;
  else if (mode === "privy") inner = <PrivySessionProvider>{children}</PrivySessionProvider>;
  else {
    const session =
      mode === "none"
        ? {
            ...SIGNED_OUT,
            status: "signed-out" as const,
            unavailableReason: PUBLIC_ENV.demoSessions
              ? "Google and email sign-in need a Privy app, and this local build has none. Sign in as a demo person below, or set NEXT_PUBLIC_PRIVY_APP_ID (see README)."
              : "Sign-in isn't set up in this build (NEXT_PUBLIC_PRIVY_APP_ID).",
          }
        : SIGNED_OUT;
    inner = <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
  }
  return <QueryClientProvider client={queryClient}>{inner}</QueryClientProvider>;
}
