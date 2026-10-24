"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AccountGate } from "@/components/app/account-gate";
import { ErrorNotice, InfoNotice } from "@/components/app/notice";
import { Topbar } from "@/components/app/topbar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCall } from "@/hooks/use-api";
import { friendlyError } from "@/lib/errors";
import { announceConnected, startFraxnetConnect, takeReturnPath } from "@/lib/fraxnet-connect";
import { useSession } from "@/lib/session/context";
import type { KycStatusResponse } from "@/lib/types";

const BACK = { href: "/onboard/", label: "Verification" };

/** What FraxNet's own error codes mean to the person who came back with one. */
function deniedText(error: string): string {
  if (error === "access_denied") return "You cancelled on FraxNet, so nothing was connected.";
  if (error === "login_required" || error === "consent_required") return "FraxNet needs you to sign in and allow access. Try again.";
  return "FraxNet couldn't finish connecting. Try again.";
}

/**
 * Where FraxNet sends the browser after sign-in (U-77). Hands the code to `fraxnet-connect`, which exchanges it on
 * the server. Usually this is the tab Connect FraxNet opened, so it tells the app's other tab and closes; when FraxNet
 * opened in this same tab, it goes back to the page that started the connect.
 */
function Callback() {
  const params = useSearchParams();
  const router = useRouter();
  const call = useCall();
  const session = useSession();
  const queryClient = useQueryClient();
  const code = params.get("code");
  const state = params.get("state");
  const denied = params.get("error");
  const [error, setError] = useState<unknown>(null);
  const [retrying, setRetrying] = useState(false);
  const [done, setDone] = useState(false);
  // a FraxNet code works once, so strict mode's second effect run must not send it again
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current || denied || !code || !state) return;
    sent.current = true;
    call<KycStatusResponse>("fraxnet-connect", { method: "POST", body: { action: "finish", code, state } })
      .then(async (status) => {
        announceConnected(status);
        queryClient.setQueryData(["kyc", session.userId], status);
        await queryClient.invalidateQueries({ queryKey: ["me"] });
        const back = takeReturnPath();
        if (back) {
          router.replace(back);
          return;
        }
        // the tab Connect FraxNet opened: the other tab already updated, so this one can go
        setDone(true);
        window.close();
      })
      .catch(setError);
  }, [call, code, state, denied, queryClient, router, session.userId]);

  const problem = denied ? deniedText(denied) : !code || !state ? "This link is missing FraxNet's answer. Start again from Verification." : error ? friendlyError(error) : null;

  if (done) {
    return (
      <div className="flex max-w-xl flex-col gap-4" data-testid="fraxnet-connected-tab">
        <InfoNotice title="FraxNet is connected">You can close this tab and go back to the app. It has already updated.</InfoNotice>
        <Button asChild variant="outline" className="self-start">
          <Link href="/onboard/">Continue here instead</Link>
        </Button>
      </div>
    );
  }
  if (!problem) {
    return (
      <div className="space-y-4" aria-busy="true" data-testid="fraxnet-connecting">
        <p className="text-muted-foreground text-sm">Connecting your FraxNet account...</p>
        <Skeleton className="h-40 w-full rounded-3xl" />
      </div>
    );
  }
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <ErrorNotice title="FraxNet isn't connected yet">
        <span data-testid="fraxnet-callback-error">{problem}</span>
      </ErrorNotice>
      <div className="flex gap-2.5">
        <Button
          disabled={retrying}
          onClick={() => {
            setRetrying(true);
            startFraxnetConnect(call, takeReturnPath() ?? "/onboard/").catch((e) => {
              setRetrying(false);
              setError(e);
            });
          }}
        >
          {retrying ? "Opening FraxNet..." : "Try again"}
        </Button>
        <Button asChild variant="outline">
          <Link href="/onboard/">Back to verification</Link>
        </Button>
      </div>
    </div>
  );
}

export default function FraxnetCallbackPage() {
  return (
    <AccountGate reason="Sign in again to finish connecting FraxNet.">
      {() => (
        <>
          <Topbar title="Connect FraxNet" crumb="Verification" back={BACK} />
          <Suspense fallback={<Skeleton className="h-40 w-full rounded-3xl" />}>
            <Callback />
          </Suspense>
        </>
      )}
    </AccountGate>
  );
}
