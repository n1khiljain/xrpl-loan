/**
 * Security campaign E2: can an unverified person get KYC "approved" through Connect FraxNet? Each test asserts the
 * safe property. The FINDING test (E-2a, blocked on Frax answering U-77) fails today and only runs with
 * SECURITY_FINDINGS=1.
 */
import { type FraxNetClient, type FraxNetIdentity, FraxNetAuthError, createMockFraxNetClient, pkceChallenge } from "@app/adapters";
import { assertEquals, assertNotEquals } from "@std/assert";
import { FIXED_NOW, MemoryDb, call, makeUser, verifier } from "../_shared/testing.ts";
import { createFraxnetConnectHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/fraxnet-connect";
const findings = !Deno.env.get("SECURITY_FINDINGS");

function handlerWith(db: MemoryDb, fraxnet: FraxNetClient) {
  return createFraxnetConnectHandler({ auth: verifier, db, fraxnet, appBaseUrl: "https://app.example.test/", walletChainId: 252, now: () => FIXED_NOW });
}

async function connectAndFinish(handler: ReturnType<typeof handlerWith>, token: string) {
  const started = await call(handler, "POST", ENDPOINT, { token, body: { action: "start" } });
  const back = new URL(started.body.authorizeUrl as string);
  return await call(handler, "POST", ENDPOINT, {
    token,
    body: { action: "finish", code: back.searchParams.get("code") ?? "", state: back.searchParams.get("state") ?? "" },
  });
}

/** The mock, but every FraxNet user it mints belongs to one verified organization, as FraxNet members of an org would. */
function sharedOrgClient(org: Partial<FraxNetIdentity["org"]> = {}): FraxNetClient {
  const mock = createMockFraxNetClient({ appUrl: "https://net.frax.com", now: () => FIXED_NOW });
  return {
    ...mock,
    getIdentity: async (token) => {
      const identity = await mock.getIdentity(token);
      return { ...identity, org: { ...identity.org, id: "org_verified_person", name: "Jordan Park", verified: true, isBusiness: false, ...org } };
    },
  };
}

// FINDING E-2a: KYC is per FraxNet organization. A second, distinct FraxNet user who picks the same verified org
// on the consent screen is approved too (fraxnet_connections.org_id is not unique; types.ts verificationFromIdentity)
Deno.test({
  name: "E2: two different FraxNet users in one verified organization are not both approved",
  ignore: findings,
  async fn() {
    const db = new MemoryDb();
    const alice = await makeUser(db);
    const mallory = await makeUser(db);
    const handler = handlerWith(db, sharedOrgClient());
    assertEquals((await connectAndFinish(handler, alice.token)).body.status, "approved");
    const res = await connectAndFinish(handler, mallory.token);
    const [a, m] = [await db.getFraxnetConnection(alice.wallet), await db.getFraxnetConnection(mallory.wallet)];
    assertNotEquals(a?.fraxnetUserId, m?.fraxnetUserId); // two different people
    assertEquals(a?.orgId, m?.orgId); // one organization
    assertNotEquals(res.body.status, "approved");
  },
});

// E-2b (fixed): only isBusiness === false counts as a person; unknown (null) stays pending
Deno.test({
  name: "E2: an organization with unknown isBusiness (null) does not approve KYC",
  async fn() {
    const db = new MemoryDb();
    const user = await makeUser(db);
    const res = await connectAndFinish(handlerWith(db, sharedOrgClient({ isBusiness: null })), user.token);
    assertNotEquals(res.body.status, "approved");
  },
});

/**
 * A FraxNet that enforces PKCE like a real authorization server: each code is bound to the challenge it was issued
 * for. The callback never reads an ID token (identity comes from GET /me with the access token), so the OIDC nonce
 * we store but never check has nothing to protect; PKCE with a server-held verifier is what stops code injection.
 */
function pkceEnforcingClient(): FraxNetClient & { mintCodeFor(challenge: string): string } {
  const mock = createMockFraxNetClient({ appUrl: "https://net.frax.com", now: () => FIXED_NOW });
  const challenges = new Map<string, string>();
  const mintCodeFor = (challenge: string) => {
    const code = `mock-code.${crypto.randomUUID()}`;
    challenges.set(code, challenge);
    return code;
  };
  return {
    ...mock,
    mintCodeFor,
    authorizeUrl(request) {
      const url = new URL(request.redirectUri);
      url.searchParams.set("code", mintCodeFor(request.codeChallenge));
      url.searchParams.set("state", request.state);
      return url.toString();
    },
    async exchangeCode(input) {
      if (challenges.get(input.code) !== (await pkceChallenge(input.codeVerifier))) throw new FraxNetAuthError("invalid_grant", "PKCE verification failed");
      challenges.delete(input.code);
      return await mock.exchangeCode(input);
    },
  };
}

Deno.test("E2: an authorization code issued to someone else's sign-in can't be finished on the victim's state (PKCE)", async () => {
  const db = new MemoryDb();
  const victim = await makeUser(db);
  const fraxnet = pkceEnforcingClient();
  const handler = handlerWith(db, fraxnet);

  // the attacker completes FraxNet sign-in for their own verified account and keeps the code
  const attackerCode = fraxnet.mintCodeFor(await pkceChallenge("attacker-verifier-".padEnd(43, "x")));
  // the victim's browser is tricked into posting that code with the victim's own fresh state
  const started = await call(handler, "POST", ENDPOINT, { token: victim.token, body: { action: "start" } });
  const state = new URL(started.body.authorizeUrl as string).searchParams.get("state") ?? "";
  const res = await call(handler, "POST", ENDPOINT, { token: victim.token, body: { action: "finish", code: attackerCode, state } });
  assertEquals([res.status, res.body.error?.code], [400, "fraxnet_rejected"]);
  assertEquals(await db.getFraxnetConnection(victim.wallet), null);

  // the honest flow still works with the same server
  assertEquals((await connectAndFinish(handler, victim.token)).body.status, "approved");
});
