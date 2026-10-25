import type { NetworkConfig } from "@app/config";
import { explorerAccount, explorerTx } from "@app/adapters";
import { type TokenVerifier, requireCaller } from "../_shared/auth.ts";
import type { Db } from "../_shared/db/types.ts";
import { type Handler, json, methodNotAllowed } from "../_shared/http.ts";
import type { Ledger } from "../_shared/ledger.ts";

export type WalletDeps = { auth: TokenVerifier; db: Db; ledger: Ledger; config: NetworkConfig };

/**
 * The caller's custodial wallet as the ledger sees it: XRP for reserves and fees, the loan asset, and the
 * transactions the app recorded for it, each with an explorer link.
 */
export function createWalletHandler(deps: WalletDeps): Handler {
  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (req.method !== "GET") throw methodNotAllowed(["GET"]);
    const address = caller.profile.wallet;
    const [balances, txs] = await Promise.all([deps.ledger.balances(address), deps.db.listLedgerTxs({ account: address, limit: 20 })]);
    return json({
      address,
      explorerUrl: explorerAccount(deps.config, address),
      network: deps.config.network,
      exists: balances.exists,
      xrpDrops: balances.xrpDrops,
      assetUnits: balances.asset,
      assetCode: deps.config.asset.code,
      transactions: txs.map((t) => ({
        txHash: t.txHash,
        txType: t.txType,
        purpose: t.purpose,
        result: t.result,
        createdAt: t.createdAt,
        explorerUrl: explorerTx(deps.config, t.txHash),
      })),
    });
  };
}
