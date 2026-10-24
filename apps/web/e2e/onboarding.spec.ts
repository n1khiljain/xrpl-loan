import { expect, test } from "@playwright/test";
import { ensureLinked, setUpAccount } from "./support/flows";
import { DESKTOP, api, openAs, person, screenshot, staff } from "./support/harness";

test("onboarding connects FraxNet through the OAuth callback, and Get reimbursed now waits until then (U-77)", async ({ browser }) => {
  const member = await person("onboard", "Riley Chen");
  const { page, context } = await openAs(browser, member);

  await page.goto("/");
  // the banner is off in every network config for now (U-66)
  await expect(page.getByTestId("testnet-banner")).toHaveCount(0);
  await screenshot(page, "claimant-00-landing");

  await setUpAccount(page, member, "claimant-01");
  await expect(page.getByTestId("kyc-status")).toHaveAttribute("data-status", "not_started");
  await expect(page.getByTestId("fraxnet-account")).toHaveText("Not connected");

  // before connecting, Connect FraxNet is the one way in; someone new makes their account in the tab it opens
  await expect(page.getByTestId("connect-fraxnet")).toBeVisible();
  await expect(page.getByTestId("verify-fraxnet")).toHaveCount(0);
  // until connecting adds it, the wallet this app made is shown to paste if FraxNet asks (U-78)
  await expect(page.getByTestId("wallet-address")).toHaveText(member.address);

  // the server refuses a reimbursement before verification, whatever the screen shows
  await expect(api("claims", member.token, { body: { orgId: 1, faceValue: "1", requestedAmount: "1", callinkPrNumber: "PR-refused" } })).rejects.toThrow(/403.*kyc_required/);
  await page.goto("/claims/new/");
  await expect(page.getByTestId("verify-first")).toBeVisible();

  // a callback without FraxNet's answer, or after cancelling on FraxNet, says so and connects nothing
  await page.goto("/fraxnet/callback/?error=access_denied&state=x");
  await expect(page.getByTestId("fraxnet-callback-error")).toContainText("You cancelled on FraxNet");
  await page.goto("/fraxnet/callback/?code=forged&state=" + "s".repeat(43));
  await expect(page.getByTestId("fraxnet-callback-error")).toContainText("expired or was already used");

  // Connect FraxNet: start saves the attempt server side and FraxNet opens in a new tab, where the mock sends it
  // straight back with a code. The callback finishes it there, tells this tab, and closes; this page never leaves.
  await page.goto("/onboard/");
  const finished = page.context().waitForEvent("response", (r) => r.url().endsWith("/functions/v1/fraxnet-connect") && r.request().method() === "POST" && r.request().postData()?.includes("finish") === true);
  const [tab] = await Promise.all([page.context().waitForEvent("page"), page.getByTestId("connect-fraxnet").click()]);
  const body = (await (await finished).json()) as { status: string; source: string; fraxnet: { verified: boolean } };
  expect(body).toMatchObject({ status: "approved", source: "fraxnet_api", fraxnet: { verified: true } });
  expect(JSON.stringify(body)).not.toMatch(/mock-(access|refresh)/);
  await tab.waitForEvent("close");
  await expect(page).toHaveURL(/\/onboard\/$/);
  await expect(page.getByTestId("kyc-status")).toHaveAttribute("data-status", "approved");
  await expect(page.getByTestId("wallet-added")).toHaveText("Added to FraxNet");
  await screenshot(page, "claimant-03-onboard-approved");

  // "Check again" asks FraxNet through the stored connection
  const again = page.waitForResponse((r) => r.url().endsWith("/functions/v1/kyc-status") && r.request().method() === "POST");
  await page.getByTestId("check-status").click();
  expect(((await (await again).json()) as { status: string }).status).toBe("approved");

  // the underwriter's KYC page still works as a fallback, and shows the FraxNet answer
  const underwriter = await staff();
  await ensureLinked(underwriter);
  const admin = await openAs(browser, underwriter, DESKTOP);
  await admin.page.goto("/admin/kyc/");
  await admin.page.getByLabel("Wallet").fill(member.address);
  await expect(admin.page.getByTestId("kyc-current")).toContainText(/approved/i);
  await admin.context.close();

  await page.goto("/claims/new/");
  await expect(page.getByTestId("verify-first")).toHaveCount(0);
  await page.goto("/claims/");
  await expect(page.getByText("No reimbursements yet.")).toBeVisible();
  await screenshot(page, "claimant-04-claims-empty");
  await context.close();
});
