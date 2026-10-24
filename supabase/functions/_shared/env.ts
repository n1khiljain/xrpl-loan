import { type NetworkConfig, loadNetworkConfig } from "@app/config";

/** Every variable the edge functions read. `.env.example` lists the same names. */
export const ENV_NAMES = [
  "NETWORK",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PRIVY_APP_ID",
  "PRIVY_VERIFICATION_KEY",
  "WALLET_ENCRYPTION_KEY",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "APP_BASE_URL",
  // The setup script writes these. Functions read them only when a vault, loan, or credential step runs.
  "BROKER_SEED",
  "ISSUER_SEED",
] as const;
export type EnvName = (typeof ENV_NAMES)[number];

export type Env = { get(name: EnvName): string | undefined };

export const denoEnv: Env = { get: (name) => Deno.env.get(name) || undefined };

export class MissingEnvError extends Error {
  constructor(readonly variable: EnvName) {
    super(`${variable} is not set`);
    this.name = "MissingEnvError";
  }
}

export function requireEnv(env: Env, name: EnvName): string {
  const value = env.get(name);
  if (!value) throw new MissingEnvError(name);
  return value;
}

/** The network config named by `NETWORK`. */
export function networkConfig(env: Env): NetworkConfig {
  return loadNetworkConfig(requireEnv(env, "NETWORK"));
}
