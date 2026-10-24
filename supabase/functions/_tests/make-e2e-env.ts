/**
 * Writes a throwaway env file and Privy test key for local development and tests into a directory outside the repo:
 *   deno run --allow-write --config supabase/functions/deno.json supabase/functions/_tests/make-e2e-env.ts <dir>
 * The Privy key and the wallet encryption key are made fresh each time, so no key is ever written in the repo.
 * Local stack only.
 */
import { exportJWK, exportSPKI, generateKeyPair } from "jose";

const dir = Deno.args[0];
if (!dir) throw new Error("usage: make-e2e-env.ts <output dir>");

const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
await Deno.writeTextFile(`${dir}/privy-test.jwk.json`, JSON.stringify(await exportJWK(privateKey)));
const pem = (await exportSPKI(publicKey)).trim().replace(/\n/g, "\\n");
const walletKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

await Deno.writeTextFile(
  `${dir}/functions.env`,
  [
    "NETWORK=xrpl-devnet",
    "PRIVY_APP_ID=local-e2e-app",
    `PRIVY_VERIFICATION_KEY=${pem}`,
    `WALLET_ENCRYPTION_KEY=${walletKey}`,
    "APP_BASE_URL=http://localhost:3000",
    "EMAIL_FROM=receivables@example.test",
  ].join("\n") + "\n",
);
console.log(`wrote ${dir}/functions.env and ${dir}/privy-test.jwk.json`);
