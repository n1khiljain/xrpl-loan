import { type NetworkConfig, loadNetworkConfig } from "@app/config";

/** Every variable the edge functions read. `.env.example` lists the same names. */
export const ENV_NAMES = [
  "NETWORK",
  "RPC_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PRIVY_APP_ID",
  "PRIVY_VERIFICATION_KEY",
  "DRIP_PRIVATE_KEY",
  "DRIP_AMOUNT_WEI",
  "DRIP_THRESHOLD_WEI",
  "PAYOUT_PRIVATE_KEY",
  "FRAXNET_CLIENT_ID",
  "FRAXNET_CLIENT_SECRET",
  "FRAXNET_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "APP_BASE_URL",
  "CHAIN_SYNC_SECRET",
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

/**
 * The network config named by `NETWORK`. `RPC_URL` overrides its RPC endpoint, because functions served locally
 * run in Docker and reach the host's anvil at host.docker.internal rather than 127.0.0.1.
 */
export function networkConfig(env: Env): NetworkConfig {
  const config = loadNetworkConfig(requireEnv(env, "NETWORK"));
  const rpcUrl = env.get("RPC_URL");
  return rpcUrl ? { ...config, rpcUrl } : config;
}
