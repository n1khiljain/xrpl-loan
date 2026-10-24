import { readFileSync } from "node:fs";
import { CLAIM_STATES } from "@app/adapters";
import { expect, test } from "@playwright/test";
import { parseEther } from "viem";
import { draftWithGuaranty, ensureLinked, expectState, markKyc, setUpAccount } from "./support/flows";
import { DESKTOP, RUN, addOrg, deployed, ensurePoolCash, executeAsSafe, mintFrxUsd, onchainClaim, openAs, person, screenshot, staff, sync } from "./support/harness";

type TxBuilderFile = {
  version: string;
  chainId: string;
  meta: { name: string; txBuilderVersion: string };
  transactions: { to: string; value: string; data: string; contractMethod: null }[];
};

test("approve through a Transaction Builder file, ASUC rejects, the attester calls the guarantor, and the guarantor pays to Recovered", async ({ browser }) => {
  const claimant = await person("exc-claimant", "Alex Morgan");
  const guarantor = await person("exc-guarantor", "Taylor Brooks");
  const underwriter = await staff();
  await ensureLinked(underwriter);
  const orgId = await addOrg(`Debate Society ${RUN}`, [guarantor.address]);
  await ensurePoolCash(parseEther("1000"));

  const g = await openAs(browser, guarantor);
  await setUpAccount(g.page, guarantor);
  const c = await openAs(browser, claimant);
  await setUpAccount(c.page, claimant);
  await markKyc(underwriter.token, claimant.address);
  await markKyc(underwriter.token, guarantor.address);

  const callink = `PR-${RUN}-B`;
  const claimId = await draftWithGuaranty(claimant, guarantor, orgId, callink, "300");
  await c.page.goto(`/claim/?id=${claimId}`);
  await c.page.getByTestId("submit-claim").click();
  await expectState(c.page, "Submitted");
  await sync();

  // underwriter outside the Safe App: download the Transaction Builder batch and have the Safe execute it
  const admin = await openAs(browser, underwriter, DESKTOP);
  await admin.page.goto("/admin/");
  const card = admin.page.locator('[data-testid^="review-"]', { hasText: callink });
  await expect(card).toBeVisible({ timeout: 45_000 });
  const onchainId = BigInt(((await card.getAttribute("data-testid")) as string).replace("review-", ""));
  const approve = card.getByTestId("safe-action").first();
  await expect(approve).toHaveAttribute("data-mode", "outside-safe");
  const [download] = await Promise.all([admin.page.waitForEvent("download"), approve.getByTestId("download-tx-builder").click()]);
  expect(download.suggestedFilename()).toBe(`approve-reimbursement-${onchainId}.json`);
  const file = JSON.parse(readFileSync(await download.path(), "utf8")) as TxBuilderFile;
  expect(file).toMatchObject({ version: "1.0", chainId: "31337", meta: { name: `Approve reimbursement ${onchainId}`, txBuilderVersion: "1.16.5" } });
  expect(file.transactions).toHaveLength(1);
  expect(file.transactions[0]).toMatchObject({ to: deployed.claimRegistry, value: "0", contractMethod: null });
  await executeAsSafe(file.transactions);
  expect(CLAIM_STATES[(await onchainClaim(onchainId)).state]).toBe("Approved");

  // claimant gets paid, then ASUC rejects the reimbursement
  await expectState(c.page, "Approved");
  await c.page.getByTestId("get-paid").click();
  await expectState(c.page, "Funded");
  await sync();
  await c.page.getByTestId("report-outcome").click();
  await c.page.getByRole("radio", { name: "ASUC rejected it" }).click();
  await c.page.getByLabel("Anything the reviewer should know (optional)").fill("ASUC said the receipts were for the wrong semester.");
  await screenshot(c.page, "claimant-20-report-asuc-problem");
  await c.page.getByTestId("send-report").click();
  await expect(c.page.getByText("You reported ASUC rejected this")).toBeVisible();
  await screenshot(c.page, "claimant-21-reported-rejected");

  // attester: the exception queue suggests AsucRejected; this wallet holds the role on local, so it sends directly
  await admin.page.goto("/admin/exceptions/");
  const exception = admin.page.getByTestId(`exception-${onchainId}`);
  await expect(exception).toContainText("Member reported ASUC rejected it", { timeout: 45_000 });
  await expect(exception.getByRole("combobox", { name: "Call reason" })).toContainText(/ASUC rejected/i);
  await exception.getByTestId("send-direct").click();
  await expect.poll(async () => CLAIM_STATES[(await onchainClaim(onchainId)).state], { timeout: 30_000 }).toBe("GuarantorCalled");
  expect((await onchainClaim(onchainId)).callReason).toBe(1);
  await admin.context.close();
  await sync();

  // claimant sees the guarantor was called
  await expectState(c.page, "GuarantorCalled");
  await screenshot(c.page, "claimant-22-guarantor-called");

  // guarantor pays what's left
  await mintFrxUsd(guarantor.address, parseEther("300"));
  await g.page.goto(`/claim/?id=${claimId}`);
  await expectState(g.page, "GuarantorCalled");
  await expect(g.page.getByText("You signed off, so you cover what's left.")).toBeVisible();
  await expect(g.page.getByTestId("settle")).toBeEnabled();
  await screenshot(g.page, "guarantor-07-called-to-pay");
  await g.page.getByTestId("settle").click();
  await expectState(g.page, "Recovered");
  expect(CLAIM_STATES[(await onchainClaim(onchainId)).state]).toBe("Recovered");
  await screenshot(g.page, "guarantor-08-recovered");

  await c.page.reload();
  await expectState(c.page, "Recovered");
  await screenshot(c.page, "claimant-23-recovered");
  await c.context.close();
  await g.context.close();
});
