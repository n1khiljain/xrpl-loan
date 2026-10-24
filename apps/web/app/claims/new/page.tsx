"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileText, ShieldCheck, Upload } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useState } from "react";
import { Topbar } from "@/components/app/topbar";
import { AccountGate } from "@/components/app/account-gate";
import { VerifyFirst } from "@/components/app/verify-first";
import { initials } from "@/components/app/avatar";
import { CtaLabel } from "@/components/app/cta";
import { MoneyField } from "@/components/app/money-field";
import { ErrorNotice } from "@/components/app/notice";
import { Segmented } from "@/components/app/segmented";
import { Stepper } from "@/components/app/stepper";
import { ClaimCard } from "@/components/brand/claim-card";
import { EASE } from "@/components/motion";
import { WizardAside } from "@/components/claim/wizard-aside";
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
import { amountDue, parseUsd, usd, weiToInput } from "@/lib/format";
import type { ClaimWithDocuments, DocumentView, InviteCreated, MeResponse, PacketResponse } from "@/lib/types";

/** Once a draft is saved, it waits in this list with "Finish". */
const BACK = { href: "/claims/?view=claims", label: "My reimbursements" };

const STEPS = ["Details", "Receipts", "Sign-off", "Review"] as const;
const RECEIPT_TYPES = "application/pdf,image/png,image/jpeg,image/heic,image/webp";

function maxRequest(face: bigint): bigint {
  const byRate = (face * params.advanceRateBps) / 10_000n;
  return byRate < params.perClaimCap ? byRate : params.perClaimCap;
}

/** A draft always has org, amounts, and the CalLink number saved (that's what creates it); resume past Details. */
function initialStep(initial: ClaimWithDocuments | null): number {
  if (!initial) return 0;
  const { claim, documents } = initial;
  if (!documents.some((d) => d.sha256)) return 1;
  return claim.guarantorWallet ? 3 : 2;
}

/** Loads a draft named by ?id= (to resume it), then renders the form seeded from it. */
function Wizard({ me }: { me: MeResponse }) {
  const call = useCall();
  const router = useRouter();
  const id = useSearchParams().get("id");
  const draft = useQuery({
    queryKey: ["claim", id],
    enabled: Boolean(id),
    queryFn: () => call<ClaimWithDocuments>("claims", { query: { id: id as string } }),
  });
  const frozen = Boolean(draft.data?.claim.packetHash);
  useEffect(() => {
    if (frozen && id) router.replace(`/claim/?id=${id}`);
  }, [frozen, id, router]);
  if (id && (draft.isPending || frozen)) {
    return (
      <div>
        <Topbar title="Get reimbursed now" crumb="Loading your draft" action={null} back={BACK} />
        <Skeleton className="h-64 w-full rounded-3xl" />
      </div>
    );
  }
  if (draft.isError) {
    return (
      <div>
        <Topbar title="Get reimbursed now" action={null} back={BACK} />
        <ErrorNotice>{friendlyError(draft.error)}</ErrorNotice>
      </div>
    );
  }
  return <WizardForm key={id ?? "new"} me={me} initial={draft.data ?? null} />;
}

function WizardForm({ me, initial }: { me: MeResponse; initial: ClaimWithDocuments | null }) {
  const call = useCall();
  const router = useRouter();
  const queryClient = useQueryClient();
  const orgs = useOrgs();
  const seed = initial?.claim;
  const [claimId, setClaimId] = useState<string | null>(seed?.id ?? null);
  const [step, setStep] = useState(() => initialStep(initial));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [pickedOrgId, setOrgId] = useState<number | null>(seed?.orgId ?? null);
  const [recipientType, setRecipientType] = useState<"member" | "org_treasurer">(seed?.recipientType ?? "member");
  const [face, setFace] = useState(() => (seed ? weiToInput(BigInt(seed.faceValue)) : ""));
  const [requested, setRequested] = useState(() => (seed ? weiToInput(BigInt(seed.requestedAmount)) : ""));
  const [callink, setCallink] = useState(seed?.callinkPrNumber ?? "");
  const [description, setDescription] = useState(seed?.description ?? "");
  const [guarantor, setGuarantor] = useState<string | null>(seed?.guarantorWallet ?? null);
  // a resumed draft that asked for less than the most keeps its field open
  const [takeLess, setTakeLess] = useState(() => Boolean(seed && BigInt(seed.requestedAmount) < maxRequest(BigInt(seed.faceValue))));

  const draft = useQuery({
    queryKey: ["claim", claimId],
    enabled: Boolean(claimId),
    initialData: initial ?? undefined,
    queryFn: () => call<ClaimWithDocuments>("claims", { query: { id: claimId as string } }),
  });

  const faceWei = parseUsd(face);
  const requestedWei = parseUsd(requested) ?? 0n;
  const orgList = orgs.data ?? [];
  // with one org there's nothing to choose, so it's picked for you
  const orgId = pickedOrgId ?? (orgList.length === 1 ? (orgList[0]?.id ?? null) : null);
  const org = orgList.find((o) => o.id === orgId) ?? null;
  const isOfficer = me.officerOrgs.some((o) => o.orgId === orgId);
  const officers = (org?.officers ?? []).filter((o) => o.wallet !== me.profile?.wallet);
  const documents: DocumentView[] = draft.data?.documents ?? [];

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
      if (!orgId) throw new Error("Pick an org.");
      if (!faceWei || !requestedWei || faceWei === 0n || requestedWei === 0n) throw new Error("Enter both amounts in dollars.");
      if (requestedWei > maxRequest(faceWei)) throw new Error(`You can ask for up to ${usd(maxRequest(faceWei))}.`);
      const fields = {
        recipientType,
        faceValue: faceWei.toString(),
        requestedAmount: requestedWei.toString(),
        callinkPrNumber: callink.trim(),
        description: description.trim() || null,
      };
      if (claimId) {
        await call("claims", { method: "PATCH", body: { id: claimId, ...fields } });
      } else {
        const created = await call<ClaimWithDocuments>("claims", { method: "POST", body: { orgId, ...fields } });
        queryClient.setQueryData(["claim", created.claim.id], created);
        setClaimId(created.claim.id);
        // keep the URL resumable without remounting the form
        window.history.replaceState(null, "", `/claims/new/?id=${created.claim.id}`);
      }
      await queryClient.invalidateQueries({ queryKey: ["claim"] });
      setStep(1);
    });

  const upload = (files: FileList | null) =>
    run(async () => {
      if (!claimId || !files) return;
      for (const file of Array.from(files)) {
        const created = await call<{ document: DocumentView; upload: { path: string; token: string } }>("documents", {
          method: "POST",
          body: { action: "create", claimId, mimeType: file.type, sizeBytes: file.size },
        });
        await uploadToSignedUrl(created.upload.path, created.upload.token, file);
        await call("documents", { method: "POST", body: { action: "confirm", documentId: created.document.id } });
      }
      await queryClient.invalidateQueries({ queryKey: ["claim", claimId] });
    });

  const saveGuarantor = () =>
    run(async () => {
      if (!claimId || !guarantor) return;
      await call("claims", { method: "PATCH", body: { id: claimId, guarantorWallet: guarantor } });
      await queryClient.invalidateQueries({ queryKey: ["claim", claimId] });
      setStep(3);
    });

  const sendToGuarantor = () =>
    run(async () => {
      if (!claimId) return;
      await call<PacketResponse>("packet", { method: "POST", body: { claimId } });
      await call<InviteCreated>("guarantor-invite", { method: "POST", body: { claimId } });
      await queryClient.invalidateQueries();
      router.push(`/claim/?id=${claimId}`);
    });

  const due = requestedWei ? amountDue(requestedWei, params.feeBps, params.overdueWindowSeconds) : 0n;
  const fee = due - requestedWei;
  const overdueDays = Math.round(params.overdueWindowSeconds / 86_400);
  const guarantorName = officers.find((o) => o.wallet === guarantor)?.displayName ?? "your officer";
  const previewOrgName = org?.name ?? "Your org";
  const previewState = (STEPS[step] ?? STEPS[0]).toUpperCase();

  const reviewMoney: Array<[string, string]> = [
    ["Amount on the request", usd(faceWei)],
    ["Fee, at most, if sent by the due date", usd(fee)],
    ["You send Frax, at most", usd(due)],
    ["Send by", `${overdueDays} days after you're paid`],
  ];
  const reviewDetails: Array<[string, string]> = [
    ["Org", org?.name ?? "Not picked"],
    ["Who paid", recipientType === "member" ? "You" : "The org"],
    ["CalLink request", callink || "Not entered"],
    ["What it was for", description.trim() || "Not entered"],
    ["Officer signing off", guarantorName],
    ["Receipts", `${documents.length} ${documents.length === 1 ? "file" : "files"}`],
  ];

  return (
    <div>
      <Topbar title="Get reimbursed now" crumb={`Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`} action={null} back={BACK} />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <Card className="min-w-0 lg:flex-1">
          <CardContent className="flex flex-col gap-6">
            <Stepper steps={STEPS} current={step} />
            <motion.div key={step} className="flex flex-col gap-6" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
              {step === 0 ? (
                <>
                  <div className="space-y-1">
                    <h2 className="display-type text-2xl">What did you pay for?</h2>
                    <p className="text-muted-foreground text-sm">Get it now instead of waiting on ASUC. When ASUC pays you, you send it to Frax.</p>
                  </div>

                  {/* one org is picked for you; the pills only show when there's a real choice (U-75) */}
                  {orgs.isPending ? <Skeleton className="h-5 w-56" /> : null}
                  {orgList.length === 1 && org ? (
                    <p className="flex items-center gap-2.5 text-sm" data-testid="org-picked">
                      <span aria-hidden className="bg-surface-muted flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">
                        {initials(org.name)}
                      </span>
                      <span>
                        <span className="text-muted-foreground">For </span>
                        <span className="font-semibold">{org.name}</span>
                      </span>
                    </p>
                  ) : orgList.length > 1 ? (
                    <div className="space-y-2.5">
                      <p className="text-sm font-semibold">Org</p>
                      <RadioGroup value={orgId ? String(orgId) : ""} onValueChange={(v) => setOrgId(Number(v))} aria-label="Org" disabled={Boolean(claimId)} className="flex flex-wrap gap-2.5">
                        {orgList.map((o) => (
                          <Label
                            key={o.id}
                            htmlFor={`org-${o.id}`}
                            className="has-data-[state=checked]:border-foreground has-data-[state=checked]:border-[1.5px] border-border has-data-[disabled]:opacity-60 has-focus-visible:ring-ring/50 has-focus-visible:ring-[3px] flex cursor-pointer items-center gap-3 rounded-full border bg-surface py-2 pr-5 pl-2.5"
                          >
                            <RadioGroupItem value={String(o.id)} id={`org-${o.id}`} className="sr-only" />
                            <span aria-hidden className="bg-surface-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                              {initials(o.name)}
                            </span>
                            <span className="text-sm font-semibold">{o.name}</span>
                          </Label>
                        ))}
                      </RadioGroup>
                      {claimId ? <p className="text-muted-foreground text-xs">The org can&apos;t change once you&apos;ve started.</p> : null}
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <MoneyField
                      id="face"
                      label="Amount on the purchase request"
                      value={face}
                      onChange={(v) => {
                        setFace(v);
                        const f = parseUsd(v);
                        if (f) setRequested(weiToInput(maxRequest(f)));
                      }}
                      placeholder="240.00"
                    />
                    {/* most people take the most they can, so the second amount stays a line until you ask for less */}
                    {takeLess ? (
                      <div className="space-y-2 pt-2">
                        <Label htmlFor="requested" className="text-sm font-semibold">
                          How much you want now ($)
                        </Label>
                        <Input id="requested" inputMode="decimal" value={requested} onChange={(e) => setRequested(e.target.value)} className="sm:max-w-[240px]" />
                        <p className="text-muted-foreground text-xs">Up to {faceWei ? usd(maxRequest(faceWei)) : usd(params.perClaimCap)}</p>
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-sm" data-testid="get-now">
                        {faceWei ? (
                          <>
                            You get <span className="text-foreground font-semibold">{usd(requestedWei)}</span> now.{" "}
                          </>
                        ) : (
                          `Up to ${usd(params.perClaimCap)} per reimbursement. `
                        )}
                        {faceWei ? (
                          <button type="button" className="text-foreground font-medium underline underline-offset-4" onClick={() => setTakeLess(true)}>
                            Take less
                          </button>
                        ) : null}
                      </p>
                    )}
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="callink" className="text-sm font-semibold">
                        CalLink purchase request number
                      </Label>
                      <Input id="callink" value={callink} onChange={(e) => setCallink(e.target.value)} placeholder="PR-123456" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description" className="text-sm font-semibold">
                        What was it for?
                      </Label>
                      <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} placeholder="Catering for the hackathon" />
                    </div>
                  </div>

                  {/* only officers can be paid as the treasurer, so members never see this */}
                  {isOfficer || recipientType === "org_treasurer" ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-sm font-semibold">Who paid?</span>
                      <Segmented
                        id="who-paid"
                        label="Who paid"
                        value={recipientType}
                        onChange={setRecipientType}
                        options={[
                          { value: "member", label: "I did" },
                          { value: "org_treasurer", label: "The org, I'm treasurer" },
                        ]}
                      />
                    </div>
                  ) : null}

                  {/* stacked on phones, primary on top, so a long label or wider font never pushes past 375px (FR-F10) */}
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <Button asChild variant="secondary" size="lg" className="w-full sm:w-auto">
                      <Link href="/claims/">Cancel</Link>
                    </Button>
                    <Button size="lg" className="w-full pr-2 sm:w-auto" onClick={() => void saveDetails()} disabled={busy || !orgId || !face || !requested || !callink.trim()}>
                      {busy ? "Saving..." : <CtaLabel>Continue to receipts</CtaLabel>}
                    </Button>
                  </div>
                </>
              ) : null}

              {step === 1 ? (
                <>
                  <div className="space-y-1">
                    <h2 className="display-type text-2xl">Add your receipts</h2>
                    <p className="text-muted-foreground text-sm">Upload what you sent to CalLink: receipts and proof you paid, up to 10 MB each.</p>
                  </div>
                  <Label
                    htmlFor="receipts"
                    className="border-border hover:border-foreground bg-surface-muted/60 relative flex h-[180px] cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border-[1.5px] border-dashed text-center"
                  >
                    <Upload aria-hidden className="size-6" strokeWidth={1.8} />
                    <span className="text-sm font-semibold">{busy ? "Uploading..." : "Drop files here or choose files"}</span>
                    <span className="text-muted-foreground text-xs">PDF, JPG or PNG up to 10 MB each</span>
                    <input id="receipts" type="file" multiple accept={RECEIPT_TYPES} className="sr-only" onChange={(e) => void upload(e.target.files)} disabled={busy} />
                  </Label>
                  <ul className="flex flex-col" data-testid="receipt-list">
                    {documents.map((d, i) => (
                      <li key={d.id} className="border-divider flex items-center gap-3 border-b py-3 last:border-0">
                        <FileText aria-hidden className="text-muted-foreground size-[18px] shrink-0" />
                        <span className="flex-1 text-sm font-semibold">
                          Receipt {i + 1} {d.sha256 ? "uploaded" : "still uploading"}
                        </span>
                        {d.sha256 ? <Check aria-label="Uploaded" className="text-success size-4 shrink-0" strokeWidth={2.5} /> : null}
                      </li>
                    ))}
                  </ul>
                  <div className="bg-surface-muted flex items-center gap-2.5 rounded-lg px-4 py-3 text-[13px]">
                    <ShieldCheck className="size-[18px] shrink-0" />
                    Receipts stay private. Only a fingerprint of them goes onchain.
                  </div>
                  {/* stacked on phones, primary on top, so a long label or wider font never pushes past 375px (FR-F10) */}
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <Button variant="secondary" size="lg" className="w-full sm:w-auto" onClick={() => setStep(0)} disabled={busy}>
                      Back
                    </Button>
                    <Button size="lg" className="w-full pr-2 sm:w-auto" onClick={() => setStep(2)} disabled={busy || !documents.some((d) => d.sha256)}>
                      <CtaLabel>Continue to sign-off</CtaLabel>
                    </Button>
                  </div>
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <div className="space-y-1">
                    <h2 className="display-type text-2xl">Pick an officer to sign off</h2>
                    <p className="text-muted-foreground text-sm">
                      An officer of {org?.name ?? "your org"} who isn&apos;t you. They vouch that ASUC will pay you. If ASUC never does, they cover it. We&apos;ll email them a link.
                    </p>
                  </div>
                  {officers.length === 0 ? <ErrorNotice title="No other officers">Ask your org&apos;s officers to sign up first, or ask an admin to add them.</ErrorNotice> : null}
                  <RadioGroup value={guarantor ?? ""} onValueChange={setGuarantor} aria-label="Officer" className="grid gap-2.5 sm:grid-cols-2">
                    {officers.map((o) => (
                      <Label
                        key={o.wallet}
                        htmlFor={`g-${o.wallet}`}
                        className="has-data-[state=checked]:border-foreground has-data-[state=checked]:border-[1.5px] border-border flex cursor-pointer items-center gap-3 rounded-lg border bg-surface p-3"
                      >
                        <span aria-hidden className="bg-surface-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                          {initials(o.displayName)}
                        </span>
                        <span className="flex flex-1 flex-col gap-0.5">
                          <span className="text-sm font-semibold">{o.displayName ?? "Officer without a name yet"}</span>
                          {o.title ? <span className="text-muted-foreground text-xs">{o.title}</span> : null}
                        </span>
                        <RadioGroupItem value={o.wallet} id={`g-${o.wallet}`} />
                      </Label>
                    ))}
                  </RadioGroup>
                  {/* stacked on phones, primary on top, so a long label or wider font never pushes past 375px (FR-F10) */}
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <Button variant="secondary" size="lg" className="w-full sm:w-auto" onClick={() => setStep(1)} disabled={busy}>
                      Back
                    </Button>
                    <Button size="lg" className="w-full pr-2 sm:w-auto" onClick={() => void saveGuarantor()} disabled={busy || !guarantor}>
                      {busy ? "Saving..." : <CtaLabel>Continue to review</CtaLabel>}
                    </Button>
                  </div>
                </>
              ) : null}

              {step === 3 ? (
                <>
                  <div className="space-y-1">
                    <h2 className="display-type text-2xl">Review and send</h2>
                    <p className="text-muted-foreground text-sm">Double check the numbers, then send it to {guarantorName} to sign off.</p>
                  </div>
                  <div className="flex justify-center lg:hidden">
                    <ClaimCard claimId="DRAFT" amount={usd(requestedWei)} state={previewState} org={previewOrgName} tone="frost" scale={0.62} />
                  </div>
                  {/* the money first, with what you get now large; then what it's for (U-75) */}
                  <div className="border-border flex flex-col rounded-xl border text-sm" data-testid="review-summary">
                    <div className="flex items-end justify-between gap-4 p-5">
                      <span className="text-muted-foreground">You get now</span>
                      <span className="money-type text-3xl font-semibold">{usd(requestedWei)}</span>
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
                    You&apos;ll get {usd(requestedWei)} now. When ASUC pays you, send {usd(due)} to Frax. {guarantorName} gets an email to sign off first, then you send it for review.
                  </p>
                  {/* stacked on phones, primary on top, so a long label or wider font never pushes past 375px (FR-F10) */}
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <Button variant="secondary" size="lg" className="w-full sm:w-auto" onClick={() => setStep(2)} disabled={busy}>
                      Back
                    </Button>
                    <Button size="lg" className="w-full pr-2 sm:w-auto" onClick={() => void sendToGuarantor()} disabled={busy} data-testid="send-to-guarantor">
                      {busy ? "Sending..." : <CtaLabel>{`Send to ${guarantorName}`}</CtaLabel>}
                    </Button>
                  </div>
                </>
              ) : null}

            </motion.div>
            {error ? <ErrorNotice>{error}</ErrorNotice> : null}
          </CardContent>
        </Card>
        <WizardAside org={previewOrgName} requestedWei={requestedWei} state={previewState} />
      </div>
    </div>
  );
}

export default function NewClaimPage() {
  return (
    <AccountGate reason="Sign in to get reimbursed now.">
      {(me) =>
        me.profile?.kycStatus === "approved" ? (
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-3xl" />}>
            <Wizard me={me} />
          </Suspense>
        ) : (
          <>
            <Topbar title="Get reimbursed now" action={null} back={BACK} />
            <VerifyFirst status={me.profile?.kycStatus ?? "not_started"} role="member" wallet={me.profile?.wallet} />
          </>
        )
      }
    </AccountGate>
  );
}
