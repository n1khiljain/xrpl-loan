"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { StatusText } from "@/components/admin/status-text";
import { ErrorNotice, InfoNotice } from "@/components/app/notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useCall } from "@/hooks/use-api";
import { friendlyError } from "@/lib/errors";
import { shortAddress } from "@/lib/format";
import type { DirectoryOrg, MeResponse } from "@/lib/types";

type AdminOrg = DirectoryOrg & { active: boolean };

const isAddress = (value: string) => /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(value);

function useOrgAction() {
  const call = useCall();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => call("orgs", { method: "POST", body }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

function AddOfficer({ org }: { org: AdminOrg }) {
  const [wallet, setWallet] = useState("");
  const [title, setTitle] = useState("");
  const action = useOrgAction();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input aria-label="Approver wallet" placeholder="r... wallet address" className="font-mono sm:flex-1" value={wallet} onChange={(e) => setWallet(e.target.value.trim())} />
        <Input aria-label="Title" placeholder="Title (optional)" className="sm:w-48" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Button
          variant="secondary"
          disabled={!isAddress(wallet) || action.isPending}
          onClick={() => action.mutate({ action: "set-officer", orgId: org.id, wallet, title: title.trim() || null, active: true }, { onSuccess: () => setWallet("") })}
        >
          Add approver
        </Button>
      </div>
      {action.isError ? <ErrorNotice>{friendlyError(action.error)}</ErrorNotice> : null}
    </div>
  );
}

function OrgCard({ org }: { org: AdminOrg }) {
  const action = useOrgAction();
  return (
    <Card data-testid={`org-${org.id}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-3">
          {org.name}
          <StatusText tone={org.active ? "success" : "muted"}>{org.active ? "Active" : "Inactive"}</StatusText>
        </CardTitle>
        <Button variant="outline" size="sm" disabled={action.isPending} onClick={() => action.mutate({ action: "set-active", orgId: org.id, active: !org.active })}>
          {org.active ? "Deactivate" : "Activate"}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="divide-divider flex flex-col divide-y text-sm">
          {org.officers.length === 0 ? <li className="text-muted-foreground py-2">No approvers yet.</li> : null}
          {org.officers.map((o) => (
            <li key={o.wallet} className="flex items-center justify-between gap-3 py-2">
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">{o.displayName ?? "No name yet"}</span>
                <span className="text-muted-foreground font-mono text-xs">
                  {shortAddress(o.wallet)}
                  {o.title ? ` · ${o.title}` : ""}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={action.isPending}
                onClick={() => action.mutate({ action: "set-officer", orgId: org.id, wallet: o.wallet, title: o.title, active: false })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <AddOfficer org={org} />
        {action.isError ? <ErrorNotice>{friendlyError(action.error)}</ErrorNotice> : null}
      </CardContent>
    </Card>
  );
}

function Orgs({ me }: { me: MeResponse }) {
  const call = useCall();
  const [name, setName] = useState("");
  const create = useOrgAction();
  const orgs = useQuery({ queryKey: ["admin-orgs"], enabled: me.staffRole === "admin", queryFn: () => call<{ orgs: AdminOrg[] }>("orgs") });
  if (me.staffRole !== "admin") return <ErrorNotice title="Admins only">Only the admin role can manage businesses.</ErrorNotice>;
  if (orgs.isPending) return <Skeleton className="h-48 w-full rounded-3xl" />;
  if (orgs.isError) return <ErrorNotice>{friendlyError(orgs.error)}</ErrorNotice>;
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Card>
        <CardContent className="flex flex-col gap-2 pt-6">
          <Label htmlFor="org-name">New business</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="sm:flex-1" />
            <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate({ action: "create", name: name.trim() }, { onSuccess: () => setName("") })}>
              Add business
            </Button>
          </div>
          {create.isError ? <ErrorNotice>{friendlyError(create.error)}</ErrorNotice> : null}
        </CardContent>
      </Card>
      {orgs.data.orgs.length === 0 ? <InfoNotice title="No businesses yet" /> : null}
      {orgs.data.orgs.map((org) => (
        <OrgCard key={org.id} org={org} />
      ))}
    </div>
  );
}

export default function OrgsPage() {
  return <AdminShell title="Businesses and approvers">{(me) => <Orgs me={me} />}</AdminShell>;
}
