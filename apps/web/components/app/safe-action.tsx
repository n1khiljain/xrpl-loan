"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, Send } from "lucide-react";
import { useState } from "react";
import type { Address } from "viem";
import { Button } from "@/components/ui/button";
import { type Call, useSendCalls } from "@/hooks/use-tx";
import { friendlyError } from "@/lib/errors";
import { type SafeTx, detectSafe, downloadJson, openInSafeUrl, proposeInSafe, transactionBuilderJson } from "@/lib/safe";
import { useSession } from "@/lib/session/context";
import { ErrorNotice, InfoNotice } from "./notice";

export function useSafeContext() {
  return useQuery({ queryKey: ["safe-context"], queryFn: () => detectSafe(), staleTime: Number.POSITIVE_INFINITY });
}

/**
 * Every admin action becomes a Safe transaction (FR-F7). Inside Frax's Safe UI it's proposed to the Safe's
 * signers. Outside, the page links to the Safe App and offers a Transaction Builder file. On local, a wallet
 * that holds the role itself can also send it directly.
 */
export function SafeAction({
  txs,
  name,
  description,
  safeAddress,
  directSender,
  disabled,
  onDone,
}: {
  txs: SafeTx[];
  name: string;
  description: string;
  /** The Safe that holds the role, from the network config. */
  safeAddress: Address | null;
  /** Set when the connected wallet holds the role itself (local deploys). */
  directSender?: boolean;
  disabled?: boolean;
  onDone?: () => void;
}) {
  const safe = useSafeContext();
  const session = useSession();
  const direct = useSendCalls();
  const [proposed, setProposed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function propose() {
    setError(null);
    try {
      setProposed(await proposeInSafe(txs));
      onDone?.();
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function sendDirect() {
    const calls: Call[] = txs.map((tx) => ({ to: tx.to, data: tx.data, value: tx.value }));
    if (await direct.send(calls, txs.map((t) => t.label))) onDone?.();
  }

  const openUrl = openInSafeUrl(safeAddress, typeof window === "undefined" ? "/admin/" : window.location.pathname);

  if (safe.data) {
    return (
      <div className="flex flex-col items-start gap-2.5" data-testid="safe-action" data-mode="safe">
        <Button onClick={() => void propose()} disabled={disabled || proposed !== null}>
          <Send /> {proposed ? "Proposed to the Safe" : "Propose in Safe"}
        </Button>
        {proposed ? <InfoNotice title="Waiting for the other signers">Safe transaction {proposed.slice(0, 10)}</InfoNotice> : null}
        {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2.5" data-testid="safe-action" data-mode="outside-safe">
      <div className="flex flex-wrap items-center gap-2.5">
        {openUrl ? (
          <Button asChild variant="outline" disabled={disabled}>
            <a href={openUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Open in Frax Safe
            </a>
          </Button>
        ) : null}
        {directSender && session.address ? (
          <Button onClick={() => void sendDirect()} disabled={disabled || direct.status === "sending"} data-testid="send-direct">
            <Send /> {direct.status === "sending" ? "Sending..." : "Send from this wallet"}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          disabled={disabled}
          data-testid="download-tx-builder"
          onClick={() =>
            downloadJson(`${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`, transactionBuilderJson(txs, { name, description, safeAddress: safeAddress ?? undefined }))
          }
        >
          <Download /> Transaction Builder JSON
        </Button>
      </div>
      {direct.error ? <ErrorNotice>{direct.error}</ErrorNotice> : null}
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
    </div>
  );
}
