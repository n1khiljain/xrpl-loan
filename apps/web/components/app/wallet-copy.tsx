"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { getAddress } from "viem";
import { Button } from "@/components/ui/button";

/**
 * The wallet this app made for the member (Privy), to paste where FraxNet asks for one. Connecting adds it for them
 * when FraxNet allows it, so this is the fallback (U-63, U-78).
 */
export function WalletCopy({ wallet, className }: { wallet: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  // checksummed, the way wallets and FraxNet show it; profiles store it lowercase
  const address = getAddress(wallet);
  return (
    <div className={className}>
      <p className="text-muted-foreground pb-2 text-sm">If FraxNet asks you to add a wallet address, use this one. It&apos;s the wallet this app made for you.</p>
      <div className="bg-surface-muted flex flex-col gap-3 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between">
        <code data-testid="wallet-address" className="font-mono min-w-0 flex-1 text-sm break-all">
          {address}
        </code>
        <Button
          variant="secondary"
          size="sm"
          className="self-start sm:self-auto"
          onClick={() => {
            void navigator.clipboard?.writeText(address);
            setCopied(true);
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
