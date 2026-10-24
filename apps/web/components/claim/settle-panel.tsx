"use client";

import type { ClaimView } from "@app/adapters";
import { InfoNotice } from "@/components/app/notice";
import { ASSET } from "@/lib/config";
import { usd } from "@/lib/format";

/**
 * What's left to send back to the vault. Repayment is an XLS-66 loan payment on the XRP Ledger; until that's wired
 * up this shows the numbers only.
 */
export function SettlePanel({ onchain }: { onchain: ClaimView; label?: string }) {
  return (
    <div className="space-y-4" data-testid="settle-panel">
      <div className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
        <span className="text-muted-foreground">Left to pay back</span>
        <span className="text-right font-semibold">{usd(onchain.amountRemaining)}</span>
        <span className="text-muted-foreground">Paid back so far</span>
        <span className="text-right font-semibold">{usd(onchain.amountPaid)}</span>
      </div>
      <InfoNotice title="Payments aren't live yet">
        You&apos;ll pay {ASSET} back to the vault from here, with interest, once repayments on the XRP Ledger are switched on.
      </InfoNotice>
    </div>
  );
}
