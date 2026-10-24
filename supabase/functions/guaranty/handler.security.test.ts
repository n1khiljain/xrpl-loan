/**
 * Security campaign E3: what does the guarantor's signature bind? packetHash omits requestedAmount, the guarantor
 * and recipientType (_shared/packet.ts), so this checks those are frozen with the packet and that the EIP-712
 * guaranty itself binds the amount and recipient even if the database is edited behind isEditable.
 */
import { requireDeployed } from "@app/config";
import { assertEquals } from "@std/assert";
import type { Address } from "viem";
import { verifyTypedData } from "viem";
import { createClaimsHandler } from "../claims/handler.ts";
import { assertStatus, draftWorld } from "../_shared/fixtures.ts";
import { guarantyTypedData } from "../_shared/guaranty.ts";
import { FIXED_NOW, call, verifier } from "../_shared/testing.ts";
import { createPacketHandler } from "../packet/handler.ts";

const USD = 10n ** 18n;

async function frozen() {
  const w = await draftWorld();
  const packet = createPacketHandler({ auth: verifier, db: w.db, config: w.config, registry: w.registry, now: () => FIXED_NOW });
  assertStatus(await call(packet, "POST", "http://localhost/packet", { token: w.claimant.token, body: { claimId: w.claim.id } }), 200);
  return w;
}

Deno.test("E3: after the packet is frozen, requestedAmount, guarantor and recipientType can't be edited", async () => {
  const w = await frozen();
  const claims = createClaimsHandler({ auth: verifier, db: w.db, config: w.config });
  for (const patch of [{ requestedAmount: (100n * USD).toString() }, { guarantorWallet: w.outsider.wallet }, { recipientType: "org_treasurer" }]) {
    assertStatus(await call(claims, "PATCH", "http://localhost/claims", { token: w.claimant.token, body: { id: w.claim.id, ...patch } }), 409, "frozen");
  }
  const claim = await w.db.getClaim(w.claim.id);
  assertEquals([claim?.requestedAmount, claim?.guarantorWallet, claim?.recipientType], [w.claim.requestedAmount, w.guarantor.wallet, "member"]);
});

Deno.test("E3: a database edit behind isEditable doesn't carry the guarantor's signature to a new amount or recipient", async () => {
  const w = await frozen();
  const claim = await w.db.getClaim(w.claim.id);
  if (!claim?.packetHash) throw new Error("not frozen");
  const registry = requireDeployed(w.config).claimRegistry;
  const message = {
    guarantor: w.guarantor.account.address,
    recipient: w.claimant.account.address,
    orgId: BigInt(claim.orgId),
    faceValue: BigInt(claim.faceValue),
    requestedAmount: BigInt(claim.requestedAmount),
    packetHash: claim.packetHash,
    nonce: 0n,
    deadline: BigInt(Math.floor(FIXED_NOW.getTime() / 1000) + 3600),
  };
  const signed = guarantyTypedData({ chainId: w.config.chainId, registry, message });
  const signature = await w.guarantor.account.signTypedData(signed);
  const check = (m: typeof message) => verifyTypedData({ address: w.guarantor.account.address, signature, ...guarantyTypedData({ chainId: w.config.chainId, registry, message: m }) });

  assertEquals(await check(message), true);
  // the service role rewrites the row; ClaimRegistry rebuilds the digest from what the claimant submits
  await w.db.updateClaim(claim.id, { requestedAmount: (500n * USD).toString() });
  assertEquals(await check({ ...message, requestedAmount: 500n * USD }), false);
  assertEquals(await check({ ...message, recipient: w.outsider.account.address as Address }), false);
  assertEquals(await check({ ...message, faceValue: 5000n * USD }), false);
  // and a guaranty for another chain or registry is a different digest
  const foreign = guarantyTypedData({ chainId: 252, registry: "0x000000000000000000000000000000000000dEaD", message });
  assertEquals(await verifyTypedData({ address: w.guarantor.account.address, signature, ...foreign }), false);
});
