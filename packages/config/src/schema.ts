import { z } from "zod";

/** A classic XRPL address: base58, starting with r. */
export type XrplAddress = `r${string}`;

export const NETWORKS = ["xrpl-devnet"] as const;
export type NetworkName = (typeof NETWORKS)[number];

/** The XRPL network ID each network name must point at. Mainnet is 0 and is never allowed. */
export const NETWORK_IDS: Record<NetworkName, number> = {
  "xrpl-devnet": 2,
};

/** Network IDs that hold no real money: 1 is Testnet and 2 is Devnet. */
const TEST_NETWORK_IDS: ReadonlySet<number> = new Set([1, 2]);

/**
 * Whether a network holds no real money. Derived from the network ID, never read from the file, so one edit to a
 * JSON file can't point the app at mainnet with test-only features on.
 */
export function isTestnet(config: { networkId: number }): boolean {
  return TEST_NETWORK_IDS.has(config.networkId);
}

/** Every amount in the app is an integer count of these: the loan asset with 6 decimals (cents and below). */
export const ASSET_DECIMALS = 6;

export const xrplAddress = z
  .string()
  .regex(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/, "must be a classic XRPL address")
  .transform((value) => value as XrplAddress);

/** A 256-bit ledger object ID (vault, loan broker, domain), as 64 uppercase hex characters. */
const ledgerId = z.string().regex(/^[0-9A-F]{64}$/, "must be a 64-character uppercase hex ledger ID");

const url = z.url();

/** Asset amount in base units (see ASSET_DECIMALS), written as a decimal string so JSON never rounds it. */
const units = z
  .string()
  .regex(/^[1-9][0-9]*$/, { message: "must be a positive decimal string of base units", abort: true });

const bps = z.int().min(0).max(10_000);

const seconds = z.int().min(1).max(2 ** 32 - 1);

/**
 * Shape of `deployments/<network>.json`. Everything here is public: the setup script writes account addresses and
 * ledger object IDs into `ledger`, never a seed.
 */
export const networkConfigShape = z.strictObject({
  network: z.enum(NETWORKS),
  networkId: z.int().min(0),
  wsUrl: url,
  rpcUrl: url,
  /** The network's faucet, used to fund new custodial wallets with XRP for reserves and fees. */
  faucetUrl: url.nullable(),
  explorer: url,
  /** The loan asset. RLUSD isn't issued on Devnet, so there the app issues a stand-in under the same code. */
  asset: z.strictObject({
    /** What people see, e.g. RLUSD. */
    code: z.string().min(3).max(20),
    /** The ledger currency code: three characters, or 40 hex characters for longer codes. */
    currency: z.union([z.string().regex(/^[A-Z0-9]{3}$/), z.string().regex(/^[0-9A-F]{40}$/)]),
    /** Null until the setup script creates the issuer account. */
    issuer: xrplAddress.nullable(),
    /** True when the issuer is the app's own test issuer, not Ripple's. */
    standIn: z.boolean(),
  }),
  params: z.strictObject({
    advanceRateBps: bps,
    perClaimCap: units,
    perOrgCap: units,
    poolDepositCap: units,
    /** Yearly interest on unpaid principal, in basis points. On the ledger this is ten times as many tenths of a basis point. */
    feeBps: bps,
    overdueWindowSeconds: seconds,
    approvalExpirySeconds: seconds,
    writeOffGraceSeconds: seconds,
  }),
  features: z.strictObject({
    /** The "Simulate payer payment" demo button. Testnet only. */
    simulatePayment: z.boolean(),
    /** The "Test network" bar on every page. */
    testnetBanner: z.boolean(),
  }),
  /** Accounts and ledger objects the setup script created. Public identifiers only. */
  ledger: z.strictObject({
    broker: xrplAddress.optional(),
    credentialIssuer: xrplAddress.optional(),
    /** Hex of the credential type the app issues after KYC. */
    credentialType: z.string().regex(/^[0-9A-F]{2,128}$/).optional(),
    domainId: ledgerId.optional(),
    vaultId: ledgerId.optional(),
    loanBrokerId: ledgerId.optional(),
    repaymentAccount: xrplAddress.optional(),
  }),
});

/**
 * Full network config: the shape plus cross-field rules. The network ID must match the name, and it must be a test
 * network: this app never points at XRPL mainnet.
 */
export const networkConfigSchema = networkConfigShape.superRefine((cfg, ctx) => {
  const expected = NETWORK_IDS[cfg.network];
  if (cfg.networkId !== expected) {
    ctx.addIssue({ code: "custom", path: ["networkId"], message: `${cfg.network} must use network ID ${expected}` });
  }
  if (!isTestnet(cfg)) {
    ctx.addIssue({ code: "custom", path: ["networkId"], message: "only XRPL Testnet (1) and Devnet (2) are allowed" });
  }
  if (cfg.asset.standIn === false && cfg.asset.issuer === null) {
    ctx.addIssue({ code: "custom", path: ["asset", "issuer"], message: "a real asset needs its issuer" });
  }
});

export type NetworkConfig = z.output<typeof networkConfigSchema>;
export type LedgerObjects = NetworkConfig["ledger"];
