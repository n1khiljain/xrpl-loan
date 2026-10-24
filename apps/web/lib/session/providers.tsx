"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { type ReactNode, useState, useSyncExternalStore } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { chain, config } from "../config";
import { PUBLIC_ENV } from "../env";
import { SIGNED_OUT, SessionContext } from "./context";
import { DevSessionProvider } from "./dev-provider";
import { DEV_SESSION_KEY, type DevSessionSeed } from "./types";

// Privy touches window at import, so it loads in the browser only
const PrivySessionProvider = dynamic(() => import("./privy-provider").then((m) => m.PrivySessionProvider), { ssr: false });

const readOnlyWagmi = createConfig({ chains: [chain], transports: { [chain.id]: http(config.rpcUrl) }, ssr: true });

type ModeKind = "pending" | "dev" | "privy" | "none";

function storedSeed(): DevSessionSeed | undefined {
  try {
    const raw = window.sessionStorage.getItem(DEV_SESSION_KEY);
    return raw ? (JSON.parse(raw) as DevSessionSeed) : undefined;
  } catch {
    return undefined;
  }
}

function devSeed(): DevSessionSeed | undefined {
  // UNCERTAIN: U-62 (the injected session is honored on the local network only)
  if (config.network !== "local" || typeof window === "undefined") return undefined;
  return window.__FRAXNET_DEV_SESSION__ ?? storedSeed();
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
        ? { ...SIGNED_OUT, status: "signed-out" as const, unavailableReason: "Sign-in isn't set up in this build (NEXT_PUBLIC_PRIVY_APP_ID)." }
        : SIGNED_OUT;
    inner = (
      <WagmiProvider config={readOnlyWagmi}>
        <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
      </WagmiProvider>
    );
  }
  return <QueryClientProvider client={queryClient}>{inner}</QueryClientProvider>;
}
