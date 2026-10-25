"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileText, ShieldCheck, Upload } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useState } from "react";
import { AccountGate } from "@/components/app/account-gate";
import { initials } from "@/components/app/avatar";
import { CtaLabel } from "@/components/app/cta";
import { MoneyField } from "@/components/app/money-field";
import { ErrorNotice } from "@/components/app/notice";
import { Stepper } from "@/components/app/stepper";
import { Topbar } from "@/components/app/topbar";
import { VerifyFirst } from "@/components/app/verify-first";
import { ReceivableCard } from "@/components/brand/receivable-card";
import { EASE } from "@/components/motion";
import { WizardAside } from "@/components/receivable/wizard-aside";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useCall, useOrgs } from "@/hooks/use-api";
import { uploadToSignedUrl } from "@/lib/api";
import { params } from "@/lib/config";
import { friendlyError } from "@/lib/errors";
import { amountDue, parseUsd, unitsToInput, usd } from "@/lib/format";
import { RECEIVABLE_TYPES, TYPE_ORDER } from "@/lib/receivable-types";
import type { DocumentView, InviteCreated, MeResponse, PacketResponse, ReceivableType, ReceivableWithDocuments } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Once a draft is saved, it waits in this list with "Finish". */
const BACK = { href: "/receivables/?view=receivables", label: "My loans" };

const DOCUMENT_TYPES = "application/pdf,image/png,image/jpeg,image/heic,image/webp";
const DAY_MS = 86_400_000;

function maxRequest(face: bigint): bigint {
  const byRate = (face * params.advanceRateBps) / 10_000n;
  return byRate < params.perReceivableCap ? byRate : params.perReceivableCap;
}

/** YYYY-MM-DD for a date `days` from today, in local time, for the date input's bounds. */
function isoDay(days: number): string {
  const d = new Date(Date.now() + days * DAY_MS);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Seconds from now until the end of a YYYY-MM-DD day, so the fee preview covers the whole term. */
function secondsUntil(day: string): number {
  const end = Date.parse(`${day}T23:59:59`);
  return Number.isNaN(end) ? params.overdueWindowSeconds : Math.max(0, Math.round((end - Date.now()) / 1000));
}

const MAX_TERM_DAYS = Math.floor(params.overdueWindowSeconds / 86_400);

/** Loads a draft named by ?id= (to resume it), then renders the form seeded from it. */
function Wizard({ me }: { me: MeResponse }) {
  const call = useCall();
  const router = useRouter();
  const id = useSearchParams().get("id");
  const draft = useQuery({
    queryKey: ["receivable", id],
    enabled: Boolean(id),
    queryFn: () => call<ReceivableWithDocuments>("receivables", { query: { id: id as string } }),
  });
  const frozen = Boolean(draft.data?.receivable.packetHash);
  useEffect(() => {
    if (frozen && id) router.replace(`/receivable/?id=${id}`);
  }, [frozen, id, router]);
  if (id && (draft.isPending || frozen)) {
    return (
      <div>
        <Topbar title="Expedite a payment" crumb="Loading your draft" action={null} back={BACK} />
        <Skeleton className="h-64 w-full rounded-3xl" />
      </div>
    );
  }
  if (draft.isError) {
    return (
      <div>
        <Topbar title="Expedite a payment" action={null} back={BACK} />
        <ErrorNotice>{friendlyError(draft.error)}</ErrorNotice>
      </div>
    );
  }
  return <WizardForm key={id ?? "new"} me={me} initial={draft.data ?? null} />;
}

function WizardForm({ me, initial }: { me: MeResponse; initial: ReceivableWithDocuments | null }) {
  const call = useCall();
  const router = useRouter();
  const queryClient = useQueryClient();
  const orgs = useOrgs();
  const seed = initial?.receivable;
  const [receivableId, setReceivableId] = useState<string | null>(seed?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [type, setType] = useState<ReceivableType>(seed?.type ?? "invoice");
  const [payerName, setPayerName] = useState(seed?.payerName ?? "");
  const [payerEmail, setPayerEmail] = useState(seed?.payerEmail ?? "");
  const [payerWallet, setPayerWallet] = useState(seed?.payerWallet ?? "");
  const [dueDate, setDueDate] = useState(seed?.dueDate ?? isoDay(30));
  const [face, setFace] = useState(() => (seed ? unitsToInput(BigInt(seed.faceValue)) : ""));
  const [requested, setRequested] = useState(() => (seed ? unitsToInput(BigInt(seed.requestedAmount)) : ""));
  const [reference, setReference] = useState(seed?.reference ?? "");
  const [description, setDescription] = useState(seed?.description ?? "");
  // a business's loan can be backed by one of its approvers; a personal one goes without
  const [orgId, setOrgId] = useState<number | null>(seed?.orgId ?? null);
  const [guarantor, setGuarantor] = useState<string | null>(seed?.guarantorWallet ?? null);
  // a resumed draft that asked for less than the most keeps its field open
  const [takeLess, setTakeLess] = useState(() => Boolean(seed && BigInt(seed.requestedAmount) < maxRequest(BigInt(seed.faceValue))));

  const draft = useQuery({
    queryKey: ["receivable", receivableId],
    enabled: Boolean(receivableId),
    initialData: initial ?? undefined,
    queryFn: () => call<ReceivableWithDocuments>("receivables", { query: { id: receivableId as string } }),
  });

  const kind = RECEIVABLE_TYPES[type];
  const orgList = orgs.data ?? [];
  const org = orgList.find((o) => o.id === orgId) ?? null;
  const withOfficer = org !== null;
  const steps = withOfficer ? (["Details", "Documents", "Sign-off", "Review"] as const) : (["Details", "Documents", "Review"] as const);
  const [step, setStep] = useState(() => {
    if (!initial) return 0;
    if (!initial.documents.some((d) => d.sha256)) return 1;
    return initial.receivable.orgId !== null && !initial.receivable.guarantorWallet ? 2 : initial.receivable.orgId !== null ? 3 : 2;
  });
  const stepName = steps[step] ?? "Details";

  const faceUnits = parseUsd(face);
  const requestedUnits = parseUsd(requested) ?? 0n;
  const officers = (org?.officers ?? []).filter((o) => o.wallet !== me.profile?.wallet);
  const documents: DocumentView[] = draft.data?.documents ?? [];
  const validWallet = payerWallet.trim() === "" || /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(payerWallet.trim());

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const saveDetails = () =>
    run(async () => {
      if (!faceUnits || !requestedUnits || faceUnits === 0n || requestedUnits === 0n) throw new Error("Enter both amounts in dollars.");
      if (requestedUnits > maxRequest(faceUnits)) throw new Error(`You can ask for up to ${usd(maxRequest(faceUnits))}.`);
      if (!validWallet) throw new Error("That payer wallet isn't an XRP Ledger address. Leave it empty if you don't know it.");
      const fields = {
        type,
        payerName: payerName.trim(),
        payerEmail: payerEmail.trim() || null,
        payerWallet: payerWallet.trim() || null,
        dueDate,
        faceValue: faceUnits.toString(),
        requestedAmount: requestedUnits.toString(),
        reference: reference.trim(),
        description: description.trim() || null,
      };
      if (receivableId) {
        await call("receivables", { method: "PATCH", body: { id: receivableId, ...fields } });
      } else {
        const created = await call<ReceivableWithDocuments>("receivables", { method: "POST", body: { ...fields, orgId } });
        queryClient.setQueryData(["receivable", created.receivable.id], created);
        setReceivableId(created.receivable.id);
        // keep the URL resumable without remounting the form
        window.history.replaceState(null, "", `/receivables/new/?id=${created.receivable.id}`);
      }
      await queryClient.invalidateQueries({ queryKey: ["receivable"] });
      setStep(1);
    });

  const upload = (files: FileList | null) =>
    run(async () => {
      if (!receivableId || !files) return;
      for (const file of Array.from(files)) {
        const created = await call<{ document: DocumentView; upload: { path: string; token: string } }>("documents", {
          method: "POST",
          body: { action: "create", receivableId, mimeType: file.type, sizeBytes: file.size },
        });
        await uploadToSignedUrl(created.upload.path, created.upload.token, file);
        await call("documents", { method: "POST", body: { action: "confirm", documentId: created.document.id } });
      }
      await queryClient.invalidateQueries({ queryKey: ["receivable", receivableId] });
    });

  const saveGuarantor = () =>
    run(async () => {
      if (!receivableId || !guarantor) return;
      await call("receivables", { method: "PATCH", body: { id: receivableId, guarantorWallet: guarantor } });
      await queryClient.invalidateQueries({ queryKey: ["receivable", receivableId] });
      setStep(3);
    });

  /** Freezes the request; with an approver it goes to them to sign off, otherwise straight to review. */
  const finish = () =>
    run(async () => {
      if (!receivableId) return;
      await call<PacketResponse>("packet", { method: "POST", body: { receivableId } });
      if (withOfficer) await call<InviteCreated>("guarantor-invite", { method: "POST", body: { receivableId } });
      else await call("receivable-actions", { method: "POST", body: { action: "submit", receivableId } });
      await queryClient.invalidateQueries();
      router.push(`/receivable/?id=${receivableId}`);
    });

  const termSeconds = secondsUntil(dueDate);
  const due = requestedUnits ? amountDue(requestedUnits, params.feeBps, termSeconds) : 0n;
  const fee = due - requestedUnits;
  const guarantorName = officers.find((o) => o.wallet === guarantor)?.displayName ?? "your approver";
  const financeFirst = Boolean(me.membership?.active && me.membership.peerFinanceAgents > 0);
  const cardLabel = payerName.trim() || kind.payerLabel;
  const previewState = stepName.toUpperCase();

  const reviewMoney: Array<[string, string]> = [
    ["Amount of the payment", usd(faceUnits)],
    ["Interest, at most, if paid back by the due date", usd(fee)],
    ["You pay back, at most", usd(due)],
    ["Due", new Date(`${dueDate}T12:00:00`).toLocaleDateString("en-US", { dateStyle: "medium" })],
  ];
  const reviewDetails: Array<[string, string]> = [
    ["Kind of payment", kind.label],
    [kind.payerLabel, payerName.trim() || "Not entered"],
    [kind.referenceLabel, reference.trim() || "Not entered"],
    ["What it's for", description.trim() || "Not entered"],
    ...(org ? ([["Business", org.name], ["Approver signing off", guarantorName]] as Array<[string, string]>) : []),
    ["Documents", `${documents.length} ${documents.length === 1 ? "file" : "files"}`],
  ];

  return (
    <div>
      <Topbar title="Expedite a payment" crumb={`Step ${step + 1} of ${steps.length} · ${stepName}`} action={null} back={BACK} />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <Card className="min-w-0 lg:flex-1 lg:py-10">
          {/* room to breathe: sections sit well apart, and each label has air above its field */}
          <CardContent className="flex flex-col gap-10 sm:px-8 lg:px-10">
            <Stepper steps={steps} current={step} />
            <motion.div key={step} className="flex flex-col gap-10" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
              {stepName === "Details" ? (
                <>
                  <div className="space-y-3">
                    <h2 className="display-type text-2xl">Which payment do you want to expedite?</h2>
                    <p className="text-muted-foreground text-sm">Get an upfront loan instead of waiting. You pay it back with interest based on how long it runs.</p>
                  </div>

                  <div className="space-y-4">
                    <p className="text-sm font-semibold">What kind of payment is it?</p>
                    <RadioGroup
                      value={type}
                      onValueChange={(v) => {
                        setType(v as ReceivableType);
                      }}
                      aria-label="Kind of payment"
                      disabled={Boolean(receivableId)}
                      className="grid gap-3 sm:grid-cols-2"
                      data-testid="receivable-type"
                    >
                      {TYPE_ORDER.map((t) => (
                        <Label
                          key={t}
                          htmlFor={`type-${t}`}
                          className="has-data-[state=checked]:border-foreground has-data-[state=checked]:border-[1.5px] border-border has-data-[disabled]:opacity-60 bg-surface flex cursor-pointer flex-col items-start gap-1 rounded-lg border px-5 py-4"
                        >
                          <RadioGroupItem value={t} id={`type-${t}`} className="sr-only" />
                          <span className="text-sm font-semibold">{RECEIVABLE_TYPES[t].label}</span>
                          <span className="text-muted-foreground text-xs font-normal">{RECEIVABLE_TYPES[t].hint}</span>
                        </Label>
                      ))}
                    </RadioGroup>
                    {receivableId ? <p className="text-muted-foreground text-xs">The kind can&apos;t change once you&apos;ve started.</p> : null}
                  </div>

                  {/* a business can have one of its approvers vouch for the loan; only offered when there is one */}
                  {orgList.length > 0 ? (
                    <div className="space-y-4">
                      <p className="text-sm font-semibold">Is this for a business?</p>
                      <RadioGroup
                        value={orgId ? String(orgId) : "none"}
                        onValueChange={(v) => setOrgId(v === "none" ? null : Number(v))}
                        aria-label="Business"
                        disabled={Boolean(receivableId)}
                        className="flex flex-wrap gap-3"
                      >
                        {[{ id: "none", name: "No, just me" }, ...orgList.map((o) => ({ id: String(o.id), name: o.name }))].map((o) => (
                          <Label
                            key={o.id}
                            htmlFor={`org-${o.id}`}
                            className="has-data-[state=checked]:border-foreground has-data-[state=checked]:border-[1.5px] border-border has-data-[disabled]:opacity-60 bg-surface flex cursor-pointer items-center gap-3 rounded-full border py-2 pr-5 pl-2.5"
                          >
                            <RadioGroupItem value={o.id} id={`org-${o.id}`} className="sr-only" />
                            <span aria-hidden className="bg-surface-muted flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">
                              {o.id === "none" ? "—" : initials(o.name)}
                            </span>
                            <span className="text-sm font-semibold">{o.name}</span>
                          </Label>
                        ))}
                      </RadioGroup>
                      <p className="text-muted-foreground pt-1 text-sm">
                        An approver at the business signs off and covers what&apos;s left if the payment never arrives.
                        {financeFirst ? " Your finance agents review it next, then Install." : ""}
                      </p>
                    </div>
                  ) : null}

                  <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2">
                    <div className="space-y-3">
                      <Label htmlFor="payer" className="text-sm font-semibold">
                        {kind.payerLabel}
                      </Label>
                      <Input id="payer" value={payerName} onChange={(e) => setPayerName(e.target.value)} maxLength={120} placeholder={kind.payerPlaceholder} />
                    </div>
                    <div className="space-y-3">
                      <Label htmlFor="reference" className="text-sm font-semibold">
                        {kind.referenceLabel}
                      </Label>
                      <Input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={64} placeholder={kind.referencePlaceholder} />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <MoneyField
                      id="face"
                      label="Amount of the payment"
                      value={face}
                      onChange={(v) => {
                        setFace(v);
                        const f = parseUsd(v);
                        if (f) setRequested(unitsToInput(maxRequest(f)));
                      }}
                      placeholder="2400.00"
                    />
                    {/* most people take the most they can, so the second amount stays a line until you ask for less */}
                    {takeLess ? (
                      <div className="space-y-3 pt-4">
                        <Label htmlFor="requested" className="text-sm font-semibold">
                          How much you want now ($)
                        </Label>
                        <Input id="requested" inputMode="decimal" value={requested} onChange={(e) => setRequested(e.target.value)} className="sm:max-w-[240px]" />
                        <p className="text-muted-foreground text-xs">Up to {faceUnits ? usd(maxRequest(faceUnits)) : usd(params.perReceivableCap)}</p>
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-sm" data-testid="get-now">
                        {faceUnits ? (
                          <>
                            You get <span className="text-foreground font-semibold">{usd(requestedUnits)}</span> now.{" "}
                          </>
                        ) : (
                          `Up to ${usd(params.perReceivableCap)} per loan. `
                        )}
                        {faceUnits ? (
                          <button type="button" className="text-foreground font-medium underline underline-offset-4" onClick={() => setTakeLess(true)}>
                            Take less
                          </button>
                        ) : null}
                      </p>
                    )}
                  </div>

                  <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2">
                    <div className="space-y-3">
                      <Label htmlFor="due" className="text-sm font-semibold">
                        When the payment arrives
                      </Label>
                      <Input id="due" type="date" value={dueDate} min={isoDay(1)} max={isoDay(MAX_TERM_DAYS)} onChange={(e) => setDueDate(e.target.value)} />
                      <p className="text-muted-foreground text-xs">Your loan runs to this date, at most {MAX_TERM_DAYS} days out.</p>
                    </div>
                    <div className="space-y-3">
                      <Label htmlFor="description" className="text-sm font-semibold">
                        What it&apos;s for
                      </Label>
                      <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} placeholder="Vendor payment" />
                    </div>
                  </div>

                  <details className="group">
                    <summary className="text-muted-foreground cursor-pointer text-sm font-medium">Payer contact (optional)</summary>
                    <div className="grid gap-x-6 gap-y-8 pt-4 sm:grid-cols-2">
                      <div className="space-y-3">
                        <Label htmlFor="payer-email" className="text-sm font-semibold">
                          Payer email
                        </Label>
                        <Input id="payer-email" type="email" value={payerEmail} onChange={(e) => setPayerEmail(e.target.value)} />
                      </div>
                      <div className="space-y-3">
                        <Label htmlFor="payer-wallet" className="text-sm font-semibold">
                          Payer&apos;s XRP Ledger address
                        </Label>
                        <Input id="payer-wallet" className={cn("font-mono", !validWallet && "border-danger")} value={payerWallet} onChange={(e) => setPayerWallet(e.target.value.trim())} placeholder="r..." />
                        <p className="text-muted-foreground text-xs">If they pay on the ledger, we can check their payment history.</p>
                      </div>
                    </div>
                  </details>

                  {/* stacked on phones, primary on top, so a long label never pushes past 375px */}
                  <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                    <Button asChild variant="secondary" size="lg" className="w-full sm:w-auto">
                      <Link href="/receivables/">Cancel</Link>
                    </Button>
                    <Button
                      size="lg"
                      className="w-full pr-2 sm:w-auto"
                      onClick={() => void saveDetails()}
                      disabled={busy || !payerName.trim() || !face || !requested || !reference.trim() || !dueDate}
                      data-testid="save-details"
                    >
                      {busy ? "Saving..." : <CtaLabel>Continue to documents</CtaLabel>}
                    </Button>
                  </div>
                </>
              ) : null}

              {stepName === "Documents" ? (
                <>
                  <div className="space-y-3">
                    <h2 className="display-type text-2xl">Add the {type === "invoice" ? "invoice" : type === "card_settlement" ? "settlement report" : "receipts"}</h2>
                    <p className="text-muted-foreground text-sm">Upload invoices, receipts, or reports that show the payment is coming, up to 10 MB each.</p>
                  </div>
                  <Label
                    htmlFor="documents"
                    className="border-border hover:border-foreground bg-surface-muted/60 relative flex h-[180px] cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border-[1.5px] border-dashed text-center"
                  >
                    <Upload aria-hidden className="size-6" strokeWidth={1.8} />
                    <span className="text-sm font-semibold">{busy ? "Uploading..." : "Drop files here or choose files"}</span>
                    <span className="text-muted-foreground text-xs">PDF, JPG or PNG up to 10 MB each</span>
                    <input id="documents" type="file" multiple accept={DOCUMENT_TYPES} className="sr-only" onChange={(e) => void upload(e.target.files)} disabled={busy} />
                  </Label>
                  <ul className="flex flex-col" data-testid="receipt-list">
                    {documents.map((d, i) => (
                      <li key={d.id} className="border-divider flex items-center gap-3 border-b py-3 last:border-0">
                        <FileText aria-hidden className="text-muted-foreground size-[18px] shrink-0" />
                        <span className="flex-1 text-sm font-semibold">
                          Document {i + 1} {d.sha256 ? "uploaded" : "still uploading"}
                        </span>
                        {d.sha256 ? <Check aria-label="Uploaded" className="text-success size-4 shrink-0" strokeWidth={2.5} /> : null}
                      </li>
                    ))}
                  </ul>
                  <div className="bg-surface-muted flex items-center gap-2.5 rounded-lg px-4 py-3 text-[13px]">
                    <ShieldCheck className="size-[18px] shrink-0" />
                    Documents stay private. Only a fingerprint of them is kept with your request.
                  </div>
                  <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                    <Button variant="secondary" size="lg" className="w-full sm:w-auto" onClick={() => setStep(0)} disabled={busy}>
                      Back
                    </Button>
                    <Button size="lg" className="w-full pr-2 sm:w-auto" onClick={() => setStep(2)} disabled={busy || !documents.some((d) => d.sha256)}>
                      <CtaLabel>{withOfficer ? "Continue to sign-off" : "Continue to review"}</CtaLabel>
                    </Button>
                  </div>
                </>
              ) : null}

              {stepName === "Sign-off" ? (
                <>
                  <div className="space-y-3">
                    <h2 className="display-type text-2xl">Pick an approver to sign off</h2>
                    <p className="text-muted-foreground text-sm">
                      Someone at {org?.name ?? "your business"} who isn&apos;t you. They confirm {payerName.trim() || "the payer"} will pay. If the payment never arrives, they cover it. We&apos;ll email them a link.
                    </p>
                  </div>
                  {officers.length === 0 ? <ErrorNotice title="No other approvers">Ask an admin to add another approver to {org?.name ?? "your business"}.</ErrorNotice> : null}
                  <RadioGroup value={guarantor ?? ""} onValueChange={setGuarantor} aria-label="Approver" className="grid gap-3 sm:grid-cols-2">
                    {officers.map((o) => (
                      <Label
                        key={o.wallet}
                        htmlFor={`g-${o.wallet}`}
                        className="has-data-[state=checked]:border-foreground has-data-[state=checked]:border-[1.5px] border-border flex cursor-pointer items-center gap-3 rounded-lg border bg-surface px-5 py-4"
                      >
                        <span aria-hidden className="bg-surface-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                          {initials(o.displayName)}
                        </span>
                        <span className="flex flex-1 flex-col gap-0.5">
                          <span className="text-sm font-semibold">{o.displayName ?? "Approver without a name yet"}</span>
                          {o.title ? <span className="text-muted-foreground text-xs">{o.title}</span> : null}
                        </span>
                        <RadioGroupItem value={o.wallet} id={`g-${o.wallet}`} />
                      </Label>
                    ))}
                  </RadioGroup>
                  <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                    <Button variant="secondary" size="lg" className="w-full sm:w-auto" onClick={() => setStep(1)} disabled={busy}>
                      Back
                    </Button>
                    <Button size="lg" className="w-full pr-2 sm:w-auto" onClick={() => void saveGuarantor()} disabled={busy || !guarantor}>
                      {busy ? "Saving..." : <CtaLabel>Continue to review</CtaLabel>}
                    </Button>
                  </div>
                </>
              ) : null}

              {stepName === "Review" ? (
                <>
                  <div className="space-y-3">
                    <h2 className="display-type text-2xl">Review and send</h2>
                    <p className="text-muted-foreground text-sm">
                      {withOfficer ? `Double check the numbers, then send it to ${guarantorName} to sign off.` : "Double check the numbers, then send it for review."}
                    </p>
                  </div>
                  <div className="flex justify-center lg:hidden">
                    <ReceivableCard receivableId="DRAFT" amount={usd(requestedUnits)} state={previewState} org={cardLabel} kind={kind.short} tone="frost" scale={0.62} />
                  </div>
                  {/* the money first, with what you get now large; then what it's for */}
                  <div className="border-border flex flex-col rounded-xl border text-sm" data-testid="review-summary">
                    <div className="flex items-end justify-between gap-4 p-5">
                      <span className="text-muted-foreground">You get now</span>
                      <span className="money-type text-3xl">{usd(requestedUnits)}</span>
                    </div>
                    {[reviewMoney, reviewDetails].map((rows, i) => (
                      <div key={i} className="border-divider grid grid-cols-[1fr_auto] gap-x-8 gap-y-2.5 border-t p-5">
                        {rows.map(([label, value]) => (
                          <Fragment key={label}>
                            <span className="text-muted-foreground">{label}</span>
                            <span className="tabular text-right font-semibold">{value}</span>
                          </Fragment>
                        ))}
                      </div>
                    ))}
                  </div>
                  <p className="text-sm">
                    You&apos;ll get {usd(requestedUnits)} now. When {payerName.trim() || "the payer"} pays you, pay {usd(due)} back to the vault, with interest.
                    {withOfficer ? ` ${guarantorName} gets an email to sign off first.` : ""}
                    {financeFirst ? ` A finance agent at ${me.membership?.name} reviews it before an admin approves it.` : ""}
                  </p>
                  <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                    <Button variant="secondary" size="lg" className="w-full sm:w-auto" onClick={() => setStep(step - 1)} disabled={busy}>
                      Back
                    </Button>
                    <Button size="lg" className="w-full pr-2 sm:w-auto" onClick={() => void finish()} disabled={busy} data-testid="send-receivable">
                      {busy ? "Sending..." : <CtaLabel>{withOfficer ? `Send to ${guarantorName}` : financeFirst ? "Send to your finance team" : "Send for review"}</CtaLabel>}
                    </Button>
                  </div>
                </>
              ) : null}
            </motion.div>
            {error ? <ErrorNotice>{error}</ErrorNotice> : null}
          </CardContent>
        </Card>
        <WizardAside org={cardLabel} kind={kind.short} requestedUnits={requestedUnits} termSeconds={termSeconds} state={previewState} />
      </div>
    </div>
  );
}

export default function NewReceivablePage() {
  return (
    <AccountGate reason="Sign in to expedite a payment.">
      {(me) =>
        me.profile?.kycStatus === "approved" ? (
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-3xl" />}>
            <Wizard me={me} />
          </Suspense>
        ) : (
          <>
            <Topbar title="Expedite a payment" action={null} back={BACK} />
            <VerifyFirst status={me.profile?.kycStatus ?? "not_started"} role="member" />
          </>
        )
      }
    </AccountGate>
  );
}
