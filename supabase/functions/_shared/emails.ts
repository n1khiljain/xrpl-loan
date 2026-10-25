import { unitsToValue } from "@app/adapters";
import type { NotificationKind } from "./db/types.ts";
import type { Email } from "./mail.ts";

/** Base units as dollars and cents, rounded down. */
export function usd(units: bigint | string): string {
  const [whole = "0", fraction = ""] = unitsToValue(BigInt(units)).split(".");
  return `$${Number(whole).toLocaleString("en-US")}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

function day(seconds: number | bigint): string {
  return new Date(Number(seconds) * 1000).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" });
}

/** Template fields. Amounts are base units as decimal strings and dates are unix seconds. */
export type EmailData =
  | { kind: "guaranty_requested"; sellerName: string; orgName: string; amount: string; link: string; expires: string }
  | { kind: "receivable_approved"; amount: string; link: string }
  | { kind: "receivable_funded"; price: string; due: string; dueAt: number; link: string }
  | { kind: "due_soon"; remaining: string; dueAt: number; link: string }
  | { kind: "guarantor_called"; remaining: string; link: string };

/** Reads outbox data back into a template, or null if it's malformed. */
export function emailDataFrom(kind: NotificationKind, data: Record<string, string | number>): EmailData | null {
  const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : null);
  const num = (k: string) => (typeof data[k] === "number" ? (data[k] as number) : null);
  const link = str("link");
  if (!link) return null;
  switch (kind) {
    case "receivable_approved": {
      const amount = str("amount");
      return amount ? { kind, amount, link } : null;
    }
    case "receivable_funded": {
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

/** Plain-text emails, with no receipt details. */
export function renderEmail(to: string, data: EmailData): Email {
  const sign = "\n\nInstall on the XRP Ledger";
  switch (data.kind) {
    case "guaranty_requested":
      return {
        to,
        subject: `${data.sellerName} asked you to sign off on a loan`,
        text:
          `${data.sellerName} wants an upfront loan of ${data.amount} for ${data.orgName}, and asked you to sign off. ` +
          `If the payment never arrives, you cover what's left.\n\nReview and sign off: ${data.link}\n\nThis link expires ${data.expires}.${sign}`,
      };
    case "receivable_approved":
      return {
        to,
        subject: "Your loan was approved",
        text: `You're approved for ${usd(data.amount)}. Open it to get the loan before the approval expires: ${data.link}${sign}`,
      };
    case "receivable_funded":
      return {
        to,
        subject: "You got paid",
        text:
          `${usd(data.price)} of RLUSD is in your wallet. ` +
          `Pay ${usd(data.due)} back to the vault, with interest, by ${day(data.dueAt)}: ${data.link}${sign}`,
      };
    case "due_soon":
      return {
        to,
        subject: "Your loan payment is due within 14 days",
        text: `Pay ${usd(data.remaining)} back to the vault, with interest, by ${day(data.dueAt)}. Do it here: ${data.link}${sign}`,
      };
    case "guarantor_called":
      return {
        to,
        subject: "You're asked to cover a loan you signed off on",
        text:
          `The payer didn't pay a loan you signed off on in full. You cover the ${usd(data.remaining)} that's left. ` +
          `Pay it here: ${data.link}${sign}`,
      };
  }
}

export type { NotificationKind };
