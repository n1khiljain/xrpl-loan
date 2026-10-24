import { loadNetworkConfig } from "@app/config";
import { type Address, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AdapterConfigError,
  DRIP_WINDOW_MS,
  type GasSponsor,
  createDripGasSponsor,
  createGasSponsor,
  createMemoryDripLedger,
  createMockGasSponsor,
  withDripPolicy,
} from "../index.ts";
import { ANVIL, type Anvil, startAnvil } from "./support/anvil.ts";

const WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
/** A throwaway key made per run, so no key is ever written in a file. */
const TEST_KEY = generatePrivateKey();

describe("GasSponsor factory", () => {
  it("local uses the mock; the testnets use the drip", () => {
    expect(createGasSponsor(loadNetworkConfig("local")).kind).toBe("mock");
    for (const network of ["fraxtal-testnet", "sepolia"] as const) {
      const sponsor = createGasSponsor(loadNetworkConfig(network), {
        dripPrivateKey: TEST_KEY,
        amountWei: "1000000000000000",
        thresholdWei: "500000000000000",
      });
      expect(sponsor.kind).toBe("drip");
    }
  });

  it("the drip refuses to start without its secrets", () => {
    const config = loadNetworkConfig("fraxtal-testnet");
    expect(() => createGasSponsor(config)).toThrow(/DRIP_PRIVATE_KEY/);
    expect(() => createGasSponsor(config, { dripPrivateKey: "0x1234" })).toThrow(AdapterConfigError);
    expect(() => createGasSponsor(config, { dripPrivateKey: TEST_KEY, amountWei: "1e15", thresholdWei: "1" })).toThrow(
      /DRIP_AMOUNT_WEI/,
    );
    expect(() => createGasSponsor(config, { dripPrivateKey: TEST_KEY, amountWei: "1" })).toThrow(/DRIP_THRESHOLD_WEI/);
  });

  it("the mock always reports funded and sends nothing", async () => {
    const sponsor = createMockGasSponsor();
    await expect(sponsor.ensureGas(WALLET)).resolves.toEqual({ funded: true });
    expect(sponsor.calls).toEqual([WALLET]);
  });
});

describe("withDripPolicy (FR-B7)", () => {
  function setup(sponsor: GasSponsor = createMockGasSponsor()) {
    let now = new Date("2026-10-11T09:00:00Z");
    const ledger = createMemoryDripLedger({ profiles: [WALLET], now: () => now });
    const guarded = withDripPolicy(sponsor, { ledger, amountWei: 10n });
    return { guarded, ledger, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
  }

  it("refuses wallets without a profile", async () => {
    const { guarded } = setup();
    await expect(guarded.ensureGas("0x0000000000000000000000000000000000000001")).resolves.toEqual({
      funded: false,
      reason: "no_profile",
    });
  });

  it("allows one top-up per wallet in any 24 hours", async () => {
    const { guarded, advance } = setup();
    await expect(guarded.ensureGas(WALLET)).resolves.toEqual({ funded: true });
    advance(DRIP_WINDOW_MS - 1);
    await expect(guarded.ensureGas(WALLET.toLowerCase() as Address)).resolves.toEqual({ funded: false, reason: "rate_limited" });
    advance(1);
    await expect(guarded.ensureGas(WALLET)).resolves.toEqual({ funded: true });
  });

  it("two requests at the same moment get one top-up", async () => {
    const { guarded } = setup();
    const results = await Promise.all([guarded.ensureGas(WALLET), guarded.ensureGas(WALLET)]);
    expect(results.filter((r) => r.funded)).toHaveLength(1);
  });

  it("a balance above the threshold, or a failed send, doesn't use up the day", async () => {
    let mode: "above" | "fail" | "ok" = "above";
    const sponsor: GasSponsor = {
      kind: "drip",
      async ensureGas() {
        if (mode === "above") return { funded: false, reason: "above_threshold" };
        if (mode === "fail") throw new Error("rpc down");
        return { funded: true, txHash: `0x${"11".repeat(32)}` };
      },
    };
    const { guarded, ledger } = setup(sponsor);
    await expect(guarded.ensureGas(WALLET)).resolves.toEqual({ funded: false, reason: "above_threshold" });
    mode = "fail";
    await expect(guarded.ensureGas(WALLET)).rejects.toThrow("rpc down");
    mode = "ok";
    await expect(guarded.ensureGas(WALLET)).resolves.toMatchObject({ funded: true });
    expect([...ledger.rows.values()]).toEqual([
      expect.objectContaining({ wallet: WALLET.toLowerCase(), txHash: `0x${"11".repeat(32)}`, amountWei: 10n }),
    ]);
  });
});

describe.skipIf(ANVIL === null)("drip GasSponsor on anvil", () => {
  let anvil: Anvil;
  beforeAll(async () => {
    anvil = await startAnvil();
  });
  afterAll(() => anvil?.stop());

  it("tops up a wallet below the threshold and skips one above it", async () => {
    const empty = privateKeyToAccount(generatePrivateKey()).address;
    const sponsor = createDripGasSponsor({
      publicClient: anvil.publicClient,
      walletClient: anvil.wallet(9),
      amountWei: parseEther("0.01"),
      thresholdWei: parseEther("0.005"),
    });
    const first = await sponsor.ensureGas(empty);
    expect(first.funded).toBe(true);
    expect(first.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await anvil.publicClient.getBalance({ address: empty })).toBe(parseEther("0.01"));

    await expect(sponsor.ensureGas(empty)).resolves.toEqual({ funded: false, reason: "above_threshold" });
    expect(await anvil.publicClient.getBalance({ address: empty })).toBe(parseEther("0.01"));
  });

  it("rejects a zero amount or threshold", () => {
    const base = { publicClient: anvil.publicClient, walletClient: anvil.wallet(9) };
    expect(() => createDripGasSponsor({ ...base, amountWei: 0n, thresholdWei: 1n })).toThrow(RangeError);
    expect(() => createDripGasSponsor({ ...base, amountWei: 1n, thresholdWei: 0n })).toThrow(RangeError);
  });
});
