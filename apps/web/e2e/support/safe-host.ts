import type { FrameLocator, Page } from "@playwright/test";
import type { Address } from "viem";

export type ProposedTx = { to: string; value: string; data: string };

/**
 * e2e/support/safe-host.html, served by global-setup on loopback so Chrome's local network access rules let it
 * frame the app. It is a different origin from localhost:3000, like safe.frax.com is from the app.
 */
export const SAFE_HOST = "http://127.0.0.1:4010";

/** Opens `path` as a Safe App inside the stand-in Safe UI. Proposed transactions stay on the host page. */
export async function openInFakeSafe(page: Page, path: string, safe: Address, chainId = 31_337): Promise<FrameLocator> {
  const query = new URLSearchParams({ app: `http://localhost:3000${path}`, safe, chainId: String(chainId) });
  await page.goto(`${SAFE_HOST}/?${query}`);
  return page.frameLocator("#app");
}

export async function proposals(page: Page): Promise<ProposedTx[][]> {
  return page.evaluate(() => (window as unknown as { __proposed: ProposedTx[][] }).__proposed);
}
