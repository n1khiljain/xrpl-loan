import { TEST_DRAW_UNITS } from "@app/adapters";
import { type NetworkConfig, isTestnet } from "@app/config";
import type { Payment } from "xrpl";
import { z } from "zod";
import type { TokenVerifier } from "../_shared/auth.ts";
import { requireCaller } from "../_shared/auth.ts";
import { unitsString } from "../_shared/claims.ts";
import type { Db } from "../_shared/db/types.ts";
import type { Env } from "../_shared/env.ts";
import { type Handler, badRequest, conflict, forbidden, json, methodNotAllowed, readJson } from "../_shared/http.ts";
import type { Ledger } from "../_shared/ledger.ts";
import { ensureAccess, issuedAmount, issuerWallet, readySetup, rethrowLedger, signingSeed, vaultSnapshot } from "../_shared/lending.ts";
import type { Custody } from "../_shared/wallets.ts";

export type VaultDeps = {
  auth: TokenVerifier;
  db: Db;
  ledger: Ledger;
  custody: Custody;
  config: NetworkConfig;
  env: Env;
  now?: () => Date;
};

const Body = z.strictObject({
  action: z.enum(["deposit", "withdraw", "draw"]),
  amount: unitsString.optional(),
});

/**
 * The private vault. Deposits are open during the subscription window and loans after it; withdrawals follow
 * the ledger's phase. On the stand-in asset, a verified person can draw test RLUSD so they have something to deposit.
 */
export function createVaultHandler(deps: VaultDeps): Handler {
  const now = deps.now ?? (() => new Date());
  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (req.method === "GET") {
      readySetup(deps.config);
      const snapshot = await vaultSnapshot(deps.ledger, deps.config, Math.floor(now().getTime() / 1000));
      const balances = await deps.ledger.balances(caller.profile.wallet);
      return json({
        phase: snapshot.phase,
        subscriptionAt: snapshot.subscriptionAt,
        redemptionAt: snapshot.redemptionAt,
        assetsTotal: snapshot.assetsTotal,
        assetsAvailable: snapshot.assetsAvailable,
        balance: balances.asset ?? "0",
      });
    }
    if (req.method !== "POST") throw methodNotAllowed(["GET", "POST"]);
    const body = await readJson(req, Body);
    if (caller.profile.kycStatus !== "approved") throw conflict("finish verification before you use the vault", "kyc_required");
    const setup = readySetup(deps.config);
    const at = Math.floor(now().getTime() / 1000);

    if (body.action !== "draw") {
      if (!body.amount) throw badRequest("amount: must be a positive decimal string of base units");
      const amount = BigInt(body.amount);
      if (body.action === "deposit") {
        const snapshot = await vaultSnapshot(deps.ledger, deps.config, at);
        if (snapshot.phase === "lending" || snapshot.phase === "closed") {
          throw conflict("deposits are closed. They were open until the subscription date.", "vault_phase");
        }
        if (amount > BigInt(deps.config.params.poolDepositCap)) throw conflict("that is above the vault's deposit cap", "over_cap");
        const balances = await deps.ledger.balances(caller.profile.wallet);
        if (BigInt(balances.asset ?? "0") < amount) {
          throw conflict(
            deps.config.asset.standIn ? "this wallet doesn't have enough RLUSD yet. Get test RLUSD first." : "this wallet doesn't have enough of the loan asset",
            "insufficient_funds",
          );
        }
      }
      await ensureAccess({
        ledger: deps.ledger,
        custody: deps.custody,
        config: deps.config,
        brokerSeed: signingSeed(deps.env, "BROKER_SEED"),
        holder: caller.profile.wallet,
      });
      const signer = await deps.custody.signer(caller.profile.wallet);
      const tx = {
        TransactionType: body.action === "deposit" ? ("VaultDeposit" as const) : ("VaultWithdraw" as const),
        Account: signer.classicAddress,
        VaultID: setup.vaultId,
        Amount: issuedAmount(deps.config, amount),
      };
      try {
        const submitted = await deps.ledger.submit(signer, tx, { purpose: body.action === "deposit" ? "vault_deposit" : "vault_withdraw" });
        return json({ hash: submitted.hash });
      } catch (error) {
        rethrowLedger(error);
      }
    }

    if (!deps.config.asset.standIn || !isTestnet(deps.config)) throw forbidden("test RLUSD is only for the stand-in asset on a test network");
    await ensureAccess({
      ledger: deps.ledger,
      custody: deps.custody,
      config: deps.config,
      brokerSeed: signingSeed(deps.env, "BROKER_SEED"),
      holder: caller.profile.wallet,
    });
    const issuer = issuerWallet(deps.config, signingSeed(deps.env, "ISSUER_SEED"));
    const tx: Payment = {
      TransactionType: "Payment",
      Account: issuer.classicAddress,
      Destination: caller.profile.wallet,
      Amount: issuedAmount(deps.config, TEST_DRAW_UNITS),
    };
    try {
      const submitted = await deps.ledger.submit(issuer, tx, { purpose: "test_draw" });
      return json({ hash: submitted.hash, amount: TEST_DRAW_UNITS.toString() });
    } catch (error) {
      rethrowLedger(error);
    }
  };
}
