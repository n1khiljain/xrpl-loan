import type { NetworkConfig } from "@app/config";
import { createClient } from "@supabase/supabase-js";
import { type TokenVerifier, createPrivyVerifier } from "./auth.ts";
import type { Database } from "./db/database.types.ts";
import { type ServiceClient, SupabaseDb } from "./db/supabase.ts";
import type { Db } from "./db/types.ts";
import { type Env, MissingEnvError, denoEnv, networkConfig, requireEnv } from "./env.ts";
import { type Handler, json, withErrors } from "./http.ts";
import { type Ledger, xrplLedger } from "./ledger.ts";
import { type Mailer, createLogMailer, createResendMailer } from "./mail.ts";
import { type ReceiptStorage, supabaseStorage } from "./storage.ts";
import { type Custody, createCustody, importWalletKey } from "./wallets.ts";

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
      // optional: without it the app's published JWKS is used
      verificationKey: this.env.get("PRIVY_VERIFICATION_KEY"),
    });
  }

  custody(): Custody {
    return createCustody({ db: this.db(), key: importWalletKey(requireEnv(this.env, "WALLET_ENCRYPTION_KEY")) });
  }

  ledger(): Ledger {
    return xrplLedger(this.config, this.db());
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
