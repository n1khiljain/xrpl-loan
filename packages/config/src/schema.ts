import { z } from "zod";

/** A 20-byte hex address. Case is not checked, so checksummed and lowercase both pass. */
export type Address = `0x${string}`;

/** Role value left in a config until the Safe for that role exists (see Deploy.s.sol, U-40). */
export const ROLE_PLACEHOLDER = "SET_AFTER_SAFE_CREATED";

export const NETWORKS = ["local", "fraxtal-testnet", "sepolia", "fraxtal"] as const;
export type NetworkName = (typeof NETWORKS)[number];

/** The chain each network name must point at. */
export const CHAIN_IDS: Record<NetworkName, number> = {
  local: 31_337,
  "fraxtal-testnet": 2523,
  sepolia: 11_155_111,
  fraxtal: 252,
};

/** Chains that hold no real money. Every other chain, Fraxtal mainnet (252) included, is treated as mainnet. */
const TESTNET_CHAIN_IDS: ReadonlySet<number> = new Set([CHAIN_IDS.local, CHAIN_IDS["fraxtal-testnet"], CHAIN_IDS.sepolia]);

/**
 * Whether a network is a testnet. Derived from the chain ID, never read from the file, so one edit to a JSON file
 * can't turn testnet-only features on for Fraxtal mainnet (security campaign E-1).
 */
export function isTestnet(config: { chainId: number }): boolean {
  return TESTNET_CHAIN_IDS.has(config.chainId);
}

const UINT32_MAX = 2 ** 32 - 1;
const UINT128_MAX = 2n ** 128n - 1n;

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 20-byte hex address")
  .transform((value) => value as Address);

const url = z.url();

/** An address, or the placeholder that the deploy script refuses outside local. */
const roleAddress = z.union([z.literal(ROLE_PLACEHOLDER), address]);

/** frxUSD amount in wei (18 decimals), written as a decimal string so JSON never rounds it. */
// abort: zod 4 runs later checks even after one fails, and BigInt() throws on anything but digits
const wei = z.string().regex(/^[0-9]+$/, { message: "must be a decimal string of wei", abort: true });

const uint128Wei = wei.refine((value) => BigInt(value) > 0n && BigInt(value) <= UINT128_MAX, {
  message: "must be above 0 and fit in uint128",
});

const bps = z.int().min(0).max(10_000);

const seconds = z.int().min(1).max(UINT32_MAX);

/**
 * Shape of `deployments/<network>.json` (SYSTEM_DESIGN section 3). Types and ranges only. The cross-field rules
 * live in `networkConfigSchema`.
 */
export const networkConfigShape = z.strictObject({
  network: z.enum(NETWORKS),
  chainId: z.int().positive(),
  rpcUrl: url,
  explorer: url.nullable(),
  safeUi: url.nullable(),
  gasFaucet: url.nullable(),
  /** null deploys MockFrxUSD (FR-C18, U-25). */
  frxUSD: address.nullable(),
  fraxnet: z.strictObject({
    /** FraxNet's web app, where people finish verifying. */
    appUrl: url,
    /** FraxNet REST API base, e.g. `https://net-test.frax.com/api/v1` (U-77). */
    apiBase: url.nullable(),
    /** FraxNet's OAuth / OpenID Connect issuer, e.g. `https://net-test-oauth.frax.com` (U-77). */
    oauthIssuer: url.nullable(),
    /**
     * The chain FraxNet records the member's wallet on when they connect. The address is the same on every EVM chain;
     * FraxNet staging's examples are all Fraxtal mainnet. UNCERTAIN: U-78
     */
    walletChainId: z.number().int().positive().nullable(),
  }),
  /** Frax Mesh OFT on Fraxtal for mainnet cash-out (U-17). */
  fraxMesh: address.nullable(),
  /** Destination for the simulated testnet cash-out. */
  cashOutSink: address.nullable(),
  /** Base URI for claim NFT metadata, null until the Supabase project exists (U-41). */
  nftBaseUri: url.nullable(),
  /** Subgraph endpoint for the goldsky ChainReader, null until the subgraph exists (U-22, U-52). */
  goldskyUrl: url.nullable(),
  roles: z.strictObject({
    admin: roleAddress,
    underwriter: roleAddress,
    attester: roleAddress,
    emergencyPauser: roleAddress,
  }),
  params: z.strictObject({
    advanceRateBps: bps,
    perClaimCap: uint128Wei,
    perOrgCap: uint128Wei,
    poolDepositCap: wei,
    feeBps: bps,
    overdueWindowSeconds: seconds,
    approvalExpirySeconds: seconds,
    writeOffGraceSeconds: seconds,
    lenderAllowlistEnabled: z.boolean(),
  }),
  adapters: z.strictObject({
    fraxnet: z.enum(["real", "mock"]),
    gasSponsor: z.enum(["drip", "mock"]),
    cashOut: z.enum(["mesh", "simulated"]),
    chainReader: z.enum(["rpc", "goldsky"]),
  }),
  features: z.strictObject({
    simulateAsucPayout: z.boolean(),
    /** The yellow "Testnet pilot" bar on every page (FR-F9). Off while the whole team knows it's testnet. UNCERTAIN: U-66 */
    testnetBanner: z.boolean(),
  }),
  /** Written by `contracts/script/Deploy.s.sol` after a broadcast. */
  deployed: z.strictObject({
    block: z.int().min(0).optional(),
    frxUSD: address.optional(),
    orgRegistry: address.optional(),
    claimRegistry: address.optional(),
    pool: address.optional(),
    claimNft: address.optional(),
  }),
});

/**
 * Full network config: the shape plus the cross-field rules from SYSTEM_DESIGN section 3, and more that follow from
 * the PRD: the chain ID must match the network name, and on mainnet (see `isTestnet`) nothing simulated is allowed:
 * no MockFrxUSD (a null `frxUSD`, FR-C18), no mock FraxNet or gas sponsor, no simulated cash-out, and no simulated
 * ASUC payout (security campaign E-1d/e/f).
 */
export const networkConfigSchema = networkConfigShape.superRefine((cfg, ctx) => {
  const expectedChain = CHAIN_IDS[cfg.network];
  if (cfg.chainId !== expectedChain) {
    ctx.addIssue({
      code: "custom",
      path: ["chainId"],
      message: `${cfg.network} must use chain ${expectedChain}`,
    });
  }
  if (cfg.adapters.cashOut === "mesh" && cfg.fraxMesh === null) {
    ctx.addIssue({
      code: "custom",
      path: ["fraxMesh"],
      message: "cashOut 'mesh' requires fraxMesh",
    });
  }
  if (cfg.adapters.cashOut === "simulated" && cfg.cashOutSink === null) {
    ctx.addIssue({
      code: "custom",
      path: ["cashOutSink"],
      message: "cashOut 'simulated' requires cashOutSink",
    });
  }
  if (cfg.adapters.fraxnet === "real") {
    for (const key of ["apiBase", "oauthIssuer"] as const) {
      if (cfg.fraxnet[key] === null) {
        ctx.addIssue({ code: "custom", path: ["fraxnet", key], message: `fraxnet 'real' requires fraxnet.${key}` });
      }
    }
  }
  if (!isTestnet(cfg)) {
    const testnetOnly: [boolean, (string | number)[], string][] = [
      [cfg.frxUSD === null, ["frxUSD"], "frxUSD null deploys MockFrxUSD, which is testnet-only"],
      [cfg.adapters.fraxnet === "mock", ["adapters", "fraxnet"], "fraxnet 'mock' is testnet-only"],
      [cfg.adapters.gasSponsor === "mock", ["adapters", "gasSponsor"], "gasSponsor 'mock' is testnet-only"],
      [cfg.adapters.cashOut === "simulated", ["adapters", "cashOut"], "cashOut 'simulated' is testnet-only"],
      [cfg.features.simulateAsucPayout, ["features", "simulateAsucPayout"], "simulateAsucPayout is testnet-only"],
    ];
    for (const [bad, path, message] of testnetOnly) {
      if (bad) ctx.addIssue({ code: "custom", path, message });
    }
  }
});

export type NetworkConfig = z.output<typeof networkConfigSchema>;
export type Deployed = NetworkConfig["deployed"];
