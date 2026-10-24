import type { ChainReader } from "@app/adapters";
import { type NetworkConfig, isTestnet } from "@app/config";
import type { Address } from "viem";
import { z } from "zod";
import { type TokenVerifier, requireCaller } from "../_shared/auth.ts";
import type { Payout, RegistryReads } from "../_shared/chain.ts";
import { loadClaim, requireClaimant, uuid } from "../_shared/claims.ts";
import type { Db } from "../_shared/db/types.ts";
import { type Handler, conflict, forbidden, json, methodNotAllowed, readJson } from "../_shared/http.ts";

export type SimulatePayoutDeps = {
  auth: TokenVerifier;
  db: Db;
  config: NetworkConfig;
  chain: ChainReader;
  registry: RegistryReads;
  /** Built on first use, so a mainnet deploy never needs a payout key. */
  payout: () => Payout;
};

const Body = z.strictObject({ claimId: uuid });

/**
 * Whether this network may run the simulation at all: a testnet chain with the feature on (FR-B10). Testnet comes
 * from the chain ID, never from the file, so chain 252 always refuses (security campaign E-4c).
 */
export function payoutAllowed(config: Pick<NetworkConfig, "chainId" | "features">): boolean {
  return isTestnet(config) && config.features.simulateAsucPayout === true;
}

/**
 * Testnet only: stands in for ASUC paying the claimant by sending frxUSD up to the amount still due, so they can
 * settle (FR-B10). It mints MockFrxUSD, or transfers Frax's test frxUSD from the payout wallet (U-67). Refuses on
 * Fraxtal mainnet whatever the feature flag says, and pays each claim at most once, so cashing out and asking again
 * can't drain the payout wallet (E-4b).
 */
export function createSimulatePayoutHandler(deps: SimulatePayoutDeps): Handler {
  const { config } = deps;
  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (!payoutAllowed(config)) {
      throw forbidden("simulate-payout only runs on testnets", "testnet_only");
    }
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    const { claimId } = await readJson(req, Body);
    const claim = await loadClaim(deps.db, claimId);
    requireClaimant(caller, claim);
    if (claim.onchainClaimId === null) throw conflict("this claim hasn't been submitted onchain", "not_onchain");
    const onchain = await deps.chain.getClaim(BigInt(claim.onchainClaimId));
    if (!["Funded", "GuarantorCalled", "WrittenOff"].includes(onchain.state) || onchain.amountRemaining === 0n) {
      throw conflict(`nothing is due on this claim (${onchain.state})`, "nothing_due");
    }
    const recipient = onchain.recipient as Address;
    const balance = await deps.registry.tokenBalance(recipient);
    const shortfall = onchain.amountRemaining - balance;
    if (shortfall <= 0n) throw conflict("your wallet already holds enough frxUSD to settle", "already_funded");
    const payout = deps.payout();
    // UNCERTAIN: U-67 (Frax's test frxUSD can't be minted by us, so Frax funds the payout wallet)
    const available = await payout.available();
    if (available !== null && available < shortfall) {
      throw conflict("the testnet payout wallet is out of frxUSD; Frax tops it up", "payout_empty");
    }
    const once = `simulate-payout:${claim.id}`;
    if (!(await deps.db.claimOnce(once))) throw conflict("this claim already got its simulated payout", "already_paid");
    let txHash: string;
    try {
      txHash = await payout.pay(recipient, shortfall);
    } catch (error) {
      await deps.db.releaseOnce(once);
      throw error;
    }
    return json({ minted: shortfall, amountRemaining: onchain.amountRemaining, txHash, method: payout.kind });
  };
}
