/** Build-time public settings. Next inlines each `process.env.NEXT_PUBLIC_*` reference, so they're listed one by one. */
export const PUBLIC_ENV = {
  network: process.env.NEXT_PUBLIC_NETWORK ?? "xrpl-devnet",
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "",
  supabaseUrl: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321").replace(/\/+$/, ""),
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  /** "true" only in local builds: offers one-click demo people on the sign-in screen (scripts/local-demo.ts). */
  demoSessions: process.env.NEXT_PUBLIC_DEMO_SESSIONS === "true",
};
