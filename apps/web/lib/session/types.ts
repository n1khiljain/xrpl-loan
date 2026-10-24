/**
 * Who's signed in, however they signed in. Privy handles real logins; the demo session exists only in local builds
 * with NEXT_PUBLIC_DEMO_SESSIONS=true, for clicking through as the people `pnpm demo` sets up.
 */
export type Session = {
  kind: "privy" | "dev" | "none";
  status: "loading" | "signed-out" | "signed-in";
  userId: string | null;
  /** The email they signed in with, by code or Google. */
  email: string | null;
  /** Their name from Google, when they signed in that way. Prefills account setup. */
  name: string | null;
  /** Emails a one-time code. `signUp: false` refuses to make a new account, so "Sign in" never creates one. */
  sendEmailCode(email: string, options: { signUp: boolean }): Promise<void>;
  /** Finishes an email sign-in with the code from `sendEmailCode`. */
  verifyEmailCode(code: string): Promise<void>;
  /** Redirects to Google and back. */
  loginWithGoogle(): Promise<void>;
  /** Why the last Google sign-in failed, read after the redirect back. */
  loginError: string | null;
  logout(): Promise<void>;
  getAccessToken(): Promise<string | null>;
  /** A Privy identity token, which proves the email to the backend. Null when there isn't one. */
  getIdentityToken(): Promise<string | null>;
  /** Shown when login can't work in this build, e.g. no Privy app ID. */
  unavailableReason: string | null;
};

/** A demo person from `scripts/local-demo.ts`: tokens signed with the local test key. Local builds only. */
export type DevSessionSeed = { accessToken: string; identityToken?: string; userId: string; email?: string };

/** sessionStorage key for a demo person, so you can click around locally without Privy. */
export const DEV_SESSION_KEY = "receivables.devSession";
