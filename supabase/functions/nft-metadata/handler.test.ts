import { assert, assertEquals } from "@std/assert";
import { FakeChain } from "../_shared/fake-chain.ts";
import { MemoryDb, call, makeUser, privyToken, seedOrg } from "../_shared/testing.ts";
import { createNftMetadataHandler } from "./handler.ts";

const BASE = "http://localhost/nft-metadata";

Deno.test("nft-metadata is public: it answers without a Privy token (U-49)", async () => {
  const db = new MemoryDb();
  seedOrg(db, 1, "Blockchain at Berkeley");
  const chain = new FakeChain();
  chain.set(12n);
  const handler = createNftMetadataHandler({ chain, db });
  const res = await call(handler, "GET", `${BASE}/12`);
  assertEquals(res.status, 200);
  // a token changes nothing, valid or not
  const withToken = await call(handler, "GET", `${BASE}/12`, { token: await privyToken("did:privy:x", { expiresIn: "-1m" }) });
  assertEquals(withToken.body, res.body);
});

Deno.test("metadata has state, org, amounts, and dates, and no personal data (FR-B8)", async () => {
  const db = new MemoryDb();
  const claimant = await makeUser(db, { email: "ada@example.test", name: "Ada Lovelace" });
  seedOrg(db, 1, "Blockchain at Berkeley", [claimant.wallet]);
  const chain = new FakeChain();
  chain.set(12n, { recipient: claimant.account.address, amountPaid: 100n * 10n ** 18n, amountRemaining: 300n * 10n ** 18n });
  const res = await call(createNftMetadataHandler({ chain, db }), "GET", `${BASE}/12`);
  assertEquals(res.body.name, "College claim #12");
  const traits = Object.fromEntries((res.body.attributes as Array<{ trait_type: string; value: unknown }>).map((a) => [a.trait_type, a.value]));
  assertEquals(traits, {
    State: "Purchased",
    Org: "Blockchain at Berkeley",
    "Face value": "$500.00",
    "Purchase price": "$400.00",
    "Amount due": "$400.00",
    "Amount paid": "$100.00",
    Purchased: 1_790_100_000,
    Due: 1_805_652_000,
  });
  const text = JSON.stringify(res.body).toLowerCase();
  for (const secret of [claimant.wallet, "ada", "example.test", "pr-", "0x"]) assert(!text.includes(secret), `leaks ${secret}`);
});

Deno.test("unknown or malformed IDs are 404 and 400", async () => {
  const handler = createNftMetadataHandler({ chain: new FakeChain(), db: new MemoryDb() });
  assertEquals((await call(handler, "GET", `${BASE}/99`)).status, 404);
  assertEquals((await call(handler, "GET", `${BASE}/abc`)).status, 400);
  assertEquals((await call(handler, "GET", `${BASE}/0`)).status, 400);
  assertEquals((await call(handler, "POST", `${BASE}/1`)).status, 405);
});
