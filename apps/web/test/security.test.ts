/**
 * Security campaign, workstream E (E3 guaranty signing, E5 browser transaction surface). Each test asserts the safe
 * property. The one marked FINDING is still open and is skipped unless SECURITY_FINDINGS is set:
 * `SECURITY_FINDINGS=1 pnpm --filter web test -- test/security.test.ts`.
 *
 * Some checks read source files: the sign mutation is inline in a client component that needs a browser, Privy and
 * wagmi, so there's no unit to import.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { RAW_CONFIGS } from "@app/config";
import { concat, encodeAbiParameters, hashTypedData, keccak256, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { guarantyTypedData } from "../lib/guaranty";

const findings = !process.env.SECURITY_FINDINGS;
const WEB = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(WEB, path), "utf8");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

const SOURCES = ["app", "components", "lib", "hooks"].flatMap((d) => files(join(WEB, d)));

/** The body of the guarantee page's sign mutation, up to the wallet call. */
function signMutationBeforeWalletCall(): string {
  const page = read("app/guarantee/page.tsx");
  const start = page.indexOf("mutationFn:");
  const end = page.indexOf("signTypedDataAsync(typed", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return page.slice(start, end);
}

const CLAIM = {
  recipientWallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  orgId: 7,
  faceValue: "300000000000000000000",
  requestedAmount: "250000000000000000000",
  packetHash: `0x${"ab".repeat(32)}`,
} as const;
const GUARANTOR = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const REGISTRY = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

describe("E3: the guarantor signs only what the page shows", () => {
  // E-3a (fixed): the page builds the typed data itself; only the nonce comes from the server
  it("builds the domain from config and the deployed registry, and the terms from the displayed claim", () => {
    const body = signMutationBeforeWalletCall();
    expect(body).toMatch(/guarantyTypedData\(/);
    expect(body).toMatch(/chainId:\s*config\.chainId/);
    expect(body).toMatch(/registry:\s*deployed\.claimRegistry/);
    expect(body).toMatch(/guarantor:\s*session\.address/);
    expect(body).toMatch(/claim:\s*\{\s*\.\.\.data\.claim/);
    // nothing but the nonce is read from the server's typed data
    expect(body.match(/typedData\??\.(\w+)/g) ?? []).toEqual(["typedData?.message"]);
    expect(body).not.toMatch(/typedData\??\.(domain|types)/);
  });

  it("the browser's typed data hashes to the digest ClaimRegistry rebuilds, so the contract accepts the signature", () => {
    // the type string and EIP-712 name and version straight from the contract source
    const registrySource = readFileSync(join(WEB, "../../contracts/src/ClaimRegistry.sol"), "utf8");
    const typeString = /GUARANTY_TYPEHASH = keccak256\(\s*"([^"]+)"/.exec(registrySource)?.[1] ?? "";
    const [, name = "", version = ""] = /EIP712\("([^"]+)", "([^"]+)"\)/.exec(registrySource) ?? [];
    expect(typeString).toMatch(/^Guaranty\(/);

    const nonce = 3n;
    const deadline = 1_900_000_000n;
    const chainId = 2523;
    const domainSeparator = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
        [
          keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
          keccak256(toHex(name)),
          keccak256(toHex(version)),
          BigInt(chainId),
          REGISTRY,
        ],
      ),
    );
    const structHash = keccak256(
      encodeAbiParameters(
        ["bytes32", "address", "address", "uint64", "uint128", "uint128", "bytes32", "uint256", "uint256"].map((type) => ({ type })),
        [keccak256(toHex(typeString)), GUARANTOR, CLAIM.recipientWallet, 7n, BigInt(CLAIM.faceValue), BigInt(CLAIM.requestedAmount), CLAIM.packetHash, nonce, deadline],
      ),
    );
    const contractDigest = keccak256(concat(["0x1901", domainSeparator, structHash]));

    const browser = guarantyTypedData({ chainId, registry: REGISTRY, guarantor: GUARANTOR, claim: CLAIM, nonce, deadline });
    expect(hashTypedData(browser)).toBe(contractDigest);
    // a different chain or amount is a different digest
    expect(hashTypedData({ ...browser, domain: { ...browser.domain, chainId: 252 } })).not.toBe(contractDigest);
    const cheaper = guarantyTypedData({ chainId, registry: REGISTRY, guarantor: GUARANTOR, claim: { ...CLAIM, requestedAmount: "1" }, nonce, deadline });
    expect(hashTypedData(cheaper)).not.toBe(contractDigest);
  });

  // FINDING E-3a (context, still open): Privy's embedded wallet confirmation is off, so the page is the only display
  // of the terms. Turning it on changes every transaction's UX, so it's a product decision.
  it.skipIf(findings)("the embedded wallet shows its own confirmation for signatures", () => {
    expect(read("lib/session/privy-provider.tsx")).not.toMatch(/showWalletUIs:\s*false/);
  });
});

describe("E5: framing and the Safe App bridge", () => {
  const headers = read("public/_headers");
  const csp = /^\/\*\s*\n(?:\s+.*\n)*?\s+Content-Security-Policy:\s*(.*)$/m.exec(headers)?.[1] ?? "";
  const directive = (name: string) => (new RegExp(`(?:^|;)\\s*${name}\\s+([^;]*)`).exec(csp)?.[1] ?? "").split(/\s+/).filter(Boolean);
  const configs = Object.values(RAW_CONFIGS) as Array<{ network: string; rpcUrl: string; safeUi: string | null }>;

  // E-5a (fixed)
  it("_headers sets a Content-Security-Policy for every page", () => {
    expect(csp).not.toBe("");
    expect(directive("default-src")).toEqual(["'self'"]);
    expect(directive("object-src")).toEqual(["'none'"]);
  });

  it("_headers limits frame-ancestors to the app and the Safe UIs", () => {
    const ancestors = directive("frame-ancestors");
    expect(ancestors).toContain("'self'");
    expect(ancestors.some((a) => a.includes("*"))).toBe(false);
    for (const c of configs) if (c.safeUi) expect(ancestors, c.network).toContain(new URL(c.safeUi).origin);
  });

  it("connect-src lets the app reach every network's RPC and Supabase", () => {
    const connect = directive("connect-src");
    for (const c of configs) {
      if (c.network !== "local") expect(connect, c.network).toContain(new URL(c.rpcUrl).origin);
    }
    expect(connect).toContain("https://*.supabase.co");
  });

  // E-5b (fixed)
  it("the Safe Apps SDK only accepts messages from the configured Safe UIs", () => {
    const safe = read("lib/safe.ts");
    expect(safe).toMatch(/allowedDomains:\s*safeAllowedDomains\(\)/);
    expect(safe).not.toMatch(/allowedDomains:\s*\[\s*\/\.\*\/\s*\]/);
  });
});

describe("E5 regression: approvals and addresses", () => {
  it("no source asks for an unlimited token allowance", () => {
    const hits = SOURCES.filter((p) => /maxUint256|2n\s*\*\*\s*256n|0xf{64}/i.test(readFileSync(p, "utf8")));
    expect(hits).toEqual([]);
  });

  it("every approve names a token and spender from deployedContracts()", () => {
    const approves = SOURCES.flatMap((p) =>
      readFileSync(p, "utf8")
        .split("\n")
        .filter((line) => /functionName:\s*"approve"/.test(line))
        .map((line) => ({ p, line: line.trim() })),
    );
    expect(approves.length).toBeGreaterThan(0);
    for (const { p, line } of approves) {
      expect(line, p).toMatch(/address:\s*deployed\.frxUSD/);
      expect(line, p).toMatch(/args:\s*\[deployed\.(pool|claimRegistry),/);
    }
  });

  it("no hard-coded contract address in app code (addresses come from deployments/*.json)", () => {
    const hits = SOURCES.flatMap((p) =>
      readFileSync(p, "utf8")
        .split("\n")
        .map((line, i) => ({ p, i, line }))
        .filter(({ line }) => /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/.test(line))
        .map(({ p, i, line }) => `${p}:${i + 1}: ${line.trim()}`),
    );
    expect(hits).toEqual([]);
  });
});
