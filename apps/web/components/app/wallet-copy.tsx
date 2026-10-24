"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { accountUrl } from "@/lib/config";

/** The XRP Ledger wallet this app holds for the person, with a copy button and an explorer link. */
export function WalletCopy({ wallet, className }: { wallet: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={className}>
      <p className="text-muted-foreground pb-2 text-sm">Your XRP Ledger wallet. The app holds its keys and signs for you.</p>
      <div className="bg-surface-muted flex flex-col gap-3 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between">
        <code data-testid="wallet-address" className="font-mono min-w-0 flex-1 text-sm break-all">
          {wallet}
        </code>
        <div className="flex gap-2 self-start sm:self-auto">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(wallet);
              setCopied(true);
            }}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy"}
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href={accountUrl(wallet)} target="_blank" rel="noopener noreferrer">
              Explorer <ExternalLink className="size-4" />
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
