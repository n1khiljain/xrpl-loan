"use client";

import { PrivyProvider, getIdentityToken, useLoginWithEmail, useLoginWithOAuth, usePrivy } from "@privy-io/react-auth";
import { type ReactNode, useMemo } from "react";
import { PUBLIC_ENV } from "../env";
import { SessionContext } from "./context";
import type { Session } from "./types";

function PrivySession({ children }: { children: ReactNode }) {
  const privy = usePrivy();
  const emailLogin = useLoginWithEmail();
  // mounted on every page, so the redirect back from Google finishes wherever it lands
  const oauth = useLoginWithOAuth();
  const user = privy.authenticated ? privy.user : null;
  const session: Session = {
    kind: "privy",
    status: !privy.ready ? "loading" : privy.authenticated ? "signed-in" : "signed-out",
    userId: user?.id ?? null,
    email: user?.email?.address ?? user?.google?.email ?? null,
    name: user?.google?.name ?? null,
    sendEmailCode: (email, { signUp }) => emailLogin.sendCode({ email, disableSignup: !signUp }),
    verifyEmailCode: (code) => emailLogin.loginWithCode({ code }),
    loginWithGoogle: () => oauth.initOAuth({ provider: "google" }),
    loginError: oauth.state.status === "error" ? (oauth.state.error?.message ?? "Google sign-in didn't finish. Try again.") : null,
    logout: () => privy.logout(),
    getAccessToken: () => privy.getAccessToken(),
    // needs "Return user data in an identity token" on in the Privy dashboard; without it this is null
    getIdentityToken: () => getIdentityToken().catch(() => null),
    unavailableReason: null,
  };
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/**
 * Email code or Google. Privy is only the sign-in here: the XRPL wallet is a custodial one the backend makes, so no
 * embedded or external wallet is created.
 */
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
        loginMethods: ["email", "google"],
        appearance: { theme: "light", ...(accent ? { accentColor: accent as `#${string}` } : {}) },
        embeddedWallets: { ethereum: { createOnLogin: "off" }, showWalletUIs: false },
      }}
    >
      <PrivySession>{children}</PrivySession>
    </PrivyProvider>
  );
}
