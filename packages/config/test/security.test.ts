/**
 * Security campaign, workstream E1: can a misconfigured deployments/<network>.json put mocks or MockFrxUSD on
 * Fraxtal mainnet? Each test asserts the safe property; all of them run by default.
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  CHAIN_IDS,
  ConfigError,
  NETWORKS,
  RAW_CONFIGS,
  isTestnet,
  networkConfigShape,
  parseNetworkConfig,
} from "../src/index.ts";

type RawConfig = z.input<typeof networkConfigShape>;

/** fraxtal.json with the endpoints Frax hasn't shared yet filled in, so only the field under test can fail. */
function mainnet(): RawConfig {
  const cfg = structuredClone(RAW_CONFIGS.fraxtal) as RawConfig;
  cfg.fraxnet.apiBase = "https://net.example.test/api/v1";
  cfg.fraxnet.oauthIssuer = "https://net-oauth.example.test";
  cfg.fraxMesh = "0x1111111111111111111111111111111111111111";
  return cfg;
}

function rejects(input: RawConfig): boolean {
  try {
    parseNetworkConfig(input);
    return false;
  } catch (error) {
    if (error instanceof ConfigError) return true;
    throw error;
  }
}

describe("E1: isTestnet follows the chain, not the file", () => {
  it("the filled-in mainnet baseline passes, so each test below breaks exactly one thing", () => {
    expect(rejects(mainnet())).toBe(false);
  });

  // E-1a (fixed): there is no isTestnet field to set; chain 252 is mainnet whatever the file says
  it("an isTestnet field in the file is rejected", () => {
    const cfg = { ...mainnet(), isTestnet: true };
    expect(rejects(cfg as RawConfig)).toBe(true);
  });

  it("chain 252 is mainnet and every other configured chain is a testnet", () => {
    expect(isTestnet(parseNetworkConfig(mainnet()))).toBe(false);
    for (const n of NETWORKS.filter((n) => n !== "fraxtal")) expect(isTestnet({ chainId: CHAIN_IDS[n] }), n).toBe(true);
  });

  // E-1b (fixed): a testnet can't claim to be mainnet; the name pins the chain and the chain decides
  it.each(NETWORKS.filter((n) => n !== "fraxtal"))("%s can't be relabelled with mainnet's chain ID", (network) => {
    const cfg = structuredClone(RAW_CONFIGS[network]) as RawConfig;
    cfg.chainId = CHAIN_IDS.fraxtal;
    expect(rejects(cfg)).toBe(true);
  });

  // E-1c (fixed): chain 252 with MockFrxUSD, mock adapters and simulated payouts is rejected
  it("chain 252 with MockFrxUSD, mock adapters and simulated payouts is rejected", () => {
    const cfg = mainnet();
    cfg.frxUSD = null;
    cfg.adapters.fraxnet = "mock";
    cfg.adapters.gasSponsor = "mock";
    cfg.adapters.cashOut = "simulated";
    cfg.cashOutSink = "0x2222222222222222222222222222222222222222";
    cfg.features.simulateAsucPayout = true;
    expect(rejects(cfg)).toBe(true);
  });
});

describe("E1: mainnet forbids every mock", () => {
  // E-1d (fixed): the mock FraxNet client approves KYC for anyone who clicks Connect
  it("fraxnet 'mock' is rejected on mainnet", () => {
    const cfg = mainnet();
    cfg.adapters.fraxnet = "mock";
    expect(rejects(cfg)).toBe(true);
  });

  // E-1e (fixed)
  it("gasSponsor 'mock' is rejected on mainnet", () => {
    const cfg = mainnet();
    cfg.adapters.gasSponsor = "mock";
    expect(rejects(cfg)).toBe(true);
  });

  // E-1f (fixed): the simulated cash-out sends members' frxUSD to cashOutSink
  it("cashOut 'simulated' is rejected on mainnet", () => {
    const cfg = mainnet();
    cfg.adapters.cashOut = "simulated";
    cfg.cashOutSink = "0x2222222222222222222222222222222222222222";
    expect(rejects(cfg)).toBe(true);
  });

  it("features.simulateAsucPayout is rejected on mainnet", () => {
    const cfg = mainnet();
    cfg.features.simulateAsucPayout = true;
    expect(rejects(cfg)).toBe(true);
  });

  it("a null frxUSD (MockFrxUSD) is rejected on mainnet", () => {
    const cfg = mainnet();
    cfg.frxUSD = null;
    expect(rejects(cfg)).toBe(true);
  });

  it("the network name pins the chain ID, so chain 252 can't be relabelled as a testnet name", () => {
    const cfg = mainnet();
    cfg.network = "fraxtal-testnet";
    expect(rejects(cfg)).toBe(true);
  });

  it("fraxtal.json as committed fails the full schema until the endpoints are filled in", () => {
    expect(rejects(structuredClone(RAW_CONFIGS.fraxtal) as RawConfig)).toBe(true);
  });
});
