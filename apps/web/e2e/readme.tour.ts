import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { claimRegistryAbi, receivablesPoolAbi, mockFrxUsdAbi } from "@app/abi";
import { type Browser, type Page, expect, test } from "@playwright/test";
import { parseEther } from "viem";
import { draftWithGuaranty, ensureLinked, expectState, inviteLink, markKyc, pickOrg, sellClaim, setUpAccount, signGuaranty } from "./support/flows";
import { DESKTOP, type Person, addOrg, allowLender, deployer, deployed, mined, openAs, person, staff, sync } from "./support/harness";
import { ROOT } from "./support/paths";

// The screenshots in the README: the October 11 hackathon walked through with clean names. Blockchain at Berkeley
// sells its hackathon expenses to the pool under its own 50,000 cap (U-69); Cal Hacks stays on the default 10,000.
// Not part of `pnpm e2e`; run `pnpm --filter web readme-shots` against a fresh anvil and `supabase db reset`, so the
// only orgs and claims on screen are these.

const OUT = join(ROOT, "docs/screenshots");
const PHONE = { width: 390, height: 844 };

async function shot(page: Page, name: string, fullPage = false) {
  mkdirSync(OUT, { recursive: true });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0));
  // let the rise-ins, count-ups, and card swaps finish (U-75)
  await page.waitForTimeout(1500);
  const size = page.viewportSize();
  // a tall shot grows the viewport instead of using fullPage, so the phone tab bar sits at the bottom, not mid-page
  if (fullPage && size) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: size.width, height: Math.max(height, size.height) });
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: "jpeg", quality: 82, animations: "disabled" });
  if (fullPage && size) await page.setViewportSize(size);
}

async function as(browser: Browser, who: Person, viewport = DESKTOP) {
  return openAs(browser, who, viewport);
}

/** A readable person: the harness makes throwaway emails, which the sidebar would show. */
async function named(label: string, name: string, email: string): Promise<Person> {
  return { ...(await person(label, name)), email };
}

/** Approve a submitted claim from the admin review queue, outside the Safe, as the local underwriter. */
async function approve(page: Page, callink: string) {
  await page.goto("/admin/");
  const card = page.locator('[data-testid^="review-"]', { hasText: callink });
  await expect(card).toBeVisible({ timeout: 45_000 });
  await card.getByTestId("safe-action").first().getByTestId("send-direct").click();
  await expect(card).toBeHidden({ timeout: 45_000 });
}

async function submit(page: Page, claimId: string) {
  await page.goto(`/claim/?id=${claimId}`);
  await page.getByTestId("submit-claim").click();
  await expectState(page, "Submitted");
}

test("readme tour", async ({ browser }) => {
  test.setTimeout(600_000);

  // what a visitor sees first. The sign-in shot (00-sign-in-phone) comes from the hosted site instead, since this
  // local build has no Privy app and its buttons would be greyed out.
  const visitor = await browser.newContext({ viewport: DESKTOP, baseURL: "http://localhost:3000" });
  const landing = await visitor.newPage();
  await landing.goto("/");
  await shot(landing, "00-landing");
  await visitor.close();

  const underwriter = await staff();
  await ensureLinked(underwriter);
  const jordan = await named("jordan", "Jordan Park", "jordan.park@berkeley.edu");
  const sam = await named("sam", "Sam Rivera", "sam.rivera@berkeley.edu");
  const riya = await named("riya", "Riya Shah", "riya.shah@berkeley.edu");

  const bab = await addOrg("Blockchain at Berkeley", [sam.address]);
  await addOrg("Cal Hacks", [riya.address]);
  // B@B runs the hackathon and its own receivables this semester, so the admin Safe gives it 50,000
  await mined(deployer.writeContract({ address: deployed.claimRegistry, abi: claimRegistryAbi, functionName: "setOrgCap", args: [bab, parseEther("50000")] }));

  // Frax seeds the pool with 20,000
  const seed = parseEther("20000");
  await allowLender(deployer.account.address);
  await mined(deployer.writeContract({ address: deployed.frxUSD, abi: mockFrxUsdAbi, functionName: "mint", args: [deployer.account.address, seed] }));
  await mined(deployer.writeContract({ address: deployed.frxUSD, abi: mockFrxUsdAbi, functionName: "approve", args: [deployed.pool, seed] }));
  await mined(deployer.writeContract({ address: deployed.pool, abi: receivablesPoolAbi, functionName: "deposit", args: [seed, deployer.account.address] }));

  const s = await as(browser, sam, PHONE);
  await setUpAccount(s.page, sam);
  const r = await as(browser, riya, PHONE);
  await setUpAccount(r.page, riya);
  const j = await as(browser, jordan);
  await setUpAccount(j.page, jordan);
  for (const who of [jordan, sam, riya]) await markKyc(underwriter.token, who.address);

  // Jordan sells the hackathon catering claim through the wizard
  await j.page.goto("/claims/new/");
  await pickOrg(j.page, "Blockchain at Berkeley");
  await j.page.getByLabel("Amount on the purchase request").fill("2400");
  await j.page.getByLabel("CalLink purchase request number").fill("PR-2026-1011");
  await j.page.getByLabel("What was it for?").fill("Catering for the October 11 hackathon");
  await shot(j.page, "01-get-reimbursed", true);
  const catering = await sellClaim(j.page, { orgName: "Blockchain at Berkeley", face: "2400", callink: "PR-2026-1011", description: "Catering for the October 11 hackathon", guarantor: sam });

  // Sam gets the link and signs the guaranty on their phone
  const invite = await inviteLink(j.page);
  await s.page.goto(invite);
  await expect(s.page.getByTestId("obligation")).toBeVisible();
  await shot(s.page, "02-sign-off-phone", true);
  await signGuaranty(s.page, invite);

  // Jordan submits it; the underwriter reviews it
  await submit(j.page, catering);
  await sync();
  const admin = await as(browser, underwriter);
  await admin.page.goto("/admin/");
  await expect(admin.page.locator('[data-testid^="review-"]', { hasText: "PR-2026-1011" })).toBeVisible({ timeout: 45_000 });
  await shot(admin.page, "03-review-queue");
  await approve(admin.page, "PR-2026-1011");

  // Jordan gets paid
  await j.page.goto(`/claim/?id=${catering}`);
  await expectState(j.page, "Approved");
  await j.page.getByTestId("get-paid").click();
  await expectState(j.page, "Funded");
  await shot(j.page, "04-paid-out");

  // ASUC pays Jordan (a stand-in button on the local stack) and Jordan settles
  await j.page.getByTestId("simulate-payout").click();
  await expect(j.page.getByTestId("settle")).toBeEnabled();
  await j.page.getByTestId("settle").click();
  await expectState(j.page, "Settled");
  await shot(j.page, "05-closed-out");

  // the rest of the hackathon: two more paid out, one waiting for review
  for (const [callink, amount, what] of [
    ["PR-2026-1012", "1850", "Venue AV and livestream for the hackathon"],
    ["PR-2026-1013", "2500", "Prizes for the winning hackathon teams"],
  ] as const) {
    const id = await draftWithGuaranty(jordan, sam, bab, callink, amount, what);
    await submit(j.page, id);
    await sync();
    await approve(admin.page, callink);
    await j.page.goto(`/claim/?id=${id}`);
    await expectState(j.page, "Approved");
    await j.page.getByTestId("get-paid").click();
    await expectState(j.page, "Funded");
  }
  const swag = await draftWithGuaranty(jordan, sam, bab, "PR-2026-1014", "1200", "Hackathon T-shirts and swag");
  await submit(j.page, swag);
  await sync();

  await j.page.goto("/claims/");
  await expect(j.page.getByTestId("claim-list")).toContainText("Closed out");
  await shot(j.page, "06-member-home");
  const home = await as(browser, jordan, PHONE);
  await home.page.goto("/claims/");
  await expect(home.page.getByTestId("claim-list")).toContainText("Closed out");
  await shot(home.page, "06-member-home-phone");
  await home.context.close();

  const lender = await as(browser, underwriter);
  await lender.page.goto("/lend/");
  await expect(lender.page.getByTestId("pool-stats")).toBeVisible();
  await expect(lender.page.getByText("Blockchain at Berkeley").first()).toBeVisible();
  await shot(lender.page, "08-lender-pool");

  await admin.page.goto("/admin/orgs/");
  await expect(admin.page.getByTestId(`org-${bab}`)).toContainText("Custom cap for this org");
  await shot(admin.page, "07-org-caps", true);

  for (const c of [j, s, r, admin, lender]) await c.context.close();
});
