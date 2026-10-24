/**
 * The whole claim lifecycle through the served functions, the real database and storage, and the real contracts
 * on anvil: link wallets, mirror the org, draft, upload, freeze, invite, guarantee, submit, approve, purchase,
 * simulate the ASUC payout, settle, and read the NFT metadata.
 *
 * Needs `anvil` on :8545 with `Deploy.s.sol` run for local, and `supabase functions serve --env-file <file>`.
 * `E2E_ENV_FILE` is that env file and `E2E_PRIVY_JWK` the private JWK whose public key is its
 * PRIVY_VERIFICATION_KEY. See docs/RUNBOOK.md. Skipped when either is unset.
 */
import { claimRegistryAbi, mockFrxUsdAbi, orgRegistryAbi, receivablesPoolAbi } from "@app/abi";
import { createCashOut } from "@app/adapters";
import { loadNetworkConfig, requireDeployed } from "@app/config";
import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { type JWK, SignJWT, importJWK } from "jose";
import { type Hex, createPublicClient, createWalletClient, http, parseEther } from "viem";
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { bindingMessage } from "../_shared/auth.ts";
import { LOCAL_STACK } from "../_shared/local-stack.ts";
import { ensureLocalUnderwriter } from "./local-underwriter.ts";

const ENV_FILE = Deno.env.get("E2E_ENV_FILE");
const JWK_FILE = Deno.env.get("E2E_PRIVY_JWK");
const RPC = "http://127.0.0.1:8545";

Deno.test({
  name: "e2e: a claim goes from draft to settled through the served functions and the contracts",
  ignore: !ENV_FILE || !JWK_FILE || LOCAL_STACK === null,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const env = Object.fromEntries(
      (await Deno.readTextFile(ENV_FILE!)).split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );
    const key = await importJWK(JSON.parse(await Deno.readTextFile(JWK_FILE!)) as JWK, "ES256");
    const stack = LOCAL_STACK!;
    const fn = `${stack.url}/functions/v1`;
    const config = loadNetworkConfig("local");
    const deployed = requireDeployed(config);
    const chain = { ...foundry, rpcUrls: { default: { http: [RPC] } } };
    const pub = createPublicClient({ chain, transport: http(RPC), pollingInterval: 100 });
    const rand = crypto.randomUUID().slice(0, 8);

    const token = (sub: string) =>
      new SignJWT({ sid: "e2e" })
        .setProtectedHeader({ alg: "ES256", typ: "JWT" })
        .setIssuer("privy.io")
        .setAudience(env.PRIVY_APP_ID as string)
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(key);

    async function api(name: string, method: string, bearer: string, body?: unknown, query = "") {
      const res = await fetch(`${fn}/${name}${query}`, {
        method,
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json();
      return { status: res.status, body: json };
    }
    async function ok(name: string, method: string, bearer: string, body?: unknown, query = "") {
      const res = await api(name, method, bearer, body, query);
      assert(res.status < 300, `${method} ${name}: ${res.status} ${JSON.stringify(res.body)}`);
      return res.body;
    }
    async function mined(hash: Promise<Hex>) {
      const receipt = await pub.waitForTransactionReceipt({ hash: await hash });
      assertEquals(receipt.status, "success");
    }
    const sync = () => ok("chain-sync", "POST", env.CHAIN_SYNC_SECRET as string);

    // the deployer holds every onchain role on local and is the offchain underwriter (not seeded: E-6a)
    await ensureLocalUnderwriter(stack);
    const admin = createWalletClient({ account: mnemonicToAccount("test test test test test test test test test test test junk"), chain, transport: http(RPC) });
    const person = async (label: string, email: string) => {
      const account = privateKeyToAccount(generatePrivateKey());
      await mined(admin.sendTransaction({ to: account.address, value: parseEther("1") }));
      return { account, wallet: createWalletClient({ account, chain, transport: http(RPC) }), privy: `did:privy:e2e-${label}-${rand}`, email };
    };
    const claimant = await person("claimant", `claimant-${rand}@example.test`);
    const officer = await person("officer", `officer-${rand}@example.test`);
    const underwriter = { account: admin.account, privy: "did:privy:e2e-underwriter", email: "underwriter@example.test" };

    await t.step("each person links their wallet with a signature", async () => {
      for (const p of [claimant, officer, underwriter]) {
        const issuedAt = new Date().toISOString();
        const signature = await p.account.signMessage({ message: bindingMessage({ privyUserId: p.privy, wallet: p.account.address, issuedAt }) });
        const res = await api("me", "POST", await token(p.privy), { wallet: p.account.address, signature, issuedAt, email: p.email });
        assert(res.status === 201 || res.status === 200, JSON.stringify(res.body));
      }
      const me = await ok("me", "GET", await token(underwriter.privy));
      assertEquals(me.staffRole, "underwriter");
    });

    let orgId = 0n;
    await t.step("an org added onchain is mirrored by chain-sync", async () => {
      await mined(admin.writeContract({ address: deployed.orgRegistry, abi: orgRegistryAbi, functionName: "addOrg", args: [`E2E Org ${rand}`] }));
      orgId = await pub.readContract({ address: deployed.orgRegistry, abi: orgRegistryAbi, functionName: "orgCount" });
      await mined(admin.writeContract({ address: deployed.orgRegistry, abi: orgRegistryAbi, functionName: "setOfficer", args: [orgId, officer.account.address, true] }));
      await sync();
      const me = await ok("me", "GET", await token(officer.privy));
      assertEquals(me.officerOrgs, [{ orgId: Number(orgId), name: `E2E Org ${rand}`, title: null }]);
    });

    const claimantToken = await token(claimant.privy);
    const officerToken = await token(officer.privy);
    const underwriterToken = await token(underwriter.privy);
    let claimId = "";
    const receipt = new TextEncoder().encode(`%PDF-1.7 receipt ${rand}`);

    await t.step("nobody unverified can sell; the claimant connects FraxNet and the officer is verified by hand", async () => {
      const early = await api("claims", "POST", claimantToken, { orgId: Number(orgId), faceValue: "1", requestedAmount: "1", callinkPrNumber: `PR-early-${rand}`, recipientType: "member" });
      assertEquals([early.status, early.body.error?.code], [403, "kyc_required"]);

      // local runs the mock FraxNet, which sends the browser straight back to the callback with a code (U-77)
      const { authorizeUrl } = await ok("fraxnet-connect", "POST", claimantToken, { action: "start" });
      const back = new URL(authorizeUrl);
      assertEquals(back.pathname, "/fraxnet/callback/");
      const connected = await ok("fraxnet-connect", "POST", claimantToken, {
        action: "finish",
        code: back.searchParams.get("code"),
        state: back.searchParams.get("state"),
      });
      assertEquals([connected.status, connected.source, connected.fraxnet.verified], ["approved", "fraxnet_api", true]);
      assertEquals((await ok("kyc-status", "POST", claimantToken)).status, "approved");

      // the fallback for when FraxNet can't answer (U-36)
      await ok("kyc-manual", "POST", underwriterToken, { wallet: officer.account.address, status: "approved", note: "e2e: confirmed with Frax" });
    });

    await t.step("draft, upload a receipt to the private bucket, and confirm it", async () => {
      const draft = await ok("claims", "POST", claimantToken, {
        orgId: Number(orgId),
        faceValue: parseEther("500").toString(),
        requestedAmount: parseEther("400").toString(),
        callinkPrNumber: `PR-${rand}`,
        guarantorWallet: officer.account.address,
      });
      claimId = draft.claim.id;
      const created = await ok("documents", "POST", claimantToken, { action: "create", claimId, mimeType: "application/pdf", sizeBytes: receipt.byteLength });
      const browser = createClient(stack.url, stack.anonKey, { auth: { persistSession: false } });
      const upload = await browser.storage.from("receipts").uploadToSignedUrl(created.upload.path, created.upload.token, new Blob([receipt], { type: "application/pdf" }));
      assertEquals(upload.error, null);
      const confirmed = await ok("documents", "POST", claimantToken, { action: "confirm", documentId: created.document.id });
      assert(/^[0-9a-f]{64}$/.test(confirmed.document.sha256));

      const read = await ok("documents-read", "POST", officerToken, { documentId: created.document.id });
      const file = await fetch(`${stack.url}${read.signedPath}`);
      assertEquals(new Uint8Array(await file.arrayBuffer()), receipt);
    });

    await t.step("freeze, invite, and sign the guaranty", async () => {
      const packet = await ok("packet", "POST", claimantToken, { claimId });
      assert(packet.packetHash.startsWith("0x"));
      const invite = await ok("guarantor-invite", "POST", claimantToken, { claimId });
      const inviteToken = new URL(invite.inviteUrl).searchParams.get("invite") as string;
      const opened = await ok("guarantor-invite", "GET", officerToken, undefined, `?invite=${inviteToken}`);
      const typed = opened.typedData;
      const message = Object.fromEntries(
        Object.entries(typed.message as Record<string, string>).map(([k, v]) => [k, /^[0-9]+$/.test(v) ? BigInt(v) : v]),
      );
      const signature = await officer.account.signTypedData({ domain: typed.domain, types: typed.types, primaryType: "Guaranty", message });
      await ok("guaranty", "POST", officerToken, { claimId, signature, nonce: typed.message.nonce, deadline: typed.message.deadline, invite: inviteToken });
    });

    let onchainId = 0n;
    await t.step("the claimant submits onchain and chain-sync links the draft by packetHash", async () => {
      const { claim } = await ok("claims", "GET", claimantToken, undefined, `?id=${claimId}`);
      await mined(
        claimant.wallet.writeContract({
          address: deployed.claimRegistry,
          abi: claimRegistryAbi,
          functionName: "submitClaim",
          args: [
            { orgId, recipientType: 0, guarantor: officer.account.address, faceValue: BigInt(claim.faceValue), requestedAmount: BigInt(claim.requestedAmount), packetHash: claim.packetHash },
            BigInt(claim.guarantyDeadline),
            claim.guarantySignature,
          ],
        }),
      );
      await sync();
      const synced = (await ok("claims", "GET", claimantToken, undefined, `?id=${claimId}`)).claim;
      assertEquals(synced.status, "Submitted");
      onchainId = BigInt(synced.onchainClaimId);
    });

    await t.step("an underwriter approves, the pool is funded, and the claimant is paid", async () => {
      assertEquals((await ok("kyc-status", "POST", claimantToken)).status, "approved");

      await mined(admin.writeContract({ address: deployed.pool, abi: receivablesPoolAbi, functionName: "setLenderAllowed", args: [admin.account.address, true] }));
      await mined(admin.writeContract({ address: deployed.frxUSD, abi: mockFrxUsdAbi, functionName: "mint", args: [admin.account.address, parseEther("1000")] }));
      await mined(admin.writeContract({ address: deployed.frxUSD, abi: mockFrxUsdAbi, functionName: "approve", args: [deployed.pool, parseEther("1000")] }));
      await mined(admin.writeContract({ address: deployed.pool, abi: receivablesPoolAbi, functionName: "deposit", args: [parseEther("1000"), admin.account.address] }));
      await mined(admin.writeContract({ address: deployed.claimRegistry, abi: claimRegistryAbi, functionName: "approveClaim", args: [onchainId, parseEther("400")] }));
      await mined(claimant.wallet.writeContract({ address: deployed.claimRegistry, abi: claimRegistryAbi, functionName: "purchaseClaim", args: [onchainId] }));
      await sync();
      assertEquals((await ok("claims", "GET", claimantToken, undefined, `?id=${claimId}`)).claim.status, "Funded");
    });

    await t.step("gas-drip gives one top-up per day", async () => {
      assertEquals((await api("gas-drip", "POST", claimantToken)).status, 200);
      assertEquals((await api("gas-drip", "POST", claimantToken)).status, 429);
    });

    const balance = (who: `0x${string}`) =>
      pub.readContract({ address: deployed.frxUSD, abi: mockFrxUsdAbi, functionName: "balanceOf", args: [who] });

    await t.step("the claimant cashes out the purchase price with the CashOut adapter", async () => {
      const proceeds = await balance(claimant.account.address);
      assertEquals(proceeds, parseEther("400"));
      const sink = config.cashOutSink as `0x${string}`;
      const sinkBefore = await balance(sink);
      const calls = await createCashOut(config).buildTransfer({ from: claimant.account.address, amount: proceeds, liquidationAddress: sink });
      for (const call of calls) await mined(claimant.wallet.sendTransaction(call));
      assertEquals([await balance(claimant.account.address), await balance(sink) - sinkBefore], [0n, proceeds]);
    });

    await t.step("simulate-payout mints what's due, the claimant settles, and the NFT says Settled", async () => {
      const due = await pub.readContract({ address: deployed.claimRegistry, abi: claimRegistryAbi, functionName: "amountRemaining", args: [onchainId] });
      const paid = await ok("simulate-payout", "POST", claimantToken, { claimId });
      assertEquals([paid.minted, await balance(claimant.account.address)], [due.toString(), due]);
      assertEquals((await api("simulate-payout", "POST", claimantToken, { claimId })).body.error.code, "already_funded");
      await mined(claimant.wallet.writeContract({ address: deployed.frxUSD, abi: mockFrxUsdAbi, functionName: "approve", args: [deployed.claimRegistry, due] }));
      await mined(claimant.wallet.writeContract({ address: deployed.claimRegistry, abi: claimRegistryAbi, functionName: "settle", args: [onchainId, due] }));
      await sync();
      assertEquals((await ok("claims", "GET", claimantToken, undefined, `?id=${claimId}`)).claim.status, "Settled");

      const meta = await (await fetch(`${fn}/nft-metadata/${onchainId}`)).json();
      const traits = Object.fromEntries((meta.attributes as Array<{ trait_type: string; value: unknown }>).map((a) => [a.trait_type, a.value]));
      assertEquals([traits.State, traits.Org, traits["Amount paid"]], ["Settled", `E2E Org ${rand}`, "$400.00"]);
      assert(!JSON.stringify(meta).toLowerCase().includes(claimant.account.address.toLowerCase().slice(2)));
    });
  },
});
