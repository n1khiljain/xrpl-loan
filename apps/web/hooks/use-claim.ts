"use client";

import { type ClaimView, claimViewFromJson } from "@app/adapters";
import { useQuery } from "@tanstack/react-query";
import type { ClaimWithDocuments, OffchainClaim } from "@/lib/types";
import { useCall } from "./use-api";
import { useSession } from "@/lib/session/context";

/** The claim's money and dates, with amounts as bigints, or null while it's a draft. */
export function ledgerOf(claim: OffchainClaim): ClaimView | null {
  return claim.ledger ? claimViewFromJson(claim.ledger) : null;
}

export function useClaimRecord(id: string | null) {
  const session = useSession();
  const call = useCall();
  const offchain = useQuery({
    queryKey: ["claim", id],
    enabled: session.status === "signed-in" && Boolean(id),
    queryFn: () => call<ClaimWithDocuments>("claims", { query: { id: id as string } }),
    refetchInterval: 5_000,
  });
  return { offchain, onchain: offchain.data ? ledgerOf(offchain.data.claim) : null };
}
