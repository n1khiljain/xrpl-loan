import { expect, test } from "@playwright/test";
import { parseEther } from "viem";
import { receivablesPoolAbi } from "@app/abi";
import { DESKTOP, allowLender, chainClient, deployed, mintFrxUsd, openAs, person, screenshot } from "./support/harness";

test("a lender is allowlisted, deposits frxUSD, and withdraws part of it", async ({ browser }) => {
  const lender = await person("lender", "Pilot lender");
  await mintFrxUsd(lender.address, parseEther("1000"));
  const { page, context } = await openAs(browser, lender, DESKTOP);

  await page.goto("/lend/");
  await expect(page.getByTestId("pool-stats")).toBeVisible();
  await expect(page.getByText("This wallet isn't on the lender allowlist")).toBeVisible();
  await expect(page.getByTestId("deposit")).toBeDisabled();

  await allowLender(lender.address);
  await page.reload();
  await expect(page.getByTestId("wallet-balance")).toHaveText("$1,000.00");
  const totalBefore = await chainClient.readContract({ address: deployed.pool, abi: receivablesPoolAbi, functionName: "totalAssets" });

  await page.getByLabel("Deposit ($)").fill("500");
  await page.getByTestId("deposit").click();
  await expect(page.getByTestId("position-value")).toHaveText(/\$(499\.99|500\.00)/);
  await expect(page.getByTestId("wallet-balance")).toHaveText("$500.00");
  const totalAfter = await chainClient.readContract({ address: deployed.pool, abi: receivablesPoolAbi, functionName: "totalAssets" });
  expect(totalAfter - totalBefore).toBe(parseEther("500"));
  await screenshot(page, "lender-01-deposited");

  await page.getByLabel("Withdraw ($)").fill("200");
  await page.getByTestId("withdraw").click();
  await expect(page.getByTestId("wallet-balance")).toHaveText("$700.00");
  await expect(page.getByTestId("position-value")).toHaveText(/\$(299\.99|300\.00)/);
  await screenshot(page, "lender-02-withdrew");

  // more than is withdrawable says why and never sends
  await page.getByLabel("Withdraw ($)").fill("10000");
  await expect(page.getByText("Over what's withdrawable")).toBeVisible();
  await expect(page.getByTestId("withdraw")).toBeDisabled();
  await context.close();
});
