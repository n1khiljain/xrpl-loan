"use client";

import { type ReactNode, useState } from "react";
import { SessionContext } from "./context";
import { DEV_SESSION_KEY, type DevSessionSeed, type Session } from "./types";

/** Local demo builds only: a signed-in session from tokens `scripts/local-demo.ts` minted with the local test key. */
export function DevSessionProvider({ seed, children }: { seed: DevSessionSeed; children: ReactNode }) {
  const [signedOut, setSignedOut] = useState(false);
  const session: Session = {
    kind: "dev",
    status: signedOut ? "signed-out" : "signed-in",
    userId: signedOut ? null : seed.userId,
    email: signedOut ? null : (seed.email ?? null),
    name: null,
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
    getIdentityToken: async () => (signedOut ? null : (seed.identityToken ?? null)),
    unavailableReason: null,
  };
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
