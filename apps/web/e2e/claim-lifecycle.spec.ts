import { CLAIM_STATES } from "@app/adapters";
import { expect, test } from "@playwright/test";
import { erc20Abi, parseEther } from "viem";
import { connectFraxnet, connectInNewTab, ensureLinked, expectState, inviteLink, sellClaim, setUpAccount, signGuaranty } from "./support/flows";
import { DESKTOP, RUN, addOrg, chainClient, deployed, ensurePoolCash, executeAsSafe, onchainClaim, openAs, person, screenshot, staff, sync } from "./support/harness";
import { openInFakeSafe, proposals } from "./support/safe-host";

const balanceOf = (who: `0x${string}`) => chainClient.readContract({ address: deployed.frxUSD, abi: erc20Abi, functionName: "balanceOf", args: [who] });

test("a member sells a claim, the guarantor signs, the underwriter approves in the Safe App, and the claim settles", async ({ browser }) => {
  const claimant = await person("claimant", "Jordan Park");
  const guarantor = await person("guarantor", "Sam Rivera");
  const underwriter = await staff();
  await ensureLinked(underwriter);
  const orgName = `Robotics Club ${RUN}`;
  await addOrg(orgName, [guarantor.address]);
  await ensurePoolCash(parseEther("1000"));

  const g = await openAs(browser, guarantor);
  await setUpAccount(g.page, guarantor, "guarantor-01");

  const c = await openAs(browser, claimant);
  await setUpAccount(c.page, claimant);

  // claimant: "Get reimbursed now" waits for FraxNet, then Connect FraxNet from Verification (U-77)
  await c.page.goto("/claims/new/");
  await expect(c.page.getByTestId("verify-first")).toBeVisible();
  await screenshot(c.page, "claimant-05-verify-first");
  await connectFraxnet(c.page, "claimant-06");

  // claimant: the wizard, then the claim waits for the guarantor
  const claimId = await sellClaim(c.page, { orgName, face: "240", callink: `PR-${RUN}-A`, description: "Snacks for the fall hackathon", guarantor }, "claimant-10-wizard");
  await expectState(c.page, "Draft");
  await expect(c.page.getByText("Waiting for your officer to sign off.")).toBeVisible();
  const invite = await inviteLink(c.page);
  await screenshot(c.page, "claimant-11-waiting-for-guarantor");

  // guarantor: the claim page before signing points them to the email
  await g.page.goto(`/claim/?id=${claimId}`);
  await expect(g.page.getByText("Check your email for the link to sign off on this.")).toBeVisible();
  await screenshot(g.page, "guarantor-02-claim-before-signing");

  // guarantor: the emailed link asks them to connect FraxNet first, in a new tab, and unlocks in place after
  await g.page.goto(invite);
  await expect(g.page.getByTestId("verify-first")).toBeVisible();
  await screenshot(g.page, "guarantor-03-verify-first");
  await connectInNewTab(g.page, "verify-first-connect");
  await expect(g.page.getByTestId("obligation")).toBeVisible();
  expect(new URL(g.page.url()).pathname).toContain("/guarantee");

  // guarantor: sign
  await signGuaranty(g.page, invite, "guarantor-03-guarantee");
  await g.page.goto(`/claim/?id=${claimId}`);
  await expect(g.page.getByText("Nothing for you to cover right now.")).toBeVisible();
  await screenshot(g.page, "guarantor-04-claim-nothing-owed");

  // claimant: submit onchain
  await c.page.reload();
  await expect(c.page.getByTestId("submit-claim")).toBeVisible();
  await screenshot(c.page, "claimant-12-ready-to-submit");
  await c.page.getByTestId("submit-claim").click();
  await expectState(c.page, "Submitted");
  await screenshot(c.page, "claimant-13-in-review");
  await sync();

  // underwriter: the review queue inside the Safe App proposes approveClaim to the underwriter Safe
  const admin = await openAs(browser, underwriter, DESKTOP);
  const safeAddress = underwriter.address;
  const app = await openInFakeSafe(admin.page, "/admin/", safeAddress);
  const onchainId = await (async () => {
    const card = app.locator('[data-testid^="review-"]', { hasText: `PR-${RUN}-A` });
    await expect(card).toBeVisible({ timeout: 45_000 });
    return BigInt(((await card.getAttribute("data-testid")) as string).replace("review-", ""));
  })();
  const card = app.getByTestId(`review-${onchainId}`);
  await expect(card.getByTestId("kyc-member")).toHaveText("KYC approved");
  await expect(card.getByTestId("kyc-officer")).toHaveText("KYC approved");
  const approve = card.getByTestId("safe-action").first();
  await expect(approve).toHaveAttribute("data-mode", "safe");
  await approve.getByRole("button", { name: "Propose in Safe" }).click();
  await expect(approve.getByText("Waiting for the other signers")).toBeVisible();
  await screenshot(admin.page, "admin-review-in-safe");
  const proposed = await proposals(admin.page);
  expect(proposed).toHaveLength(1);
  expect(proposed[0]?.[0]?.to.toLowerCase()).toBe(deployed.claimRegistry.toLowerCase());
  await executeAsSafe(proposed[0] ?? []);
  expect(CLAIM_STATES[(await onchainClaim(onchainId)).state]).toBe("Approved");
  await admin.context.close();

  // claimant: get paid
  await expectState(c.page, "Approved");
  await screenshot(c.page, "claimant-14-approved");
  const before = await balanceOf(claimant.address);
  await c.page.getByTestId("get-paid").click();
  await expectState(c.page, "Funded");
  expect((await balanceOf(claimant.address)) - before).toBe(parseEther("240"));
  await screenshot(c.page, "claimant-15-paid-out");

  // claimant: simulated cash-out sends the whole balance to the sink
  const sinkBefore = await balanceOf("0x000000000000000000000000000000000000dEaD");
  await c.page.getByTestId("open-cash-out").click();
  await c.page.getByTestId("send-cash-out").click();
  await expect(c.page.getByTestId("cash-out-done")).toContainText("Testnet: simulated bank transfer");
  expect((await balanceOf("0x000000000000000000000000000000000000dEaD")) - sinkBefore).toBe(parseEther("240"));
  expect(await balanceOf(claimant.address)).toBe(0n);
  await screenshot(c.page, "claimant-16-cash-out-simulated");

  // claimant: ASUC pays (simulated), then settle in full
  await c.page.getByTestId("simulate-payout").click();
  await expect(c.page.getByText(/Testnet: ASUC payout simulated/)).toBeVisible();
  await expect(c.page.getByTestId("settle")).toBeEnabled();
  await screenshot(c.page, "claimant-17-payout-simulated");
  await c.page.getByTestId("settle").click();
  await expectState(c.page, "Settled");
  await expect(c.page.getByText("All closed out. Thank you.")).toBeVisible();
  expect(CLAIM_STATES[(await onchainClaim(onchainId)).state]).toBe("Settled");
  await screenshot(c.page, "claimant-18-settled");

  await c.page.goto("/claims/");
  await expect(c.page.getByTestId("claim-list")).toContainText("Closed out");
  await screenshot(c.page, "claimant-19-claims-list");

  await g.page.goto(`/claim/?id=${claimId}`);
  await expect(g.page.getByText("Closed out. Nothing for you to cover.")).toBeVisible();
  await screenshot(g.page, "guarantor-05-claim-settled");
  await g.page.goto("/claims/");
  await expect(g.page.getByTestId("claim-list")).toContainText("You signed off");
  await screenshot(g.page, "guarantor-06-claims-list");

  await c.context.close();
  await g.context.close();
});
