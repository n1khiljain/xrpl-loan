/**
 * Privy access- and identity-token verification. Each test asserts the safe property.
 */
import { assertRejects } from "@std/assert";
import { SignJWT, exportSPKI, generateKeyPair } from "jose";
import { createPrivyVerifier, privyJwksUrl } from "./auth.ts";

const APP_ID = "security-test-app";
const keys = await generateKeyPair("ES256", { extractable: true });
const verifier = createPrivyVerifier({ appId: APP_ID, verificationKey: await exportSPKI(keys.publicKey) });

function base() {
  return new SignJWT({ sid: "session" }).setProtectedHeader({ alg: "ES256", typ: "JWT" }).setIssuer("privy.io").setAudience(APP_ID).setSubject("did:privy:someone");
}

// E-6b (fixed): exp is a required claim
Deno.test({
  name: "E6: a Privy token without exp is rejected",
  async fn() {
    const token = await base().setIssuedAt().sign(keys.privateKey);
    await assertRejects(() => verifier.verify(token));
  },
});

// E-6b (fixed): maxTokenAge bounds how old a token may be, whatever its exp says
Deno.test({
  name: "E6: a Privy token issued a month ago is rejected even if exp is far away",
  async fn() {
    const now = Math.floor(Date.now() / 1000);
    const token = await base().setIssuedAt(now - 30 * 86_400).setExpirationTime(now + 365 * 86_400).sign(keys.privateKey);
    await assertRejects(() => verifier.verify(token));
  },
});

Deno.test("E6: a fresh token with exp and iat is accepted", async () => {
  const token = await base().setIssuedAt().setExpirationTime("1h").sign(keys.privateKey);
  await verifier.verify(token);
});

Deno.test("E6: alg none and HS256 tokens are rejected", async () => {
  const unsigned = `${btoa(JSON.stringify({ alg: "none", typ: "JWT" })).replace(/=+$/, "")}.${btoa(
    JSON.stringify({ iss: "privy.io", aud: APP_ID, sub: "did:privy:someone", exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).replace(/=+$/, "")}.`;
  await assertRejects(() => verifier.verify(unsigned));
  const hs = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setIssuer("privy.io").setAudience(APP_ID).setSubject("did:privy:someone").setExpirationTime("1h").sign(new TextEncoder().encode("k".repeat(32)));
  await assertRejects(() => verifier.verify(hs));
});

Deno.test("an access token is not accepted as an identity token", async () => {
  const token = await base().setIssuedAt().setExpirationTime("1h").sign(keys.privateKey);
  await assertRejects(() => verifier.verifyIdentity(token));
});

Deno.test("an identity token signed by another key is rejected", async () => {
  const other = await generateKeyPair("ES256", { extractable: true });
  const token = await new SignJWT({ linked_accounts: JSON.stringify([{ type: "email", address: "a@example.test" }]) })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuer("privy.io")
    .setAudience(APP_ID)
    .setSubject("did:privy:someone")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(other.privateKey);
  await assertRejects(() => verifier.verifyIdentity(token));
});

Deno.test("identity tokens give the email and Google addresses, lowercased", async () => {
  const token = await new SignJWT({
    linked_accounts: JSON.stringify([
      { type: "email", address: "Ada@Example.test" },
      { type: "google_oauth", email: "ada@gmail.test" },
      { type: "wallet", address: "0xabc" },
    ]),
  })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuer("privy.io")
    .setAudience(APP_ID)
    .setSubject("did:privy:someone")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(keys.privateKey);
  const identity = await verifier.verifyIdentity(token);
  if (identity.verifiedEmails.join() !== "ada@example.test,ada@gmail.test") throw new Error(identity.verifiedEmails.join());
});

Deno.test("without a pinned key, tokens are checked against the app's published Privy JWKS", () => {
  if (privyJwksUrl("cm-app").href !== "https://auth.privy.io/api/v1/apps/cm-app/jwks.json") throw new Error(privyJwksUrl("cm-app").href);
});
