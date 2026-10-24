import { bindingMessage } from "@app/adapters";
import { type Page, expect } from "@playwright/test";
import { type Hex, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type Person, api, ctx, receiptPdf, screenshot } from "./harness";

type Me = { profile: { wallet: string } | null; staffRole: string | null };

/** Links the wallet through the API when the account has no profile yet (for staff and fast setups). */
export async function ensureLinked(who: Person) {
  const me = await api<Me>("me", who.token);
  if (me.profile) return;
  const issuedAt = new Date().toISOString();
  const signature = await privateKeyToAccount(who.key).signMessage({ message: bindingMessage({ privyUserId: who.userId, wallet: who.address, issuedAt }) });
  await api("me", who.token, { method: "POST", body: { wallet: who.address, signature, issuedAt, email: who.email, displayName: who.name } });
}

/** First visit: the account setup card, filled in and confirmed with a wallet signature. */
export async function setUpAccount(page: Page, who: Person, shots?: string) {
  await page.goto("/onboard/");
  await expect(page.getByText("What should we call you?")).toBeVisible();
  // the email comes from sign-in, so setup only asks for a name
  await expect(page.getByText(`Updates go to ${who.email}`)).toBeVisible();
  await expect(page.getByLabel(/Email for updates/)).toHaveCount(0);
  await page.getByLabel("Your name").fill(who.name);
  if (shots) await screenshot(page, `${shots}-account-setup`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("kyc-status")).toBeVisible();
  if (shots) await screenshot(page, `${shots}-onboard-verify`);
}

/**
 * Clicks a Connect FraxNet button and waits for the tab it opens to finish. Locally the mock FraxNet sends that tab
 * straight to /fraxnet/callback/ with a code; fraxnet-connect marks the person verified, and the tab tells this page
 * and closes (U-77).
 */
export async function connectInNewTab(page: Page, testId: string) {
  const [tab] = await Promise.all([page.context().waitForEvent("page"), page.getByTestId(testId).click()]);
  await tab.waitForEvent("close", { timeout: 30_000 });
}

/** Connect FraxNet from the Verification screen. */
export async function connectFraxnet(page: Page, shots?: string) {
  await page.goto("/onboard/");
  await connectInNewTab(page, "connect-fraxnet");
  await expect(page).toHaveURL(/\/onboard\/$/);
  await expect(page.getByTestId("kyc-status")).toHaveAttribute("data-status", "approved");
  await expect(page.getByTestId("fraxnet-account")).not.toHaveText("Not connected");
  // connecting added the app wallet to FraxNet, so there's no address to paste (U-78)
  await expect(page.getByTestId("wallet-added")).toBeVisible();
  await expect(page.getByTestId("wallet-address")).toHaveCount(0);
  if (shots) await screenshot(page, `${shots}-fraxnet-connected`);
}

/** With one org it's picked for you; with several, click its pill the way a person would (the radio is hidden in it). */
export async function pickOrg(page: Page, orgName: string): Promise<void> {
  const picked = page.getByTestId("org-picked");
  await expect(picked.or(page.getByRole("radiogroup", { name: "Org" }))).toBeVisible();
  if (await picked.isVisible()) {
    await expect(picked).toContainText(orgName);
    return;
  }
  await page.getByText(orgName, { exact: true }).click();
  await expect(page.getByRole("radio", { name: orgName, exact: true })).toBeChecked();
}

export type ClaimInput = { orgName: string; face: string; callink: string; description: string; guarantor: Person };

/** The four-step wizard, from Details to "Send to <guarantor>". Returns the offchain claim ID. */
export async function sellClaim(page: Page, input: ClaimInput, shots?: string): Promise<string> {
  const shot = async (name: string) => (shots ? screenshot(page, `${shots}-${name}`) : undefined);
  await page.goto("/claims/new/");
  await pickOrg(page, input.orgName);
  await page.getByLabel("Amount on the purchase request").fill(input.face);
  // the most you can get is filled in for you
  await expect(page.getByTestId("get-now")).toContainText(`$${Number(input.face).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  await page.getByLabel("CalLink purchase request number").fill(input.callink);
  await page.getByLabel("What was it for?").fill(input.description);
  await shot("1-details");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("Add your receipts")).toBeVisible();
  await page.locator("#receipts").setInputFiles(receiptPdf(input.callink));
  await expect(page.getByTestId("receipt-list")).toContainText("Receipt 1 uploaded");
  await shot("2-receipts");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("radio", { name: new RegExp(input.guarantor.name) }).click();
  await shot("3-guarantor");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("Review and send")).toBeVisible();
  await shot("4-review");
  await page.getByTestId("send-to-guarantor").click();
  await page.waitForURL(/\/claim\/\?id=/);
  return new URL(page.url()).searchParams.get("id") as string;
}

/** On the claim page while the guarantor hasn't signed: resend and read the link to hand them. */
export async function inviteLink(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Send the link again" }).click();
  const link = await page.getByTestId("invite-link").textContent();
  expect(link).toContain("/guarantee");
  const url = new URL(link as string);
  return `${url.pathname}${url.search}`;
}

export async function signGuaranty(page: Page, invitePath: string, shots?: string) {
  await page.goto(invitePath);
  await expect(page.getByTestId("obligation")).toBeVisible();
  if (shots) await screenshot(page, `${shots}-sign`);
  await page.getByTestId("sign-guaranty").click();
  await expect(page.getByTestId("signed")).toBeVisible();
  if (shots) await screenshot(page, `${shots}-signed`);
}

export async function expectState(page: Page, state: string) {
  await expect(page.getByTestId("claim-action")).toHaveAttribute("data-state", state, { timeout: 45_000 });
}

/** Draft to guaranty through the API, for specs whose subject starts later in the lifecycle. */
export async function draftWithGuaranty(claimant: Person, guarantor: Person, orgId: bigint, callink: string, amount = "300", description = `Supplies ${callink}`): Promise<string> {
  const { claim } = await api<{ claim: { id: string } }>("claims", claimant.token, {
    body: { orgId: Number(orgId), recipientType: "member", faceValue: parseEther(amount).toString(), requestedAmount: parseEther(amount).toString(), callinkPrNumber: callink, description },
  });
  const file = receiptPdf(callink);
  const created = await api<{ document: { id: string }; upload: { path: string; token: string } }>("documents", claimant.token, {
    body: { action: "create", claimId: claim.id, mimeType: file.mimeType, sizeBytes: file.buffer.byteLength },
  });
  const c = ctx();
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }));
  const up = await fetch(`${c.apiUrl}/storage/v1/object/upload/sign/receipts/${created.upload.path}?token=${created.upload.token}`, {
    method: "PUT",
    body: form,
    headers: { apikey: c.anonKey, authorization: `Bearer ${c.anonKey}`, "x-upsert": "false" },
  });
  expect(up.ok).toBe(true);
  await api("documents", claimant.token, { body: { action: "confirm", documentId: created.document.id } });
  await api("claims", claimant.token, { method: "PATCH", body: { id: claim.id, guarantorWallet: guarantor.address } });
  await api("packet", claimant.token, { body: { claimId: claim.id } });
  const invite = await api<{ inviteUrl: string }>("guarantor-invite", claimant.token, { body: { claimId: claim.id } });
  const token = new URL(invite.inviteUrl).searchParams.get("invite") as string;
  const opened = await api<{ typedData: { domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; message: Record<string, string> } }>(
    "guarantor-invite",
    guarantor.token,
    { query: `?invite=${token}` },
  );
  const t = opened.typedData;
  const message = Object.fromEntries(Object.entries(t.message).map(([k, v]) => [k, /^[0-9]+$/.test(v) ? BigInt(v) : v]));
  const signature = await privateKeyToAccount(guarantor.key).signTypedData({ domain: t.domain, types: t.types, primaryType: "Guaranty", message } as never);
  await api("guaranty", guarantor.token, { body: { claimId: claim.id, signature: signature as Hex, nonce: t.message.nonce, deadline: t.message.deadline, invite: token } });
  return claim.id;
}

/** Sets a KYC status the way an underwriter does when FraxNet can't answer (U-07, U-36). */
export async function markKyc(staffToken: string, wallet: string, status: "approved" | "pending" | "rejected" = "approved") {
  await api("kyc-manual", staffToken, { body: { wallet, status, note: "e2e: confirmed on net.frax.com" } });
}
