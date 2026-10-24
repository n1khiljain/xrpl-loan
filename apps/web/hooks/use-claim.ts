"use client";

import { useQuery } from "@tanstack/react-query";
import type { ClaimView } from "@app/adapters";
import { chainReader } from "@/lib/chain";
import type { ClaimWithDocuments, OffchainClaim } from "@/lib/types";
import { useCall } from "./use-api";
import { useSession } from "@/lib/session/context";

/** Finds the onchain claim for a draft: by the linked ID, or by packetHash while chain-sync hasn't linked it yet. */
export async function findOnchain(claim: OffchainClaim): Promise<ClaimView | null> {
  const reader = chainReader();
  if (!reader) return null;
  if (claim.onchainClaimId !== null) return reader.getClaim(BigInt(claim.onchainClaimId));
  if (!claim.packetHash || !claim.guarantySigned) return null;
  const mine = await reader.listClaims({ recipient: claim.recipientWallet });
  return mine.find((c) => c.packetHash.toLowerCase() === claim.packetHash?.toLowerCase()) ?? null;
}

export function useClaimRecord(id: string | null) {
  const session = useSession();
  const call = useCall();
  const offchain = useQuery({
    queryKey: ["claim", id],
    enabled: session.status === "signed-in" && Boolean(id),
    queryFn: () => call<ClaimWithDocuments>("claims", { query: { id: id as string } }),
  });
  const onchain = useQuery({
    queryKey: ["onchain-claim", id, offchain.data?.claim.onchainClaimId, offchain.data?.claim.guarantySigned],
    enabled: Boolean(offchain.data),
    queryFn: () => findOnchain((offchain.data as ClaimWithDocuments).claim),
    refetchInterval: 5_000,
  });
  return { offchain, onchain: onchain.data ?? null, onchainLoading: onchain.isPending && Boolean(offchain.data) };
}
