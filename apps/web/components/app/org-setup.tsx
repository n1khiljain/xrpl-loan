"use client";

import { formatJoinCode } from "@app/adapters";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCall } from "@/hooks/use-api";
import { friendlyError } from "@/lib/errors";
import type { Membership } from "@/lib/types";
import { ErrorNotice } from "./notice";

type LookedUp = { name: string; joinCode: string };

/** Finance agent, or a title they type. One of the two. */
function RoleField({
  financeAgent,
  roleTitle,
  onFinanceAgent,
  onRoleTitle,
}: {
  financeAgent: boolean;
  roleTitle: string;
  onFinanceAgent: (next: boolean) => void;
  onRoleTitle: (next: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-[13px] font-semibold">Your role</legend>
      <label className="border-border has-[:checked]:border-foreground flex cursor-pointer items-start gap-3 rounded-lg border bg-surface p-3">
        <input
          type="checkbox"
          className="mt-0.5 size-4"
          checked={financeAgent}
          data-testid="org-finance-agent"
          onChange={(e) => {
            onFinanceAgent(e.target.checked);
            if (e.target.checked) onRoleTitle("");
          }}
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Finance agent</span>
          <span className="text-muted-foreground text-xs">Reviews expedited payments before an admin does.</span>
        </span>
      </label>
      {financeAgent ? null : (
        <div className="space-y-2">
          <Label htmlFor="org-role" className="text-[13px] font-semibold">
            Role
          </Label>
          <Input id="org-role" data-testid="org-role" value={roleTitle} onChange={(e) => onRoleTitle(e.target.value)} maxLength={80} placeholder="Founder, bookkeeper, operations" />
        </div>
      )}
    </fieldset>
  );
}

function Banking({ noted, onAdd }: { noted: boolean; onAdd: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold">Banking details</span>
      <Button type="button" variant="outline" className="self-start" data-testid="org-add-banking" onClick={onAdd}>
        Add banking details
      </Button>
      {noted ? <p className="text-muted-foreground text-sm">You can add banking details later.</p> : null}
    </div>
  );
}

function OrgId({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const shown = formatJoinCode(code);
  return (
    <div className="bg-surface-muted flex items-center justify-between gap-3 rounded-xl p-3">
      <code data-testid="org-id" className="font-mono text-sm tracking-wide">
        {shown}
      </code>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          void navigator.clipboard?.writeText(shown);
          setCopied(true);
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function Ready({ membership }: { membership: Membership }) {
  const queryClient = useQueryClient();
  return (
    <div className="bg-card mx-auto flex w-full max-w-xl flex-col gap-5 rounded-3xl p-5 sm:p-7" data-testid="org-ready">
      <div className="space-y-2">
        <span className="text-muted-foreground text-xs font-medium">{membership.name}</span>
        <h2 className="display-type text-3xl">You&apos;re in</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">Share this organization ID so other people can join. It fills in the organization for them.</p>
      </div>
      <OrgId code={membership.joinCode} />
      <p className="text-muted-foreground text-sm">Your role: {membership.financeAgent ? "Finance agent" : membership.roleTitle}</p>
      <Button type="button" size="lg" className="w-full sm:w-auto sm:self-start" onClick={() => void queryClient.invalidateQueries({ queryKey: ["me"] })}>
        Continue
      </Button>
    </div>
  );
}

function Choose({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return (
    <div className="bg-card mx-auto flex w-full max-w-xl flex-col gap-5 rounded-3xl p-5 sm:p-7" data-testid="org-setup">
      <div className="space-y-2">
        <span className="text-muted-foreground text-xs font-medium">Your organization</span>
        <h2 className="display-type text-3xl">Create one, or join one</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Expedited payments go to a finance agent at your organization first, then to an admin. A teammate can give you an organization ID to join theirs.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <Button type="button" size="lg" data-testid="org-choice-create" onClick={onCreate}>
          Create an organization
        </Button>
        <Button type="button" size="lg" variant="outline" data-testid="org-choice-join" onClick={onJoin}>
          Join an organization
        </Button>
      </div>
    </div>
  );
}

function CreateForm({ onBack, onDone }: { onBack: () => void; onDone: (membership: Membership) => void }) {
  const call = useCall();
  const [name, setName] = useState("");
  const [financeAgent, setFinanceAgent] = useState(false);
  const [roleTitle, setRoleTitle] = useState("");
  const [bankingNoted, setBankingNoted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const roleReady = financeAgent || roleTitle.trim().length > 0;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await call<{ membership: Membership }>("membership", {
        method: "POST",
        body: { action: "create", name: name.trim(), financeAgent, roleTitle: financeAgent ? null : roleTitle.trim() },
      });
      onDone(res.membership);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="bg-card mx-auto flex w-full max-w-xl flex-col gap-5 rounded-3xl p-5 sm:p-7"
      data-testid="org-create"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <div className="space-y-2">
        <span className="text-muted-foreground text-xs font-medium">New organization</span>
        <h2 className="display-type text-3xl">Name it, and your role</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">We&apos;ll make an organization ID other people can use to join.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="org-name" className="text-[13px] font-semibold">
          Organization name
        </Label>
        <Input id="org-name" data-testid="org-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus required />
      </div>
      <Banking noted={bankingNoted} onAdd={() => setBankingNoted(true)} />
      <RoleField financeAgent={financeAgent} roleTitle={roleTitle} onFinanceAgent={setFinanceAgent} onRoleTitle={setRoleTitle} />
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        <Button type="button" variant="secondary" size="lg" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button type="submit" size="lg" disabled={busy || !name.trim() || !roleReady} data-testid="org-create-submit">
          {busy ? "Creating..." : "Create organization"}
        </Button>
      </div>
    </form>
  );
}

function JoinForm({ onBack, onDone }: { onBack: () => void; onDone: (membership: Membership) => void }) {
  const call = useCall();
  const [code, setCode] = useState("");
  const [org, setOrg] = useState<LookedUp | null>(null);
  const [financeAgent, setFinanceAgent] = useState(false);
  const [roleTitle, setRoleTitle] = useState("");
  const [bankingNoted, setBankingNoted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"lookup" | "join" | null>(null);
  const roleReady = financeAgent || roleTitle.trim().length > 0;

  async function lookup() {
    setBusy("lookup");
    setError(null);
    setOrg(null);
    try {
      const res = await call<{ org: LookedUp }>("membership", { method: "POST", body: { action: "lookup", joinCode: code.trim() } });
      setOrg(res.org);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  async function join() {
    if (!org) return;
    setBusy("join");
    setError(null);
    try {
      const res = await call<{ membership: Membership }>("membership", {
        method: "POST",
        body: { action: "join", joinCode: org.joinCode, financeAgent, roleTitle: financeAgent ? null : roleTitle.trim() },
      });
      onDone(res.membership);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <form
      className="bg-card mx-auto flex w-full max-w-xl flex-col gap-5 rounded-3xl p-5 sm:p-7"
      data-testid="org-join"
      onSubmit={(e) => {
        e.preventDefault();
        if (org) void join();
        else void lookup();
      }}
    >
      <div className="space-y-2">
        <span className="text-muted-foreground text-xs font-medium">Join an organization</span>
        <h2 className="display-type text-3xl">Enter the organization ID</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">The ID fills in the organization. Then add your role.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="org-join-code" className="text-[13px] font-semibold">
          Organization ID
        </Label>
        <Input
          id="org-join-code"
          data-testid="org-join-code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setOrg(null);
          }}
          autoFocus
          autoCapitalize="characters"
          placeholder="ABCD-EFGH"
          className="font-mono tracking-wide"
        />
      </div>
      {org ? (
        <div className="border-border flex flex-col gap-4 rounded-xl border p-4" data-testid="org-looked-up">
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-xs">Organization</span>
            <span className="text-sm font-semibold">{org.name}</span>
          </div>
          <OrgId code={org.joinCode} />
          <Banking noted={bankingNoted} onAdd={() => setBankingNoted(true)} />
          <RoleField financeAgent={financeAgent} roleTitle={roleTitle} onFinanceAgent={setFinanceAgent} onRoleTitle={setRoleTitle} />
        </div>
      ) : null}
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        <Button type="button" variant="secondary" size="lg" onClick={onBack} disabled={busy !== null}>
          Back
        </Button>
        {org ? (
          <Button type="submit" size="lg" disabled={busy !== null || !roleReady} data-testid="org-join-submit">
            {busy === "join" ? "Joining..." : `Join ${org.name}`}
          </Button>
        ) : (
          <Button type="submit" size="lg" variant="outline" disabled={busy !== null || !code.trim()} data-testid="org-lookup">
            {busy === "lookup" ? "Looking up..." : "Look up"}
          </Button>
        )}
      </div>
    </form>
  );
}

/** After a profile exists: create an organization or join one with its id. */
export function OrgSetup() {
  const [path, setPath] = useState<"choose" | "create" | "join">("choose");
  const [done, setDone] = useState<Membership | null>(null);
  if (done) return <Ready membership={done} />;
  if (path === "create") return <CreateForm onBack={() => setPath("choose")} onDone={setDone} />;
  if (path === "join") return <JoinForm onBack={() => setPath("choose")} onDone={setDone} />;
  return <Choose onCreate={() => setPath("create")} onJoin={() => setPath("join")} />;
}
