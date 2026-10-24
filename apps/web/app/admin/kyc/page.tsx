"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { StatusText, kycTone } from "@/components/admin/status-text";
import { ErrorNotice, InfoNotice } from "@/components/app/notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCall } from "@/hooks/use-api";
import { accountUrl } from "@/lib/config";
import { friendlyError } from "@/lib/errors";
import { dateTime, shortAddress } from "@/lib/format";
import type { KycStatus, MeResponse } from "@/lib/types";

type Person = {
  wallet: string;
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
  kycStatus: KycStatus;
  kycUpdatedAt: string | null;
  createdAt: string;
};

function PersonRow({ person }: { person: Person }) {
  const call = useCall();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: (status: KycStatus) => call("kyc-manual", { method: "POST", body: { wallet: person.wallet, status, note: note.trim() } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kyc-people"] }),
  });
  return (
    <li className="flex flex-col gap-3 py-4" data-testid={`kyc-row-${person.wallet}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold">{person.displayName ?? "No name yet"}</span>
          <span className="text-muted-foreground text-xs">
            {person.email ?? "No email"} · {person.emailVerified ? "email verified" : "email not verified"}
          </span>
          <a href={accountUrl(person.wallet)} target="_blank" rel="noopener noreferrer" className="text-muted-foreground font-mono text-xs underline underline-offset-2">
            {shortAddress(person.wallet)}
          </a>
        </span>
        <StatusText tone={kycTone(person.kycStatus)}>{person.kycStatus.replace("_", " ")}</StatusText>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input aria-label="Note" placeholder="What you checked" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="sm:flex-1" />
        <Button size="sm" disabled={!note.trim() || !person.emailVerified || save.isPending} onClick={() => save.mutate("approved")} data-testid="kyc-approve">
          Approve
        </Button>
        <Button size="sm" variant="outline" disabled={!note.trim() || save.isPending} onClick={() => save.mutate("rejected")}>
          Reject
        </Button>
      </div>
      {save.isError ? <ErrorNotice>{friendlyError(save.error)}</ErrorNotice> : null}
    </li>
  );
}

/** KYC is a Privy-verified email plus a staff decision here. Every change is logged with who, when, and the note. */
function Kyc({ me }: { me: MeResponse }) {
  const call = useCall();
  const people = useQuery({
    queryKey: ["kyc-people"],
    enabled: me.staffRole === "underwriter" || me.staffRole === "admin",
    queryFn: () => call<{ people: Person[] }>("kyc-manual"),
  });
  if (me.staffRole !== "underwriter" && me.staffRole !== "admin") {
    return <ErrorNotice title="Underwriters only">Only underwriters and admins can set KYC status.</ErrorNotice>;
  }
  if (people.isPending) return <Skeleton className="h-48 w-full rounded-3xl" />;
  if (people.isError) return <ErrorNotice>{friendlyError(people.error)}</ErrorNotice>;
  const waiting = people.data.people.filter((p) => p.kycStatus === "pending" || p.kycStatus === "not_started");
  const decided = people.data.people.filter((p) => p.kycStatus === "approved" || p.kycStatus === "rejected");
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Waiting on a decision</CardTitle>
          <CardDescription>
            Approve someone once their email is verified and you&apos;ve checked who they are. Approval is what lets the app issue their XRPL credential.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {waiting.length === 0 ? <InfoNotice title="Nobody waiting" /> : null}
          <ul className="divide-divider flex flex-col divide-y">
            {waiting.map((p) => (
              <PersonRow key={p.wallet} person={p} />
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Decided</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-divider flex flex-col divide-y text-sm">
            {decided.map((p) => (
              <li key={p.wallet} className="flex items-center justify-between gap-3 py-2.5">
                <span>
                  {p.displayName ?? "No name"} <span className="text-muted-foreground">· {p.kycUpdatedAt ? dateTime(p.kycUpdatedAt) : ""}</span>
                </span>
                <StatusText tone={kycTone(p.kycStatus)}>{p.kycStatus}</StatusText>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

export default function KycPage() {
  return <AdminShell title="KYC status">{(me) => <Kyc me={me} />}</AdminShell>;
}
