import type { Address } from "viem";

/**
 * Who's signed in, however they signed in. Privy handles real logins (FR-F2); the local dev session exists only
 * on the local network, for tests (U-62).
 */
export type LoginOptions = { method?: "email" | "wallet" };

export type Session = {
  kind: "privy" | "dev" | "none";
  status: "loading" | "signed-out" | "signed-in";
  userId: string | null;
  address: Address | null;
  /** The email they signed in with, by code or Google. Null for a wallet login. */
  email: string | null;
  /** Their name from Google, when they signed in that way. Prefills account setup. */
  name: string | null;
  /** Opens Privy's own sign-in modal. The app uses it for `method: "wallet"` (lenders and admins, FR-F2). */
  login(options?: LoginOptions): void;
  /** Emails a one-time code. `signUp: false` refuses to make a new account, so "Sign in" never creates one. */
  sendEmailCode(email: string, options: { signUp: boolean }): Promise<void>;
  /** Finishes an email sign-in with the code from `sendEmailCode`. */
  verifyEmailCode(code: string): Promise<void>;
  /** Redirects to Google and back. Berkeley accounts are Google accounts, so returning is one tap. */
  loginWithGoogle(): Promise<void>;
  /** Why the last Google sign-in failed, read after the redirect back. */
  loginError: string | null;
  logout(): Promise<void>;
  getAccessToken(): Promise<string | null>;
  /** Shown when login can't work in this build, e.g. no Privy app ID. */
  unavailableReason: string | null;
};

/**
 * What Playwright injects on the local network: an anvil key and a token signed with the e2e Privy test key
 * (supabase/functions/_tests/make-e2e-env.ts). Never read on any other network.
 */
export type DevSessionSeed = { privateKey: `0x${string}`; accessToken: string; userId: string; email?: string };

/** sessionStorage key for a demo persona from `scripts/local-demo.ts`, so you can click around local without Privy. */
export const DEV_SESSION_KEY = "fraxnet.devSession";

declare global {
  interface Window {
    __FRAXNET_DEV_SESSION__?: DevSessionSeed;
  }
}
