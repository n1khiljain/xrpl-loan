import { TEST_DRAW_UNITS } from "@app/adapters";
import { type NetworkConfig, isTestnet } from "@app/config";
import type { Payment } from "xrpl";
import { z } from "zod";
import type { TokenVerifier } from "../_shared/auth.ts";
import { requireCaller } from "../_shared/auth.ts";
import { unitsString } from "../_shared/receivables.ts";
import type { Db } from "../_shared/db/types.ts";
import type { Env } from "../_shared/env.ts";
import { type Handler, badRequest, conflict, forbidden, json, methodNotAllowed, readJson } from "../_shared/http.ts";
import type { Ledger } from "../_shared/ledger.ts";
import { depositSeries, ensureAccess, issuedAmount, issuerWallet, listSeries, readySetup, rethrowLedger, signingSeed } from "../_shared/lending.ts";
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
  /** Which series. A deposit defaults to the series taking deposits; a withdrawal has to name one. */
  vaultId: z.string().regex(/^[0-9A-F]{64}$/).optional(),
});

/** The interest the app has recorded: paid on closed-out loans, and still due on open ones. Base units. */
async function interestFromLoans(db: Db) {
  const loans = await db.listReceivablesByStatus(["Funded", "GuarantorCalled", "WrittenOff", "Settled", "Recovered"]);
  let earned = 0n;
  let expected = 0n;
  let outstanding = 0;
  let impaired = 0;
  let defaulted = 0;
  for (const loan of loans) {
    if (!loan.loanId) continue;
    const interest = BigInt(loan.amountDue) - BigInt(loan.purchasePrice);
    if (loan.status === "Settled" || loan.status === "Recovered") earned += BigInt(loan.amountPaid) - BigInt(loan.purchasePrice);
    else if (!loan.defaultedAt) {
      expected += interest > 0n ? interest : 0n;
      outstanding += 1;
    }
    if (loan.impairedAt && !loan.defaultedAt && loan.status !== "Settled") impaired += 1;
    if (loan.defaultedAt) defaulted += 1;
  }
  return { interestEarned: (earned > 0n ? earned : 0n).toString(), interestExpected: expected.toString(), loansOutstanding: outstanding, loansImpaired: impaired, loansDefaulted: defaulted };
}

/** A lender's share of a series, valued at the vault's current assets per share. */
function holdingValue(held: string | null, outstanding: string | null, assetsTotal: string): string {
  if (!held || !outstanding || BigInt(outstanding) === 0n) return "0";
  return ((BigInt(held) * BigInt(assetsTotal)) / BigInt(outstanding)).toString();
}

/**
 * The rolling vault series. GET: every series with its phase and totals, the caller's share of each, and the vault
 * stats (deposits, outstanding debt, first-loss cover, interest). POST: deposit into the series taking deposits,
 * withdraw from a series that's paying out, or (on the stand-in asset) draw test RLUSD to deposit. On the stand-in asset, a verified person can draw test RLUSD so they have something to deposit.
 */
export function createVaultHandler(deps: VaultDeps): Handler {
  const now = deps.now ?? (() => new Date());
  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (req.method === "GET") {
      const setup = readySetup(deps.config);
      const nowUnix = Math.floor(now().getTime() / 1000);
      const [series, balances, interest] = await Promise.all([
        listSeries(deps.ledger, deps.config, nowUnix),
        deps.ledger.balances(caller.profile.wallet),
        interestFromLoans(deps.db),
      ]);
      const withHoldings = await Promise.all(
        series.map(async (s) => {
          const holding = s.shareMptId ? await deps.ledger.shareHolding(s.shareMptId, caller.profile.wallet) : { held: null, outstanding: null };
          return { ...s, yourShares: holding.held ?? "0", yourValue: holdingValue(holding.held, holding.outstanding, s.assetsTotal) };
        }),
      );
      const sum = (key: "assetsTotal" | "assetsAvailable" | "debtTotal" | "coverAvailable" | "lossUnrealized") =>
        series.reduce((total, s) => total + BigInt(s[key]), 0n).toString();
      return json({
        broker: setup.broker,
        series: withHoldings,
        totals: {
          assetsTotal: sum("assetsTotal"),
          assetsAvailable: sum("assetsAvailable"),
          debtTotal: sum("debtTotal"),
          coverAvailable: sum("coverAvailable"),
          lossUnrealized: sum("lossUnrealized"),
          ...interest,
        },
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
      const series = await listSeries(deps.ledger, deps.config, at);
      const target =
        body.action === "deposit"
          ? body.vaultId
            ? series.find((v) => v.vaultId === body.vaultId)
            : depositSeries(series)[0]
          : series.find((v) => v.vaultId === body.vaultId);
      if (!target) {
        throw conflict(body.action === "deposit" ? "no vault series is taking deposits right now" : "name the series to withdraw from", "no_series");
      }
      if (body.action === "deposit") {
        if (target.phase !== "subscription" && target.phase !== "open") throw conflict("that series has stopped taking deposits; it's lending now", "vault_phase");
        if (amount > BigInt(deps.config.params.poolDepositCap)) throw conflict("that is above the vault's deposit cap", "over_cap");
        const balances = await deps.ledger.balances(caller.profile.wallet);
        if (BigInt(balances.asset ?? "0") < amount) {
          throw conflict(
            deps.config.asset.standIn ? "this wallet doesn't have enough RLUSD yet. Get test RLUSD first." : "this wallet doesn't have enough of the loan asset",
            "insufficient_funds",
          );
        }
      } else if (target.phase === "lending") {
        throw conflict(`that series is lending until ${new Date((target.redemptionAt ?? 0) * 1000).toISOString().slice(0, 10)}; withdraw then`, "vault_phase");
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
        VaultID: target.vaultId,
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
