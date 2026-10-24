import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  ConfigError,
  NETWORK_IDS,
  NotSetUpError,
  RAW_CONFIGS,
  isSetUp,
  isTestnet,
  loadNetworkConfig,
  type networkConfigShape,
  paramsAsBigInt,
  parseNetworkConfig,
  requireSetup,
} from "../src/index.ts";

type RawConfig = z.input<typeof networkConfigShape>;

function devnet(): RawConfig {
  return structuredClone(RAW_CONFIGS["xrpl-devnet"]) as RawConfig;
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

const ADDRESS = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const ID = "A".repeat(64);

describe("deployments/xrpl-devnet.json", () => {
  it("passes the full schema", () => {
    const config = loadNetworkConfig("xrpl-devnet");
    expect(config.networkId).toBe(NETWORK_IDS["xrpl-devnet"]);
    expect(isTestnet(config)).toBe(true);
    expect(config.asset.code).toBe("RLUSD");
  });

  it("rejects an unknown network name", () => {
    expect(() => loadNetworkConfig("xrpl-mainnet")).toThrow(ConfigError);
  });
});

describe("network safety", () => {
  it("refuses mainnet's network ID even if the name says devnet", () => {
    const raw = devnet();
    raw.networkId = 0;
    expect(issuesOf(raw)).toEqual(
      expect.arrayContaining(["networkId: xrpl-devnet must use network ID 2", "networkId: only XRPL Testnet (1) and Devnet (2) are allowed"]),
    );
  });

  it("refuses a real asset without an issuer", () => {
    const raw = devnet();
    raw.asset.standIn = false;
    raw.asset.issuer = null;
    expect(issuesOf(raw)).toContain("asset.issuer: a real asset needs its issuer");
  });

  it("refuses an address that isn't a classic XRPL address", () => {
    const raw = devnet();
    raw.ledger.broker = "not-an-address";
    expect(issuesOf(raw)).toEqual([expect.stringMatching(/^ledger\.broker: must be a classic XRPL address/)]);
  });
});

describe("requireSetup", () => {
  it("names what the setup script still has to create", () => {
    const config = loadNetworkConfig("xrpl-devnet");
    const fresh = { ...config, asset: { ...config.asset, issuer: null }, ledger: {} };
    expect(isSetUp(fresh)).toBe(false);
    expect(() => requireSetup(fresh)).toThrow(NotSetUpError);
    try {
      requireSetup(fresh);
    } catch (error) {
      expect((error as NotSetUpError).missing).toEqual([
        "asset.issuer",
        "broker",
        "credentialIssuer",
        "credentialType",
        "domainId",
        "vaultId",
        "loanBrokerId",
        "repaymentAccount",
      ]);
    }
  });

  it("returns every object once they all exist", () => {
    const raw = devnet();
    raw.asset.issuer = ADDRESS;
    raw.ledger = {
      broker: ADDRESS,
      credentialIssuer: ADDRESS,
      credentialType: "4B5943",
      domainId: ID,
      vaultId: ID,
      loanBrokerId: ID,
      repaymentAccount: ADDRESS,
    };
    const config = parseNetworkConfig(raw);
    expect(requireSetup(config).vaultId).toBe(ID);
    expect(requireSetup(config).issuer).toBe(ADDRESS);
  });
});

describe("paramsAsBigInt", () => {
  it("turns base-unit strings into bigints", () => {
    const p = paramsAsBigInt(loadNetworkConfig("xrpl-devnet"));
    expect(p.perReceivableCap).toBe(2_500_000_000n);
  });
});
