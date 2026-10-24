/**
 * Security campaign E2: is KYC checked again when the underwriter approves? The approval itself is an onchain
 * Safe transaction; the only server input is `directory?view=people`, which the review queue reads to enable the
 * Approve button (apps/web/app/admin/page.tsx). Each test asserts the safe property.
 */
import { createMockFraxNetClient } from "@app/adapters";
import { assertEquals, assertNotEquals } from "@std/assert";
import { applyIdentity } from "../_shared/fraxnet.ts";
import { FIXED_NOW, MemoryDb, call, makeUser, verifier } from "../_shared/testing.ts";
import { createDirectoryHandler } from "./handler.ts";

// E-2f (fixed): the review queue's people lookup re-asks FraxNet for every connected member before it answers
Deno.test({
  name: "E2: the underwriter's review data reflects a verification FraxNet has since withdrawn",
  async fn() {
    const db = new MemoryDb(() => FIXED_NOW);
    const underwriter = await makeUser(db, { staff: "underwriter" });
    const member = await makeUser(db);
    const verified = createMockFraxNetClient({ appUrl: "https://net.frax.com", now: () => FIXED_NOW });
    const tokens = await verified.exchangeCode({ code: "mock-code.member", codeVerifier: "v", redirectUri: "https://app/" });
    const identity = await verified.getIdentity(tokens.accessToken);
    await db.upsertFraxnetConnection({
      wallet: member.wallet,
      fraxnetUserId: identity.userId,
      orgId: identity.org.id,
      orgName: identity.org.name,
      orgVerified: true,
      orgVerifiedAt: identity.org.verifiedAt,
      orgIsBusiness: false,
      email: null,
      scopes: tokens.scopes,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresAt: tokens.expiresAt,
      needsReconnect: false,
      walletAddedAt: null,
    });
    await applyIdentity(db, member.profile, identity, FIXED_NOW.toISOString());
    assertEquals((await db.getProfile(member.wallet))?.kycStatus, "approved");

    // later, FraxNet withdraws the organization's verification (the member never opens the app again)
    const revoked = createMockFraxNetClient({ appUrl: "https://net.frax.com", now: () => FIXED_NOW, org: { verified: false } });
    assertEquals((await revoked.getIdentity(tokens.accessToken)).org.verified, false);

    const handler = createDirectoryHandler({ auth: verifier, db, fraxnet: revoked, now: () => FIXED_NOW });
    const res = await call(handler, "GET", `http://localhost/directory?view=people&wallets=${member.wallet}`, { token: underwriter.token });
    const [person] = res.body.people as Array<{ kycStatus: string | null }>;
    assertNotEquals(person?.kycStatus, "approved");
  },
});
