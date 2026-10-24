"use client";

import type { ClaimView } from "@app/adapters";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ErrorNotice, InfoNotice } from "@/components/app/notice";
import { Button } from "@/components/ui/button";
import { useCall } from "@/hooks/use-api";
import { ASSET } from "@/lib/config";
import { friendlyError } from "@/lib/errors";
import { usd } from "@/lib/format";

/**
 * What's left to send back to the vault. The borrower pays the XRPL loan from the wallet that received it.
 * An approver sees the same numbers; the payment itself has to come from the borrower.
 */
export function SettlePanel({
  claimId,
  onchain,
  who,
  live,
}: {
  claimId: string;
  onchain: ClaimView;
  who: "borrower" | "approver";
  live: boolean;
}) {
  const call = useCall();
  const queryClient = useQueryClient();
  const pay = useMutation({
    mutationFn: () => call("loans", { method: "POST", body: { action: "pay", claimId } }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const remaining = onchain.amountRemaining;
  return (
    <div className="space-y-4" data-testid="settle-panel">
      <div className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
        <span className="text-muted-foreground">Left to pay back</span>
        <span className="text-right font-semibold">{usd(remaining)}</span>
        <span className="text-muted-foreground">Paid back so far</span>
        <span className="text-right font-semibold">{usd(onchain.amountPaid)}</span>
      </div>
      {who === "borrower" && live && remaining > 0n ? (
        <div className="flex flex-col gap-3">
          <Button size="lg" className="self-start" disabled={pay.isPending} onClick={() => pay.mutate()} data-testid="pay-loan">
            {pay.isPending ? "Sending the payment..." : `Pay ${usd(remaining)} back`}
          </Button>
          {pay.isError ? <ErrorNotice>{friendlyError(pay.error)}</ErrorNotice> : null}
        </div>
      ) : null}
      {who === "borrower" && !live ? (
        <InfoNotice title="Payments aren't live yet">
          You&apos;ll pay {ASSET} back to the vault from here, with interest, once repayments on the XRP Ledger are switched on.
        </InfoNotice>
      ) : null}
      {who === "approver" ? (
        <p className="text-muted-foreground text-sm">The borrower pays this back from the account that received the loan.</p>
      ) : null}
    </div>
  );
}
