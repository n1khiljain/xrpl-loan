import { claimRegistryAbi } from "@app/abi";
import { expect, test } from "@playwright/test";
import { parseEther } from "viem";
import { ensureLinked } from "./support/flows";
import { DESKTOP, RUN, addOrg, chainClient, deployed, openAs, staff } from "./support/harness";

// U-69: the admin gives one org its own cap from the orgs page, then puts it back on the default.

const orgCap = (orgId: bigint) =>
  chainClient.readContract({ address: deployed.claimRegistry, abi: claimRegistryAbi, functionName: "orgCap", args: [orgId] });

test("admin sets and clears one org's cap", async ({ browser }) => {
  const admin = await staff();
  await ensureLinked(admin);
  const orgId = await addOrg(`Cap org ${RUN}`, []);
  const perOrgCap = await orgCap(orgId);

  const { page, context } = await openAs(browser, admin, DESKTOP);
  await page.goto("/admin/orgs/");
  const card = page.getByTestId(`org-${orgId}`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("Default cap");
  const setCap = card.getByTestId("org-cap-editor");

  await card.getByLabel("Org cap ($)").fill("50,000");
  await setCap.getByTestId("send-direct").click();
  await expect(card.getByTestId("org-cap")).toHaveText("$0.00 of $50,000.00", { timeout: 30_000 });
  await expect(card).toContainText("Custom cap for this org");
  expect(await orgCap(orgId)).toBe(parseEther("50000"));

  await card.getByLabel("Org cap ($)").fill("0");
  await setCap.getByTestId("send-direct").click();
  await expect(card).toContainText("Default cap", { timeout: 30_000 });
  expect(await orgCap(orgId)).toBe(perOrgCap);
  await context.close();
});
