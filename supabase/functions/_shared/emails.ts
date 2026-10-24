import { formatUnits } from "viem";
import type { NotificationKind } from "./db/types.ts";
import type { Email } from "./mail.ts";

/** frxUSD wei as dollars and cents, rounded down. */
export function usd(wei: bigint | string): string {
  const [whole = "0", fraction = ""] = formatUnits(BigInt(wei), 18).split(".");
  return `$${Number(whole).toLocaleString("en-US")}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

function day(seconds: number | bigint): string {
  return new Date(Number(seconds) * 1000).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" });
}

/** Template fields. Amounts are wei as decimal strings and dates are unix seconds, so they can wait in the outbox. */
export type EmailData =
  | { kind: "guaranty_requested"; claimantName: string; orgName: string; amount: string; link: string; expires: string }
  | { kind: "claim_approved"; amount: string; link: string }
  | { kind: "claim_funded"; price: string; due: string; dueAt: number; link: string }
  | { kind: "due_soon"; remaining: string; dueAt: number; link: string }
  | { kind: "guarantor_called"; remaining: string; link: string };

/** Reads outbox data back into a template, or null if it's malformed. */
export function emailDataFrom(kind: NotificationKind, data: Record<string, string | number>): EmailData | null {
  const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : null);
  const num = (k: string) => (typeof data[k] === "number" ? (data[k] as number) : null);
  const link = str("link");
  if (!link) return null;
  switch (kind) {
    case "claim_approved": {
      const amount = str("amount");
      return amount ? { kind, amount, link } : null;
    }
    case "claim_funded": {
      const price = str("price");
      const due = str("due");
      const dueAt = num("dueAt");
      return price && due && dueAt !== null ? { kind, price, due, dueAt, link } : null;
    }
    case "due_soon": {
      const remaining = str("remaining");
      const dueAt = num("dueAt");
      return remaining && dueAt !== null ? { kind, remaining, dueAt, link } : null;
    }
    case "guarantor_called": {
      const remaining = str("remaining");
      return remaining ? { kind, remaining, link } : null;
    }
    case "guaranty_requested":
      return null;
  }
}

/** The FR-B9 emails. Plain text, purchase language only (U-09), and no receipt details. */
export function renderEmail(to: string, data: EmailData): Email {
  const sign = "\n\nB@B x Frax college org financing";
  switch (data.kind) {
    case "guaranty_requested":
      return {
        to,
        subject: `${data.claimantName} asked you to sign off on a reimbursement`,
        text:
          `${data.claimantName} wants to get their ${data.amount} ASUC reimbursement for ${data.orgName} now, and asked you to sign off as an officer. ` +
          `If ASUC never pays it, you cover what's left.\n\nReview and sign off: ${data.link}\n\nThis link expires ${data.expires}.${sign}`,
      };
    case "claim_approved":
      return {
        to,
        subject: "Your reimbursement was approved",
        text: `You're approved for ${usd(data.amount)}. Open it to get paid before the approval expires: ${data.link}${sign}`,
      };
    case "claim_funded":
      return {
        to,
        subject: "You got paid",
        text:
          `${usd(data.price)} of frxUSD is in your wallet. ` +
          `When ASUC pays you, send ${usd(data.due)} to Frax by ${day(data.dueAt)}: ${data.link}${sign}`,
      };
    case "due_soon":
      return {
        to,
        subject: "Send your ASUC payment to Frax within 14 days",
        text: `Once ASUC pays you, send ${usd(data.remaining)} to Frax by ${day(data.dueAt)}. Do it here: ${data.link}${sign}`,
      };
    case "guarantor_called":
      return {
        to,
        subject: "You're asked to cover a reimbursement you signed off on",
        text:
          `ASUC didn't pay a reimbursement you signed off on in full. You cover the ${usd(data.remaining)} that's left. ` +
          `Pay it here: ${data.link}${sign}`,
      };
  }
}

export type { NotificationKind };
