import type { ChainReader } from "@app/adapters";
import type { Db } from "../_shared/db/types.ts";
import { usd } from "../_shared/emails.ts";
import { type Handler, badRequest, json, methodNotAllowed, notFound } from "../_shared/http.ts";

export type NftMetadataDeps = { chain: ChainReader; db: Db };

const STATE_LABELS: Record<string, string> = {
  Submitted: "Submitted",
  Approved: "Approved",
  Funded: "Purchased",
  GuarantorCalled: "Guarantor called",
  Settled: "Settled",
  Recovered: "Recovered",
  WrittenOff: "Written off",
  Rejected: "Rejected",
  Cancelled: "Cancelled",
};

/**
 * Public ERC-721 metadata for `ClaimNFT` at `/nft-metadata/{claimId}`: state, org name, amounts, and dates, read
 * from the chain. No names, emails, wallets, receipts, or CalLink numbers (FR-B8). No Privy token, since wallets
 * and explorers fetch it (U-49).
 */
export function createNftMetadataHandler(deps: NftMetadataDeps): Handler {
  // UNCERTAIN: U-49 (public, no Privy token)
  return async (req) => {
    if (req.method !== "GET") throw methodNotAllowed(["GET"]);
    const last = new URL(req.url).pathname.split("/").filter(Boolean).at(-1) ?? "";
    if (!/^[1-9][0-9]{0,18}$/.test(last)) throw badRequest("use /nft-metadata/{claimId}");
    const claim = await deps.chain.getClaim(BigInt(last));
    if (claim.state === "None") throw notFound("no such claim");
    const org = await deps.db.getOrg(Number(claim.orgId));

    const attributes: Array<Record<string, string | number>> = [
      { trait_type: "State", value: STATE_LABELS[claim.state] ?? claim.state },
      { trait_type: "Org", value: org?.name ?? `Org ${claim.orgId}` },
      { trait_type: "Face value", value: usd(claim.faceValue) },
    ];
    if (claim.purchasedAt > 0) {
      attributes.push(
        { trait_type: "Purchase price", value: usd(claim.purchasePrice) },
        // paid plus what's owed now: the stored amountDue only includes fee accrued to the last payment (U-84)
        { trait_type: "Amount due", value: usd(claim.amountPaid + claim.amountRemaining) },
        { trait_type: "Amount paid", value: usd(claim.amountPaid) },
        { display_type: "date", trait_type: "Purchased", value: claim.purchasedAt },
        { display_type: "date", trait_type: "Due", value: claim.dueAt },
      );
    }
    return json(
      {
        name: `College claim #${last}`,
        description:
          "An ASUC reimbursement claim sold to the B@B x Frax college pool on Fraxtal. Settled in frxUSD when ASUC pays.",
        attributes,
      },
      { headers: { "cache-control": "public, max-age=60" } },
    );
  };
}
