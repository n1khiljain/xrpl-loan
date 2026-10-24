"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { WagmiProvider, createConfig, http, injected, useAccount, useConnect } from "wagmi";
import { chain, config } from "../config";
import { SessionContext } from "./context";
import { devWalletProvider } from "./dev-wallet";
import { DEV_SESSION_KEY, type DevSessionSeed, type Session } from "./types";

function AutoConnect({ seed, children }: { seed: DevSessionSeed; children: ReactNode }) {
  const { connect, connectors } = useConnect();
  const { address, status } = useAccount();
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    const connector = connectors[0];
    if (status === "disconnected" && connector && !signedOut) connect({ connector });
  }, [status, connectors, connect, signedOut]);

  const session: Session = {
    kind: "dev",
    status: signedOut ? "signed-out" : address ? "signed-in" : "loading",
    userId: signedOut ? null : seed.userId,
    address: signedOut ? null : (address ?? null),
    email: signedOut ? null : (seed.email ?? null),
    name: null,
    login: () => setSignedOut(false),
    sendEmailCode: async () => {},
    verifyEmailCode: async () => setSignedOut(false),
    loginWithGoogle: async () => setSignedOut(false),
    loginError: null,
    logout: async () => {
      try {
        window.sessionStorage.removeItem(DEV_SESSION_KEY);
      } catch {
        // storage blocked; signing out of this tab still works
      }
      setSignedOut(true);
    },
    getAccessToken: async () => (signedOut ? null : seed.accessToken),
    unavailableReason: null,
  };
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/** Local network only: a wallet from an injected anvil key, and the injected test token (U-62). */
export function DevSessionProvider({ seed, children }: { seed: DevSessionSeed; children: ReactNode }) {
  const wagmiConfig = useMemo(
    () =>
      createConfig({
        chains: [chain],
        connectors: [
          injected({
            target: () => ({ id: "dev", name: "Local test wallet", provider: devWalletProvider(seed.privateKey, chain, config.rpcUrl) }),
          }),
        ],
        transports: { [chain.id]: http(config.rpcUrl) },
        ssr: true,
      }),
    [seed.privateKey],
  );
  return (
    <WagmiProvider config={wagmiConfig}>
      <AutoConnect seed={seed}>{children}</AutoConnect>
    </WagmiProvider>
  );
}
