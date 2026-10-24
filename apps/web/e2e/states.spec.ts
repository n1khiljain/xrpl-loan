import { expect, test } from "@playwright/test";
import { draftWithGuaranty, ensureLinked, expectState, markKyc, setUpAccount } from "./support/flows";
import { DESKTOP, RUN, addOrg, openAs, person, screenshot, staff, sync } from "./support/harness";

test("a claimant cancels a claim in review, and an underwriter rejects another", async ({ browser }) => {
  const claimant = await person("st-claimant", "Casey Lin");
  const guarantor = await person("st-guarantor", "Morgan Diaz");
  const underwriter = await staff();
  await ensureLinked(underwriter);
  await ensureLinked(guarantor);
  const orgId = await addOrg(`Chess Club ${RUN}`, [guarantor.address]);

  const c = await openAs(browser, claimant);
  await setUpAccount(c.page, claimant);
  await markKyc(underwriter.token, claimant.address);
  await markKyc(underwriter.token, guarantor.address);

  const cancelId = await draftWithGuaranty(claimant, guarantor, orgId, `PR-${RUN}-C`, "120");
  await c.page.goto(`/claim/?id=${cancelId}`);
  await c.page.getByTestId("submit-claim").click();
  await expectState(c.page, "Submitted");
  await c.page.getByTestId("cancel-claim").click();
  await expectState(c.page, "Cancelled");
  await expect(c.page.getByText("You cancelled this request.")).toBeVisible();
  await screenshot(c.page, "claimant-30-cancelled");

  const rejectId = await draftWithGuaranty(claimant, guarantor, orgId, `PR-${RUN}-D`, "150");
  await c.page.goto(`/claim/?id=${rejectId}`);
  await c.page.getByTestId("submit-claim").click();
  await expectState(c.page, "Submitted");
  await sync();

  const admin = await openAs(browser, underwriter, DESKTOP);
  await admin.page.goto("/admin/");
  const card = admin.page.locator('[data-testid^="review-"]', { hasText: `PR-${RUN}-D` });
  await expect(card).toBeVisible({ timeout: 45_000 });
  await card.getByRole("combobox", { name: "Reject reason" }).click();
  await admin.page.getByRole("option").nth(1).click();
  await card.getByTestId("safe-action").nth(1).getByTestId("send-direct").click();
  await expect(card).toBeHidden({ timeout: 30_000 });
  await admin.context.close();

  await expectState(c.page, "Rejected");
  await expect(c.page.getByText("This wasn't approved.")).toBeVisible();
  await screenshot(c.page, "claimant-31-rejected");
  await c.context.close();
});
