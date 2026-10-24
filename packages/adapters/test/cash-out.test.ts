import { mockFrxUsdAbi } from "@app/abi";
import { loadNetworkConfig } from "@app/config";
import {
  type Address,
  type Hex,
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  pad,
  parseEther,
} from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AdapterConfigError,
  ETHEREUM_EID,
  createCashOut,
  createMeshCashOut,
  createSimulatedCashOut,
  frxUsdAddress,
  oftAbi,
} from "../index.ts";
import { ANVIL, type Anvil, HAS_ARTIFACTS, type System, deploySystem, startAnvil } from "./support/anvil.ts";
import { scenario } from "./support/scenario.ts";

const FROM = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const LIQUIDATION = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const FRXUSD = "0xFc00000000000000000000000000000000000001";
const OFT = "0x1111111111111111111111111111111111111111";

describe("CashOut factory", () => {
  it("every testnet config uses the simulated cash-out to cashOutSink", () => {
    for (const network of ["local", "fraxtal-testnet", "sepolia"] as const) {
      const config = loadNetworkConfig(network);
      if (!config.deployed.frxUSD && !config.frxUSD) {
        expect(() => createCashOut(config)).toThrow(/deploy first/);
        continue;
      }
      const cashOut = createCashOut(config);
      expect(cashOut.kind).toBe("simulated");
      expect(cashOut.simulated).toBe(true);
    }
  });

  it("the simulated transfer is one frxUSD transfer to the sink", async () => {
    const config = loadNetworkConfig("fraxtal-testnet");
    const calls = await createCashOut(config).buildTransfer({ from: FROM, amount: parseEther("25"), liquidationAddress: LIQUIDATION });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.to.toLowerCase()).toBe(FRXUSD.toLowerCase());
    expect(calls[0]?.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: erc20Abi, data: calls[0]?.data ?? "0x" });
    expect(decoded).toEqual({ functionName: "transfer", args: [config.cashOutSink, parseEther("25")] });
  });

  it("'mesh' needs fraxMesh, and uses the mesh builder once it's set", () => {
    const base = loadNetworkConfig("fraxtal-testnet");
    const mesh = { ...base, adapters: { ...base.adapters, cashOut: "mesh" as const } };
    expect(() => createCashOut(mesh)).toThrow(AdapterConfigError);
    expect(createCashOut({ ...mesh, fraxMesh: OFT }).kind).toBe("mesh");
  });

  it("uses the deployed token when there is one, else the configured frxUSD", () => {
    expect(frxUsdAddress(loadNetworkConfig("local"))).toBe(loadNetworkConfig("local").deployed.frxUSD);
    expect(frxUsdAddress(loadNetworkConfig("fraxtal-testnet")).toLowerCase()).toBe(FRXUSD.toLowerCase());
    expect(() => frxUsdAddress(loadNetworkConfig("sepolia"))).toThrow(AdapterConfigError);
  });

  it("rejects a zero amount", async () => {
    const cashOut = createSimulatedCashOut({ frxUSD: FRXUSD, sink: LIQUIDATION });
    await expect(cashOut.buildTransfer({ from: FROM, amount: 0n, liquidationAddress: LIQUIDATION })).rejects.toThrow(RangeError);
  });
});

/** An EIP-1193 provider that answers eth_call for a fake LayerZero OFT, so the mesh builder's reads are real calls. */
function fakeOft(options: { token: Address; approvalRequired: boolean; sharedDecimals: number; nativeFee: bigint; feeBps?: bigint }) {
  const seen: string[] = [];
  const transport = custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      if (method === "eth_chainId") return "0xfc";
      if (method !== "eth_call") throw new Error(`unexpected ${method}`);
      const [{ to, data }] = params as [{ to: Address; data: Hex }];
      if (to.toLowerCase() !== OFT.toLowerCase()) throw new Error(`call to ${to}`);
      const call = decodeFunctionData({ abi: oftAbi, data });
      seen.push(call.functionName);
      switch (call.functionName) {
        case "token":
          return encodeFunctionResult({ abi: oftAbi, functionName: "token", result: options.token });
        case "approvalRequired":
          return encodeFunctionResult({ abi: oftAbi, functionName: "approvalRequired", result: options.approvalRequired });
        case "sharedDecimals":
          return encodeFunctionResult({ abi: oftAbi, functionName: "sharedDecimals", result: options.sharedDecimals });
        case "quoteOFT": {
          const [p] = call.args;
          const received = p.amountLD - (p.amountLD * (options.feeBps ?? 0n)) / 10_000n;
          return encodeFunctionResult({
            abi: oftAbi,
            functionName: "quoteOFT",
            result: [
              { minAmountLD: 0n, maxAmountLD: 2n ** 128n },
              [],
              { amountSentLD: p.amountLD, amountReceivedLD: received },
            ],
          });
        }
        case "quoteSend":
          return encodeFunctionResult({
            abi: oftAbi,
            functionName: "quoteSend",
            result: { nativeFee: options.nativeFee, lzTokenFee: 0n },
          });
        default:
          throw new Error(`unexpected ${call.functionName}`);
      }
    },
  });
  return { publicClient: createPublicClient({ transport }), seen };
}

describe("mesh CashOut (U-17, U-53)", () => {
  it("approves the adapter, then sends to the liquidation address on Ethereum with the quoted fee", async () => {
    const { publicClient, seen } = fakeOft({ token: FRXUSD, approvalRequired: true, sharedDecimals: 6, nativeFee: 12_345n, feeBps: 10n });
    const cashOut = createMeshCashOut({ publicClient, oft: OFT, frxUSD: FRXUSD });
    expect(cashOut.simulated).toBe(false);

    const amount = parseEther("100") + 123n; // 123 wei of dust below 6 shared decimals
    const calls = await cashOut.buildTransfer({ from: FROM, amount, liquidationAddress: LIQUIDATION });
    expect(seen).toEqual(expect.arrayContaining(["token", "approvalRequired", "sharedDecimals", "quoteOFT", "quoteSend"]));
    expect(calls).toHaveLength(2);

    const [approve, send] = calls;
    expect(approve?.to).toBe(FRXUSD);
    expect(decodeFunctionData({ abi: erc20Abi, data: approve?.data ?? "0x" })).toEqual({
      functionName: "approve",
      args: [OFT, parseEther("100")],
    });

    expect(send?.to).toBe(OFT);
    expect(send?.value).toBe(12_345n);
    const decoded = decodeFunctionData({ abi: oftAbi, data: send?.data ?? "0x" });
    if (decoded.functionName !== "send") throw new Error("expected send");
    const [sendParam, fee, refund] = decoded.args;
    expect(sendParam).toEqual({
      dstEid: ETHEREUM_EID,
      to: pad(LIQUIDATION, { size: 32 }).toLowerCase(),
      amountLD: parseEther("100"),
      minAmountLD: parseEther("99.9"),
      extraOptions: "0x",
      composeMsg: "0x",
      oftCmd: "0x",
    });
    expect(fee).toEqual({ nativeFee: 12_345n, lzTokenFee: 0n });
    expect(refund).toBe(FROM);
  });

  it("skips the approval when the OFT is the token itself", async () => {
    const { publicClient } = fakeOft({ token: FRXUSD, approvalRequired: false, sharedDecimals: 6, nativeFee: 1n });
    const calls = await createMeshCashOut({ publicClient, oft: OFT, frxUSD: FRXUSD }).buildTransfer({
      from: FROM,
      amount: parseEther("5"),
      liquidationAddress: LIQUIDATION,
    });
    expect(calls.map((c) => c.to)).toEqual([OFT]);
  });

  it("refuses an OFT that moves some other token, or an amount below its smallest unit", async () => {
    const wrong = fakeOft({ token: "0x2222222222222222222222222222222222222222", approvalRequired: true, sharedDecimals: 6, nativeFee: 1n });
    await expect(
      createMeshCashOut({ publicClient: wrong.publicClient, oft: OFT, frxUSD: FRXUSD }).buildTransfer({
        from: FROM,
        amount: parseEther("5"),
        liquidationAddress: LIQUIDATION,
      }),
    ).rejects.toThrow(/not frxUSD/);

    const right = fakeOft({ token: FRXUSD, approvalRequired: true, sharedDecimals: 6, nativeFee: 1n });
    await expect(
      createMeshCashOut({ publicClient: right.publicClient, oft: OFT, frxUSD: FRXUSD }).buildTransfer({
        from: FROM,
        amount: 10n ** 12n - 1n,
        liquidationAddress: LIQUIDATION,
      }),
    ).rejects.toThrow(/smallest unit/);
  });
});

describe.skipIf(ANVIL === null || !HAS_ARTIFACTS)("simulated CashOut on anvil", () => {
  let anvil: Anvil;
  let system: System;
  beforeAll(async () => {
    anvil = await startAnvil();
    system = await deploySystem(anvil);
  }, 60_000);
  afterAll(() => anvil?.stop());

  it("the built calls move frxUSD from the claimant to cashOutSink", async () => {
    const s = scenario(anvil, system);
    const sink = system.config.cashOutSink;
    if (!sink) throw new Error("local has no cashOutSink");
    await s.mint(s.claimant, parseEther("40"));
    const calls = await createCashOut(system.config).buildTransfer({
      from: s.claimant.account.address,
      amount: parseEther("40"),
      liquidationAddress: LIQUIDATION,
    });
    for (const call of calls) await s.send(s.claimant.sendTransaction(call));
    const balance = (who: Address) =>
      anvil.publicClient.readContract({ address: system.frxUSD, abi: mockFrxUsdAbi, functionName: "balanceOf", args: [who] });
    expect(await balance(sink)).toBe(parseEther("40"));
    expect(await balance(s.claimant.account.address)).toBe(0n);
  });
});
