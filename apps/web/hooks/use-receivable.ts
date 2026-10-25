"use client";

import { type ReceivableView, receivableViewFromJson } from "@app/adapters";
import { useQuery } from "@tanstack/react-query";
import type { ReceivableWithDocuments, OffchainReceivable } from "@/lib/types";
import { useCall } from "./use-api";
import { useSession } from "@/lib/session/context";

/** The receivable's money and dates, with amounts as bigints, or null while it's a draft. */
export function ledgerOf(receivable: OffchainReceivable): ReceivableView | null {
  return receivable.ledger ? receivableViewFromJson(receivable.ledger) : null;
}

export function useReceivableRecord(id: string | null) {
  const session = useSession();
  const call = useCall();
  const offchain = useQuery({
    queryKey: ["receivable", id],
    enabled: session.status === "signed-in" && Boolean(id),
    queryFn: () => call<ReceivableWithDocuments>("receivables", { query: { id: id as string } }),
    refetchInterval: 5_000,
  });
  return { offchain, onchain: offchain.data ? ledgerOf(offchain.data.receivable) : null };
}
