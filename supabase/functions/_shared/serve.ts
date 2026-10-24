import type { NetworkConfig } from "@app/config";
import {
  type ChainReader,
  type FraxNetClient,
  type GasSponsor,
  createChainReader,
  createFraxNetClient,
  createGasSponsor,
  publicClientFor,
} from "@app/adapters";
import { createClient } from "@supabase/supabase-js";
import type { Hex } from "viem";
import { type TokenVerifier, createPrivyVerifier } from "./auth.ts";
import { type Payout, type RegistryReads, type SignatureCheck, chainSignatureCheck, payoutFor, registryReads } from "./chain.ts";
import type { Database } from "./db/database.types.ts";
import { type ServiceClient, SupabaseDb } from "./db/supabase.ts";
import type { Db } from "./db/types.ts";
import { type Env, MissingEnvError, denoEnv, networkConfig, requireEnv } from "./env.ts";
import { type Handler, json, withErrors } from "./http.ts";
import { type Mailer, createLogMailer, createResendMailer } from "./mail.ts";
import { type ReceiptStorage, supabaseStorage } from "./storage.ts";
import { profileLiquidationStore } from "./kyc.ts";

/** Builds production dependencies from environment variables, each only when a function asks for it. */
export class Context {
  readonly config: NetworkConfig;
  private client?: ServiceClient;
  private cachedDb?: Db;

  constructor(readonly env: Env = denoEnv) {
    this.config = networkConfig(env);
  }

  get appBaseUrl(): string {
    return requireEnv(this.env, "APP_BASE_URL");
  }

  private supabase(): ServiceClient {
    this.client ??= createClient<Database>(requireEnv(this.env, "SUPABASE_URL"), requireEnv(this.env, "SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    return this.client;
  }

  db(): Db {
    this.cachedDb ??= new SupabaseDb(this.supabase());
    return this.cachedDb;
  }

  storage(): ReceiptStorage {
    return supabaseStorage(this.supabase());
  }

  auth(): TokenVerifier {
    return createPrivyVerifier({
      appId: requireEnv(this.env, "PRIVY_APP_ID"),
      verificationKey: requireEnv(this.env, "PRIVY_VERIFICATION_KEY"),
    });
  }

  fraxnet(): FraxNetClient {
    return createFraxNetClient(this.config, {
      clientId: this.env.get("FRAXNET_CLIENT_ID"),
      clientSecret: this.env.get("FRAXNET_CLIENT_SECRET"),
      store: profileLiquidationStore(this.db()),
    });
  }

  gasSponsor(): GasSponsor {
    return createGasSponsor(this.config, {
      dripPrivateKey: this.env.get("DRIP_PRIVATE_KEY"),
      amountWei: this.env.get("DRIP_AMOUNT_WEI"),
      thresholdWei: this.env.get("DRIP_THRESHOLD_WEI"),
      publicClient: publicClientFor(this.config),
    });
  }

  dripAmountWei(): bigint {
    const value = this.env.get("DRIP_AMOUNT_WEI");
    return value && /^[0-9]+$/.test(value) ? BigInt(value) : 0n;
  }

  chain(): ChainReader {
    return createChainReader(this.config, { publicClient: publicClientFor(this.config) });
  }

  registry(): RegistryReads {
    return registryReads(this.config);
  }

  signatureCheck(): SignatureCheck {
    return chainSignatureCheck(publicClientFor(this.config));
  }

  payout(): Payout {
    return payoutFor(this.config, requireEnv(this.env, "PAYOUT_PRIVATE_KEY") as Hex);
  }

  mailer(): Mailer {
    const apiKey = this.env.get("RESEND_API_KEY");
    return apiKey ? createResendMailer({ apiKey, from: requireEnv(this.env, "EMAIL_FROM") }) : createLogMailer();
  }
}

/**
 * Starts a function. A missing variable becomes a 503 naming it, not a crash loop, so a half-configured project
 * says what's wrong.
 */
export function serve(build: (ctx: Context) => Handler): void {
  let handler: Handler;
  let origin: string | undefined;
  try {
    const ctx = new Context();
    origin = ctx.env.get("APP_BASE_URL");
    handler = build(ctx);
  } catch (error) {
    const variable = error instanceof MissingEnvError ? error.variable : null;
    console.error(error);
    handler = () =>
      Promise.resolve(
        json(
          { error: { code: "not_configured", message: variable ? `${variable} is not set` : "function is misconfigured" } },
          { status: 503 },
        ),
      );
  }
  Deno.serve(withErrors((req) => handler(req), { allowedOrigin: origin }));
}
