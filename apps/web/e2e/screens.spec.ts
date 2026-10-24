import { expect, test } from "@playwright/test";
import { parseEther } from "viem";
import { ensureLinked } from "./support/flows";
import { PHONE, allowLender, mintFrxUsd, openAs, person, screenshot, staff } from "./support/harness";

// Runs after the flow specs (files run in name order on one worker), so the admin pages have claims, exceptions,
// orgs, and lenders to show. Every screenshot here is saved at 375px and 1440px.

test("admin screens at phone and desktop width", async ({ browser }) => {
  const underwriter = await staff();
  await ensureLinked(underwriter);
  const { page, context } = await openAs(browser, underwriter, PHONE);
  const pages: [string, string, string][] = [
    ["/admin/", "admin-01-review-queue", "Review queue"],
    ["/admin/exceptions/", "admin-02-exceptions", "Exceptions"],
    ["/admin/params/", "admin-03-parameters", "Parameters"],
    ["/admin/orgs/", "admin-04-orgs", "Orgs and officers"],
    ["/admin/kyc/", "admin-05-kyc", "KYC"],
    ["/admin/lenders/", "admin-06-lenders", "Lenders"],
  ];
  for (const [path, name, heading] of pages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(heading, "i") })).toBeVisible();
    await screenshot(page, name);
  }
  await context.close();
});

test("lender screens at phone and desktop width", async ({ browser }) => {
  const lender = await person("screens-lender", "Pilot lender");
  await mintFrxUsd(lender.address, parseEther("2000"));
  await allowLender(lender.address);
  const { page, context } = await openAs(browser, lender, PHONE);
  await page.goto("/lend/");
  await expect(page.getByTestId("pool-stats")).toBeVisible();
  await screenshot(page, "lender-10-pool");
  await page.goto("/lend/?view=deposit");
  await expect(page.getByTestId("deposit")).toBeVisible();
  await screenshot(page, "lender-11-deposit");
  await context.close();
});

test("the sign-in screen at phone and desktop width", async ({ browser }) => {
  const context = await browser.newContext({ viewport: PHONE, baseURL: "http://localhost:3000" });
  const page = await context.newPage();
  await page.goto("/claims/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await screenshot(page, "claimant-00b-sign-in");
  await page.getByTestId("mode-sign-up").click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect(page.getByTestId("google-sign-in")).toBeVisible();
  await screenshot(page, "claimant-00c-create-account");
  await context.close();
});
