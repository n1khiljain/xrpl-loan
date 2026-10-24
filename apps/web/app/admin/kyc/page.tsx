"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { isAddress } from "viem";
import { AdminShell } from "@/components/admin/admin-shell";
import { ErrorNotice, InfoNotice } from "@/components/app/notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCall } from "@/hooks/use-api";
import { friendlyError } from "@/lib/errors";
import type { KycStatus, MeResponse, PersonView } from "@/lib/types";

/** Manual KYC status until Frax's API exists; every change is logged with who and when (FR-B6, U-36). */
function ManualKyc({ me }: { me: MeResponse }) {
  const call = useCall();
  const [wallet, setWallet] = useState("");
  const [status, setStatus] = useState<KycStatus>("approved");
  const [note, setNote] = useState("");
  const valid = isAddress(wallet);
  const person = useQuery({
    queryKey: ["person", wallet.toLowerCase()],
    enabled: valid,
    queryFn: async () => (await call<{ people: PersonView[] }>("directory", { query: { view: "people", wallets: wallet } })).people[0],
  });
  const save = useMutation({ mutationFn: () => call("kyc-manual", { method: "POST", body: { wallet, status, note } }), onSuccess: () => person.refetch() });

  if (me.staffRole !== "underwriter") return <ErrorNotice title="Underwriters only">Only the underwriter role can set KYC status.</ErrorNotice>;
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Set a wallet&apos;s status</CardTitle>
        <CardDescription>Manual until Frax&apos;s API is live. People verify on net.frax.com, so confirm with Frax before marking anyone approved. Your wallet, the time, and your note are logged.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="space-y-2">
          <Label htmlFor="kyc-wallet">Wallet</Label>
          <Input id="kyc-wallet" className="font-mono" value={wallet} onChange={(e) => setWallet(e.target.value.trim())} />
        </div>
        {person.data ? (
          <p className="bg-surface-muted rounded-md px-3.5 py-2.5 text-sm" data-testid="kyc-current">
            {person.data.hasProfile ? `${person.data.displayName ?? "No name"}: ${person.data.kycStatus?.replace("_", " ")}` : "No profile for this wallet yet."}
          </p>
        ) : null}
        <div className="space-y-2">
          <Label>New status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as KycStatus)}>
            <SelectTrigger aria-label="New status" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="not_started">Not started</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="kyc-note">Note</Label>
          <Textarea id="kyc-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Confirmed with Frax ops by email on..." />
        </div>
        <Button onClick={() => save.mutate()} disabled={!valid || !note.trim() || save.isPending} data-testid="save-kyc" className="self-start">
          {save.isPending ? "Saving..." : "Save status"}
        </Button>
        {save.isSuccess ? <InfoNotice title="Saved" /> : null}
        {save.isError ? <ErrorNotice>{friendlyError(save.error)}</ErrorNotice> : null}
      </CardContent>
    </Card>
  );
}

export default function KycPage() {
  return <AdminShell title="KYC status">{(me) => <ManualKyc me={me} />}</AdminShell>;
}
