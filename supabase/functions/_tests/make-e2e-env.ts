/**
 * Writes a throwaway env file and Privy key for the e2e test into a directory outside the repo:
 *   deno run --allow-write --allow-run --config supabase/functions/deno.json supabase/functions/_tests/make-e2e-env.ts <dir>
 * The Privy key is made fresh each time; PAYOUT_PRIVATE_KEY is anvil's public dev account 9, derived here so no
 * key is ever written in the repo. Local anvil only.
 */
import { exportJWK, exportSPKI, generateKeyPair } from "jose";
import { toHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";

const dir = Deno.args[0];
if (!dir) throw new Error("usage: make-e2e-env.ts <output dir>");

const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
await Deno.writeTextFile(`${dir}/privy-test.jwk.json`, JSON.stringify(await exportJWK(privateKey)));
const pem = (await exportSPKI(publicKey)).trim().replace(/\n/g, "\\n");
const payout = mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: 9 });
const payoutKey = payout.getHdKey().privateKey;
if (!payoutKey) throw new Error("could not derive the anvil payout key");

await Deno.writeTextFile(
  `${dir}/functions.env`,
  [
    "NETWORK=local",
    "RPC_URL=http://host.docker.internal:8545",
    "PRIVY_APP_ID=local-e2e-app",
    `PRIVY_VERIFICATION_KEY=${pem}`,
    "APP_BASE_URL=http://localhost:3000",
    `CHAIN_SYNC_SECRET=${crypto.randomUUID()}`,
    `FRAXNET_WEBHOOK_SECRET=${crypto.randomUUID()}`,
    "EMAIL_FROM=college@example.test",
    `PAYOUT_PRIVATE_KEY=${toHex(payoutKey)}`,
  ].join("\n") + "\n",
);
console.log(`wrote ${dir}/functions.env and ${dir}/privy-test.jwk.json`);
