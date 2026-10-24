"use client";

import { PrivyProvider, useCreateWallet, useLoginWithEmail, useLoginWithOAuth, usePrivy } from "@privy-io/react-auth";
import { WagmiProvider, createConfig } from "@privy-io/wagmi";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { http, useAccount } from "wagmi";
import { chain, config } from "../config";
import { PUBLIC_ENV } from "../env";
import { SessionContext } from "./context";
import type { Session } from "./types";

const wagmiConfig = createConfig({ chains: [chain], transports: { [chain.id]: http(config.rpcUrl) }, ssr: true });

/**
 * Privy only makes the embedded wallet on its own modal, not on the app's sign-in screens, so a member who signs in
 * by email code or Google gets theirs here, once.
 */
function useEmbeddedWallet() {
  const { ready, authenticated, user } = usePrivy();
  const { createWallet } = useCreateWallet();
  const started = useRef(false);
  useEffect(() => {
    if (!ready || !authenticated || !user || user.wallet || started.current) return;
    started.current = true;
    createWallet().catch(() => {
      started.current = false;
    });
  }, [ready, authenticated, user, createWallet]);
}

function PrivySession({ children }: { children: ReactNode }) {
  const privy = usePrivy();
  const { address } = useAccount();
  const emailLogin = useLoginWithEmail();
  // mounted on every page, so the redirect back from Google finishes wherever it lands
  const oauth = useLoginWithOAuth();
  useEmbeddedWallet();
  const user = privy.authenticated ? privy.user : null;
  const session: Session = {
    kind: "privy",
    status: !privy.ready ? "loading" : privy.authenticated ? "signed-in" : "signed-out",
    userId: user?.id ?? null,
    address: privy.authenticated ? (address ?? null) : null,
    email: user?.email?.address ?? user?.google?.email ?? null,
    name: user?.google?.name ?? null,
    login: (options) => privy.login({ loginMethods: [options?.method ?? "email"] }),
    sendEmailCode: (email, { signUp }) => emailLogin.sendCode({ email, disableSignup: !signUp }),
    verifyEmailCode: (code) => emailLogin.loginWithCode({ code }),
    // UNCERTAIN: U-70 (Google is beyond FR-F2's email login); a Google identity can't be mistyped, so either tab can make the account
    loginWithGoogle: () => oauth.initOAuth({ provider: "google" }),
    loginError: oauth.state.status === "error" ? (oauth.state.error?.message ?? "Google sign-in didn't finish. Try again.") : null,
    logout: () => privy.logout(),
    getAccessToken: () => privy.getAccessToken(),
    unavailableReason: null,
  };
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/** Email code or Google with an embedded wallet; lenders can connect an external wallet instead (FR-F2). */
export function PrivySessionProvider({ children }: { children: ReactNode }) {
  // Privy wants a literal color, so read the brand token instead of repeating it here
  const accent = useMemo(
    () => (typeof window === "undefined" ? undefined : getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()),
    [],
  );
  return (
    <PrivyProvider
      appId={PUBLIC_ENV.privyAppId}
      config={{
        loginMethods: ["email", "google", "wallet"],
        appearance: { theme: "light", ...(accent ? { accentColor: accent as `#${string}` } : {}) },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
        defaultChain: chain,
        supportedChains: [chain],
      }}
    >
      <WagmiProvider config={wagmiConfig}>
        <PrivySession>{children}</PrivySession>
      </WagmiProvider>
    </PrivyProvider>
  );
}
