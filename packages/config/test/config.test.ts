import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  CHAIN_IDS,
  ConfigError,
  NETWORKS,
  NotDeployedError,
  RAW_CONFIGS,
  ROLE_PLACEHOLDER,
  isTestnet,
  loadNetworkConfig,
  networkConfigShape,
  paramsAsBigInt,
  parseNetworkConfig,
  requireDeployed,
} from "../src/index.ts";

/** PRD section 6 initial terms, which every network starts with. */
const PRD_PARAMS = {
  advanceRateBps: 10_000,
  perClaimCap: "2500000000000000000000",
  perOrgCap: "10000000000000000000000",
  poolDepositCap: "50000000000000000000000",
  feeBps: 0,
  overdueWindowSeconds: 180 * 24 * 60 * 60,
  approvalExpirySeconds: 14 * 24 * 60 * 60,
  writeOffGraceSeconds: 60 * 24 * 60 * 60,
  lenderAllowlistEnabled: true,
};

const FRXUSD = "0xfc00000000000000000000000000000000000001";

type RawConfig = z.input<typeof networkConfigShape>;

/** A mutable copy of a raw config file, typed as the schema's input so tests can break one field at a time. */
function clone(network: (typeof NETWORKS)[number]): RawConfig {
  return structuredClone(RAW_CONFIGS[network]) as RawConfig;
}

function issuesOf(input: unknown): string[] {
  try {
    parseNetworkConfig(input);
    return [];
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
}

describe("deployments/*.json", () => {
  it.each(["local", "fraxtal-testnet", "sepolia"] as const)("%s passes the full schema", (network) => {
    const config = loadNetworkConfig(network);
    expect(config.network).toBe(network);
    expect(config.chainId).toBe(CHAIN_IDS[network]);
    expect(isTestnet(config)).toBe(true);
  });

  it("fraxtal.json has a valid shape but fails the endpoint checks until Frax shares them (U-47, U-77)", () => {
    expect(networkConfigShape.safeParse(RAW_CONFIGS.fraxtal).success).toBe(true);
    expect(issuesOf(RAW_CONFIGS.fraxtal)).toEqual([
      "fraxMesh: cashOut 'mesh' requires fraxMesh",
      "fraxnet.apiBase: fraxnet 'real' requires fraxnet.apiBase",
      "fraxnet.oauthIssuer: fraxnet 'real' requires fraxnet.oauthIssuer",
    ]);
    expect(() => loadNetworkConfig("fraxtal")).toThrow(ConfigError);
  });

  it("fraxtal.json reads the chain over rpc until the Goldsky subgraph exists (U-52, U-68)", () => {
    const mainnet = clone("fraxtal");
    expect(mainnet.adapters.chainReader).toBe("rpc");
    expect(mainnet.goldskyUrl).toBeNull();
  });

  it("fraxtal.json passes once the FraxNet endpoints and Mesh address are filled in", () => {
    const filled = clone("fraxtal");
    filled.fraxnet.apiBase = "https://net.example.test/api/v1";
    filled.fraxnet.oauthIssuer = "https://net-oauth.example.test";
    filled.fraxMesh = "0x1111111111111111111111111111111111111111";
    expect(issuesOf(filled)).toEqual([]);
  });

  it.each(NETWORKS)("%s uses the PRD section 6 terms", (network) => {
    expect(clone(network).params).toEqual(PRD_PARAMS);
  });

  it("chain IDs, frxUSD, and adapters match PRD section 10", () => {
    const table = Object.fromEntries(
      NETWORKS.map((n) => {
        const c = clone(n);
        // fraxtal-testnet may switch to MockFrxUSD (null) if Frax can't supply test frxUSD; checked below (U-25)
        const frxUSD = n === "fraxtal-testnet" ? FRXUSD : c.frxUSD;
        return [n, { chainId: c.chainId, frxUSD, adapters: c.adapters, payout: c.features.simulateAsucPayout }];
      }),
    );
    expect([FRXUSD, null]).toContain(clone("fraxtal-testnet").frxUSD);
    expect(table).toEqual({
      local: {
        chainId: 31_337,
        frxUSD: null,
        adapters: { fraxnet: "mock", gasSponsor: "mock", cashOut: "simulated", chainReader: "rpc" },
        payout: true,
      },
      "fraxtal-testnet": {
        chainId: 2523,
        frxUSD: FRXUSD,
        // PRD section 10 has the mock here; testnet now connects to FraxNet's staging OAuth instead (U-77)
        adapters: { fraxnet: "real", gasSponsor: "drip", cashOut: "simulated", chainReader: "rpc" },
        payout: true,
      },
      sepolia: {
        chainId: 11_155_111,
        frxUSD: null,
        adapters: { fraxnet: "mock", gasSponsor: "drip", cashOut: "simulated", chainReader: "rpc" },
        payout: true,
      },
      fraxtal: {
        chainId: 252,
        frxUSD: FRXUSD,
        // the PRD says goldsky; rpc until the subgraph exists (U-68)
        adapters: { fraxnet: "real", gasSponsor: "drip", cashOut: "mesh", chainReader: "rpc" },
        payout: false,
      },
    });
  });

  it("local has the addresses the deploy script wrote", () => {
    const deployed = requireDeployed(loadNetworkConfig("local"));
    for (const key of ["frxUSD", "orgRegistry", "claimRegistry", "pool", "claimNft"] as const) {
      expect(deployed[key]).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
    expect(deployed.block).toBeGreaterThanOrEqual(0);
  });
});

describe("the U-25 fallback on fraxtal-testnet", () => {
  it("setting frxUSD to null (deploy MockFrxUSD) is a valid testnet config", () => {
    const c = clone("fraxtal-testnet");
    c.frxUSD = null;
    expect(issuesOf(c)).toEqual([]);
  });
});

describe("cross-field rules", () => {
  it("isTestnet comes from the chain ID: only Fraxtal mainnet (252) is mainnet", () => {
    for (const n of NETWORKS) expect(isTestnet({ chainId: CHAIN_IDS[n] }), n).toBe(n !== "fraxtal");
    expect(isTestnet({ chainId: 1 }), "an unknown chain counts as mainnet").toBe(false);
  });

  it("cashOut simulated requires cashOutSink", () => {
    const c = clone("local");
    c.cashOutSink = null;
    expect(issuesOf(c)).toEqual(["cashOutSink: cashOut 'simulated' requires cashOutSink"]);
  });

  it("fraxnet real requires apiBase and oauthIssuer", () => {
    const c = clone("local");
    c.adapters.fraxnet = "real";
    expect(issuesOf(c)).toEqual([
      "fraxnet.apiBase: fraxnet 'real' requires fraxnet.apiBase",
      "fraxnet.oauthIssuer: fraxnet 'real' requires fraxnet.oauthIssuer",
    ]);
  });

  it("fraxtal-testnet signs people in through FraxNet's staging OAuth (U-77)", () => {
    const c = loadNetworkConfig("fraxtal-testnet");
    expect(c.adapters.fraxnet).toBe("real");
    expect(c.fraxnet).toEqual({
      appUrl: "https://net-test.frax.com",
      apiBase: "https://net-test.frax.com/api/v1",
      oauthIssuer: "https://net-test-oauth.frax.com",
      // connecting adds the member's wallet to FraxNet on Fraxtal (U-78)
      walletChainId: 252,
    });
  });

  it("the testnet banner is off on every network for now (U-66)", () => {
    for (const n of NETWORKS) expect(clone(n).features.testnetBanner, n).toBe(false);
  });

  it("a null frxUSD, which deploys the mock, is testnet-only", () => {
    const c = clone("fraxtal");
    c.frxUSD = null;
    expect(issuesOf(c)).toContain("frxUSD: frxUSD null deploys MockFrxUSD, which is testnet-only");
  });

  it("the chain ID must match the network name", () => {
    const c = clone("local");
    c.chainId = 2523;
    expect(issuesOf(c)).toEqual(["chainId: local must use chain 31337"]);
  });
});

describe("shape", () => {
  it("rejects unknown keys so typos are caught", () => {
    const c: Record<string, unknown> = { ...clone("local") };
    c.adapter = c.adapters;
    expect(issuesOf(c).join()).toMatch(/adapter/);
  });

  it("rejects a malformed address", () => {
    const c = clone("local");
    c.cashOutSink = "0x123";
    expect(issuesOf(c)).toEqual(["cashOutSink: must be a 20-byte hex address"]);
  });

  it("accepts the role placeholder or a real address, nothing else", () => {
    const c = clone("local");
    c.roles.admin = "0x2222222222222222222222222222222222222222";
    expect(issuesOf(c)).toEqual([]);
    const broken = { ...c, roles: { ...c.roles, admin: "admin-safe" } };
    expect(issuesOf(broken).join()).toMatch(/roles\.admin/);
    expect(clone("fraxtal").roles.underwriter).toBe(ROLE_PLACEHOLDER);
  });

  it("rejects out-of-range terms", () => {
    const c = clone("local");
    c.params.feeBps = 10_001;
    c.params.perClaimCap = "0";
    c.params.overdueWindowSeconds = 0;
    const issues = issuesOf({ ...c, params: { ...c.params, poolDepositCap: 5e22 } }).join("\n");
    expect(issues).toMatch(/params\.feeBps/);
    expect(issues).toMatch(/params\.perClaimCap/);
    expect(issues).toMatch(/params\.overdueWindowSeconds/);
    expect(issues).toMatch(/params\.poolDepositCap/);
  });

  it("reports a non-numeric amount as an issue instead of throwing", () => {
    const c = clone("local");
    c.params.perClaimCap = "2.5e21";
    c.params.poolDepositCap = "lots";
    expect(issuesOf(c)).toEqual([
      "params.perClaimCap: must be a decimal string of wei",
      "params.poolDepositCap: must be a decimal string of wei",
    ]);
  });

  it("rejects an amount that overflows uint128", () => {
    const c = clone("local");
    c.params.perOrgCap = (2n ** 128n).toString();
    expect(issuesOf(c)).toEqual(["params.perOrgCap: must be above 0 and fit in uint128"]);
  });
});

describe("loader helpers", () => {
  it("rejects an unknown network name", () => {
    expect(() => loadNetworkConfig("mainnet")).toThrow(/unknown network/);
  });

  it("requireDeployed names what is missing", () => {
    const config = loadNetworkConfig("sepolia");
    expect(() => requireDeployed(config)).toThrow(NotDeployedError);
    expect(() => requireDeployed(config)).toThrow(/missing block, frxUSD, orgRegistry, claimRegistry, pool, claimNft/);
  });

  it("paramsAsBigInt keeps wei exact", () => {
    expect(paramsAsBigInt(loadNetworkConfig("local")).perOrgCap).toBe(10_000n * 10n ** 18n);
  });
});
