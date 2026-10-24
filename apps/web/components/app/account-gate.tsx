"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { ReceivableCard } from "@/components/brand/receivable-card";
import { ClientLockup } from "@/components/brand/logos-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useCall, useMe } from "@/hooks/use-api";
import { PUBLIC_ENV } from "@/lib/env";
import { friendlyError } from "@/lib/errors";
import { useSession } from "@/lib/session/context";
import type { MeResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LocalDemoPicker } from "./local-demo-picker";
import { Avatar } from "./avatar";
import { ErrorNotice } from "./notice";

function Loading() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-8 w-1/2 rounded-full" />
      <Skeleton className="h-40 w-full rounded-3xl" />
    </div>
  );
}

type Mode = "sign-in" | "sign-up";

/** Privy's errors, in words that say what to do next. */
function signInError(e: unknown, mode: Mode): string {
  const message = e instanceof Error ? e.message : "";
  if (mode === "sign-in" && /not (exist|found)|no user|sign ?up|signup/i.test(message)) {
    return "There's no account for that email yet. Switch to Create account.";
  }
  if (/not allowed/i.test(message)) return "That sign-in option is switched off right now. Use an emailed code instead.";
  if (/code/i.test(message) && /invalid|incorrect|expired/i.test(message)) {
    return "That code didn't work. Use the newest email, or send a new code.";
  }
  return friendlyError(e);
}

const COPY: Record<Mode, { heading: string; blurb: string; submit: string }> = {
  "sign-in": {
    heading: "Sign in",
    blurb: "Use the Google account or email you signed up with.",
    submit: "Sign in",
  },
  "sign-up": {
    heading: "Create your account",
    blurb: "Use your Google account or email. We make an XRP Ledger wallet for you, no crypto setup needed.",
    submit: "Create account",
  },
};

/**
 * Sign in and create account (FR-F2). Both are Google or an emailed code, entered right here. An emailed code on
 * "Sign in" won't quietly make a second account for a mistyped email. Staying signed in is Privy's 30-day session.
 */
function SignIn({ reason }: { reason: string }) {
  const session = useSession();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"google" | "send" | "verify" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[mode];
  const signUp = mode === "sign-up";

  async function run(kind: "google" | "send" | "verify", action: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(signInError(e, mode));
    } finally {
      setBusy(null);
    }
  }

  const sendCode = (to: string) =>
    run("send", async () => {
      await session.sendEmailCode(to, { signUp });
      setSentTo(to);
      setCode("");
    });

  function switchMode(next: Mode) {
    setMode(next);
    setSentTo(null);
    setCode("");
    setError(null);
  }

  return (
    <div className="bg-surface flex min-h-[calc(100vh-2rem)] flex-col lg:flex-row">
      <section className="bg-grad-signin grain text-on-ink relative flex h-[340px] shrink-0 flex-col overflow-hidden px-[18px] pt-2.5 lg:h-auto lg:min-h-screen lg:w-1/2 lg:px-12 lg:pt-10 lg:pb-10">
        {/* back sits in the top-left corner at every size; the logos follow it on desktop and take the right on phones */}
        <header className="flex h-14 items-center justify-between gap-6 lg:h-auto lg:justify-start">
          <Link
            href="/"
            aria-label="Back to the home page"
            data-testid="back-home"
            className="bg-on-ink/40 text-ink hover:bg-on-ink/60 flex size-11 shrink-0 items-center justify-center rounded-full transition-colors"
          >
            <ArrowLeft aria-hidden className="size-5" />
          </Link>
          <span className="text-xl lg:text-2xl">
            <ClientLockup tone="on-light" />
          </span>
        </header>
        <div className="flex flex-1 items-center justify-center pb-10 lg:pb-0">
          <div className="-rotate-6">
            <span className="lg:hidden">
              <ReceivableCard receivableId="0001" amount="$0.00" state="YOURS NEXT" org="Your customer" kind="Invoice" scale={0.5} />
            </span>
            <span className="hidden lg:block">
              <ReceivableCard receivableId="0001" amount="$0.00" state="YOURS NEXT" org="Your customer" kind="Invoice" />
            </span>
          </div>
        </div>
        <h2 className="display-type hidden max-w-md text-[38px] lg:block">Stop waiting on payments</h2>
      </section>
      <section className="signin-ink bg-surface text-foreground relative -mt-8 flex flex-1 flex-col justify-center gap-5 rounded-t-3xl px-[18px] pt-6 pb-10 lg:mt-0 lg:rounded-none lg:px-[120px]">
        <span aria-hidden className="bg-border -mt-2 h-1 w-9 self-center rounded-full lg:hidden" />
        <div role="tablist" aria-label="Sign in or create an account" className="bg-muted grid grid-cols-2 rounded-full p-1 text-sm font-bold">
          {(["sign-in", "sign-up"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              data-testid={`mode-${m}`}
              onClick={() => switchMode(m)}
              className={cn("h-10 rounded-full transition-colors", mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}
            >
              {m === "sign-in" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          <h1 className="text-[28px] font-bold tracking-tight lg:text-4xl">{copy.heading}</h1>
          <p className="text-muted-foreground text-sm leading-relaxed lg:text-[15px]">
            {signUp ? copy.blurb : `${reason} ${copy.blurb}`}
          </p>
        </div>
        <fieldset disabled={Boolean(session.unavailableReason) || busy !== null} className="flex flex-col gap-4 disabled:opacity-60">
          {sentTo === null ? (
            <>
              <Button type="button" size="lg" className="w-full" data-testid="google-sign-in" onClick={() => void run("google", () => session.loginWithGoogle())}>
                {busy === "google" ? "Opening Google..." : "Continue with Google"}
              </Button>
              <div className="text-muted-foreground flex items-center gap-3 text-[11px] font-bold tracking-[0.1em]">
                <span className="bg-border h-px flex-1" />
                OR WITH AN EMAILED CODE
                <span className="bg-border h-px flex-1" />
              </div>
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (email.trim()) void sendCode(email.trim());
                }}
              >
                <Label htmlFor="sign-in-email" className="text-[13px] font-bold">
                  Email
                </Label>
                <Input id="sign-in-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="h-[54px] rounded-lg text-base" />
                <Button type="submit" variant="outline" size="lg" className="w-full" data-testid="gate-sign-in">
                  {busy === "send" ? "Sending..." : "Email me a code"}
                </Button>
              </form>
            </>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim()) void run("verify", () => session.verifyEmailCode(code.trim()));
              }}
            >
              <Label htmlFor="sign-in-code" className="text-[13px] font-bold">
                Code from your email
              </Label>
              <p className="text-muted-foreground -mt-1 text-sm">
                We sent a 6-digit code to <span className="text-foreground font-bold">{sentTo}</span>.
              </p>
              <Input
                id="sign-in-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="h-[54px] rounded-lg text-center font-mono text-xl tracking-[0.4em]"
              />
              <Button type="submit" size="lg" className="w-full" disabled={code.length !== 6} data-testid="verify-code">
                {busy === "verify" ? "Checking..." : copy.submit}
              </Button>
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <button type="button" className="text-muted-foreground underline underline-offset-2" onClick={() => setSentTo(null)}>
                  Use a different email
                </button>
                <button type="button" className="text-muted-foreground underline underline-offset-2" onClick={() => void sendCode(sentTo)}>
                  Send a new code
                </button>
              </div>
            </form>
          )}
          {error || session.loginError ? <ErrorNotice>{error ?? signInError(new Error(session.loginError ?? ""), mode)}</ErrorNotice> : null}
        </fieldset>
        {session.unavailableReason ? <ErrorNotice title="Sign-in isn't available">{session.unavailableReason}</ErrorNotice> : null}
        {PUBLIC_ENV.demoSessions ? <LocalDemoPicker /> : null}
        <p className="text-muted-foreground text-center text-[11px] leading-normal lg:text-left lg:text-xs">
          Test network only: no real money moves. You stay signed in on this device for 30 days.
        </p>
      </section>
    </div>
  );
}

/**
 * First visit only: their name. Saving makes the account and its custodial XRP Ledger wallet on the server; the
 * identity token proves the email they signed in with, so it isn't asked again.
 */
function SetUpAccount() {
  const session = useSession();
  const call = useCall();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState(session.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function setUp() {
    setBusy(true);
    setError(null);
    try {
      const identityToken = await session.getIdentityToken();
      await call<MeResponse>("me", {
        method: "POST",
        body: {
          ...(identityToken ? { identityToken } : {}),
          email: session.email ?? (email.trim() || null),
          displayName: name.trim() || null,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="bg-card mx-auto flex w-full max-w-xl flex-col gap-5 rounded-3xl p-5 sm:p-7"
      onSubmit={(e) => {
        e.preventDefault();
        void setUp();
      }}
    >
      <div className="space-y-2">
        <span className="text-muted-foreground text-xs font-medium">One last thing</span>
        <h2 className="display-type text-3xl">What should we call you?</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Your name shows on your loans and sign-offs.
          {session.email ? (
            <>
              {" "}
              Updates go to <span className="text-foreground font-semibold">{session.email}</span>.
            </>
          ) : null}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="display-name" className="text-[13px] font-semibold">
          Your name
        </Label>
        <Input id="display-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} autoFocus />
      </div>
      {/* how they'll show up in the app, updating as they type */}
      <div className="bg-ink text-on-ink flex items-center gap-3 rounded-2xl p-3.5" data-testid="name-preview">
        <Avatar name={name} onInk />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">{name.trim() || "Your name"}</span>
          <span className="text-on-ink/60 truncate text-xs">{session.email ?? "How you'll show up"}</span>
        </span>
      </div>
      {session.email ? null : (
        <div className="space-y-2">
          <Label htmlFor="email" className="text-[13px] font-semibold">
            Email for updates (optional)
          </Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
      )}
      <p className="text-muted-foreground text-xs">We&apos;ll make your XRP Ledger wallet and fund it with test XRP. It takes a few seconds.</p>
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      <Button type="submit" size="lg" disabled={busy || !name.trim()} className="w-full sm:w-auto sm:self-start">
        {busy ? "Making your wallet..." : "Continue"}
      </Button>
    </form>
  );
}

/**
 * Renders children once the visitor is signed in and has a profile. Otherwise it shows the one step they need
 * next: sign in, or finish setting up.
 */
export function AccountGate({ children, reason }: { children: (me: MeResponse) => ReactNode; reason: string }) {
  const session = useSession();
  const me = useMe();

  if (session.status === "loading") return <Loading />;
  if (session.status === "signed-out") return <SignIn reason={reason} />;
  if (me.isPending) return <Loading />;
  if (me.isError) return <ErrorNotice>{friendlyError(me.error)}</ErrorNotice>;
  if (!me.data.profile) return <SetUpAccount />;
  return <>{children(me.data)}</>;
}
