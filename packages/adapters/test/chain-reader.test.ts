import { loadNetworkConfig } from "@app/config";
import { type PublicClient, createPublicClient, http } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AdapterConfigError,
  type ChainReader,
  type ClaimView,
  createChainReader,
  CLAIM_STATES,
  type ClaimState,
  createGoldskyChainReader,
  logIndexFromId,
  refreshClaims,
  toClaimView,
} from "../index.ts";
import { ANVIL, type Anvil, HAS_ARTIFACTS, type System, deploySystem, startAnvil } from "./support/anvil.ts";
import { scenario, usd } from "./support/scenario.ts";

const canRun = ANVIL !== null && HAS_ARTIFACTS;
if (!canRun) console.warn("skipping anvil tests: need anvil and contracts/out (run pnpm --filter @app/abi generate)");

describe.skipIf(!canRun)("rpc ChainReader against the real contracts on anvil", () => {
  let anvil: Anvil;
  let system: System;
  let reader: ChainReader;
  let s: ReturnType<typeof scenario>;
  const ids = { funded: 0n, rejected: 0n, cancelled: 0n, submitted: 0n };
  let orgs: { bab: bigint; hacks: bigint };

  beforeAll(async () => {
    anvil = await startAnvil();
    system = await deploySystem(anvil);
    s = scenario(anvil, system);
    // a chunk of 3 blocks makes the reader split every scan into many eth_getLogs calls
    reader = createChainReader(system.config, { publicClient: anvil.publicClient, logChunkSize: 3n });

    orgs = { bab: await s.addOrg("Blockchain at Berkeley"), hacks: await s.addOrg("Cal Hacks") };
    await s.setOfficer(orgs.bab, s.officer);
    await s.setOfficer(orgs.hacks, s.officer);
    await s.deposit(s.lender, usd("5000"));

    ids.funded = await s.submit(s.claimant, s.officer, orgs.bab, usd("500"), usd("400"), "packet-1");
    await s.approve(ids.funded, usd("400"));
    await s.purchase(s.claimant, ids.funded);
    await s.settle(s.claimant, ids.funded, usd("150"));

    ids.rejected = await s.submit(s.claimant2, s.officer, orgs.hacks, usd("300"), usd("300"), "packet-2");
    await s.reject(ids.rejected, "MISSING_RECEIPTS");

    ids.cancelled = await s.submit(s.claimant, s.officer, orgs.bab, usd("80"), usd("80"), "packet-3");
    await s.cancel(s.claimant, ids.cancelled);

    ids.submitted = await s.submit(s.claimant2, s.officer, orgs.bab, usd("60"), usd("60"), "packet-4");
  }, 60_000);

  afterAll(() => anvil?.stop());

  it("the factory picks rpc for local", () => {
    expect(reader.kind).toBe("rpc");
  });

  it("getPoolStats matches the pool after a deposit, a purchase, and a partial settle", async () => {
    const stats = await reader.getPoolStats();
    expect(stats.shareDecimals).toBe(24);
    expect(stats.outstandingPrincipal).toBe(usd("250"));
    expect(stats.idleCash).toBe(usd("4750"));
    expect(stats.totalAssets).toBe(stats.idleCash + stats.outstandingPrincipal);
    expect(stats.totalLosses).toBe(0n);
    expect(stats.totalSupply).toBe(usd("5000") * 10n ** 6n);
    expect(stats.sharePrice).toBe(usd("1"));
  });

  it("getClaim decodes the struct with enum names and amountRemaining", async () => {
    const claim = await reader.getClaim(ids.funded);
    expect(claim).toMatchObject<Partial<ClaimView>>({
      id: ids.funded,
      recipient: s.claimant.account.address,
      guarantor: s.officer.account.address,
      orgId: orgs.bab,
      recipientType: "Member",
      state: "Funded",
      callReason: "None",
      faceValue: usd("500"),
      approvedAmount: usd("400"),
      purchasePrice: usd("400"),
      amountDue: usd("400"),
      amountPaid: usd("150"),
      amountRemaining: usd("250"),
      principalWrittenOff: false,
    });
    expect(claim.dueAt - claim.purchasedAt).toBe(system.config.params.overdueWindowSeconds);
  });

  it("an unused claim ID reads as state None", async () => {
    expect((await reader.getClaim(999n)).state).toBe("None");
  });

  it("listClaims filters by recipient, guarantor, org, and state", async () => {
    const idsOf = (claims: ClaimView[]) => claims.map((c) => c.id);
    expect(idsOf(await reader.listClaims())).toEqual([ids.funded, ids.rejected, ids.cancelled, ids.submitted]);
    expect(idsOf(await reader.listClaims({ recipient: s.claimant.account.address }))).toEqual([ids.funded, ids.cancelled]);
    expect(idsOf(await reader.listClaims({ guarantor: s.officer.account.address.toLowerCase() as `0x${string}` }))).toHaveLength(4);
    expect(idsOf(await reader.listClaims({ orgId: orgs.hacks }))).toEqual([ids.rejected]);
    expect(idsOf(await reader.listClaims({ states: ["Submitted", "Funded"] }))).toEqual([ids.funded, ids.submitted]);
    expect(await reader.listClaims({ recipient: s.lender.account.address })).toEqual([]);
  });

  it("refreshClaims matches listClaims, then re-reads only the claims that can still change (I-6)", async () => {
    const first = await refreshClaims(reader, []);
    expect(first).toEqual(await reader.listClaims());
    expect(await reader.claimCount()).toBe(BigInt(first.length));
    const reads: bigint[][] = [];
    const counting = { claimCount: () => reader.claimCount(), getClaims: (list: readonly bigint[]) => (reads.push([...list]), reader.getClaims(list)) };
    expect(await refreshClaims(counting, first)).toEqual(first);
    // the rejected and cancelled claims are final, so only the funded and submitted ones are read again
    expect(reads).toEqual([[ids.funded, ids.submitted]]);
  });

  it("getOrgExposure reports each org's outstanding principal against perOrgCap", async () => {
    expect(await reader.getOrgExposure()).toEqual([
      { orgId: orgs.bab, name: "Blockchain at Berkeley", active: true, outstanding: usd("250"), cap: usd("10000"), customCap: false },
      { orgId: orgs.hacks, name: "Cal Hacks", active: true, outstanding: 0n, cap: usd("10000"), customCap: false },
    ]);
  });

  it("getOrgExposure uses an org's own cap once the admin sets one, and perOrgCap again once it's cleared", async () => {
    await s.setOrgCap(orgs.bab, usd("50000"));
    const [bab, hacks] = await reader.getOrgExposure();
    expect(bab).toMatchObject({ cap: usd("50000"), customCap: true });
    expect(hacks).toMatchObject({ cap: usd("10000"), customCap: false });
    await s.setOrgCap(orgs.bab, 0n);
    expect((await reader.getOrgExposure())[0]).toMatchObject({ cap: usd("10000"), customCap: false });
  });

  it("getClaimEvents returns one claim's history in order, across log chunks", async () => {
    const events = await reader.getClaimEvents(ids.funded);
    expect(events.map((e) => e.name)).toEqual(["ClaimSubmitted", "ClaimApproved", "ClaimPurchased", "ClaimSettlementPaid"]);
    expect(events.every((e) => e.claimId === ids.funded)).toBe(true);
    const paid = events[3];
    expect(paid?.args).toMatchObject({ paid: usd("150"), principalPortion: usd("150"), amountRemaining: usd("250") });
    expect((await reader.getClaimEvents(ids.rejected)).map((e) => e.name)).toEqual(["ClaimSubmitted", "ClaimRejected"]);
  });

  it("getEvents returns claim and org events for a block range and says where it stopped", async () => {
    const all = await reader.getEvents({ fromBlock: 0n });
    const names = all.events.map((e) => e.name);
    expect(names.filter((n) => n === "OrgAdded")).toHaveLength(2);
    expect(names.filter((n) => n === "OfficerSet")).toHaveLength(2);
    expect(names.filter((n) => n === "ClaimSubmitted")).toHaveLength(4);
    expect(all.toBlock).toBe(await anvil.publicClient.getBlockNumber());
    const sorted = [...all.events].sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex);
    expect(all.events).toEqual(sorted);

    const firstSubmit = all.events.find((e) => e.name === "ClaimSubmitted");
    if (!firstSubmit) throw new Error("no ClaimSubmitted");
    const tail = await reader.getEvents({ fromBlock: firstSubmit.blockNumber + 1n });
    expect(tail.events.some((e) => e.contract === "OrgRegistry")).toBe(false);
    expect(tail.events.map((e) => e.name)).toContain("ClaimPurchased");

    const past = await reader.getEvents({ fromBlock: all.toBlock + 1n });
    expect(past).toEqual({ events: [], toBlock: all.toBlock });
  });
});

describe.skipIf(!canRun)("rpc ChainReader freshness", () => {
  let anvil: Anvil;
  let system: System;
  beforeAll(async () => {
    anvil = await startAnvil();
    system = await deploySystem(anvil);
  }, 60_000);
  afterAll(() => anvil?.stop());

  it("sees a block mined right after the previous read (no cached head)", async () => {
    // a long-lived client, like a warm edge worker, with viem's default 4s polling and block number cache
    const warm = createPublicClient({ chain: anvil.chain, transport: http(anvil.rpcUrl) }) as PublicClient;
    const reader = createChainReader(system.config, { publicClient: warm });
    const s = scenario(anvil, system);
    const before = await reader.getEvents({ fromBlock: 0n });
    await s.addOrg("Right After");
    const after = await reader.getEvents({ fromBlock: before.toBlock + 1n });
    expect(after.events.map((e) => e.name)).toContain("OrgAdded");
  });
});

describe("goldsky ChainReader", () => {
  const CLAIM_ID = 7n;
  const TX = `0x${"ab".repeat(32)}` as const;
  const id = (logIndex: number) => `${TX}${logIndex.toString(16).padStart(2, "0")}000000`;

  function fakeState(): ChainReader {
    const claim = (n: bigint): ClaimView => ({
      ...toClaimView({
        id: n,
        recipient: "0x1111111111111111111111111111111111111111",
        orgId: 2n,
        recipientType: 0,
        state: 3,
        callReason: 0,
        principalWrittenOff: false,
        guarantor: "0x2222222222222222222222222222222222222222",
        feeBps: 0,
        submittedAt: 0,
        approvalExpiresAt: 0,
        faceValue: 0n,
        requestedAmount: 0n,
        approvedAmount: 0n,
        purchasePrice: 0n,
        amountDue: 0n,
        amountPaid: 0n,
        writtenOffPrincipal: 0n,
        purchasedAt: 0,
        dueAt: 0,
        guarantorCalledAt: 0,
        writeOffEligibleAt: 0,
        feeAccruedAt: 0,
        packetHash: `0x${"00".repeat(32)}`,
      }),
    });
    const unused = () => Promise.reject(new Error("unused"));
    return {
      kind: "rpc",
      getPoolStats: unused,
      getClaim: async (n) => claim(n),
      getClaims: async (list) => list.map(claim),
      claimCount: unused,
      listClaims: unused,
      getOrgExposure: unused,
      getClaimEvents: unused,
      getEvents: unused,
    };
  }

  function fakeSubgraph() {
    const queries: string[] = [];
    const rows: Record<string, Record<string, unknown>[]> = {
      claimSubmitteds: [
        {
          id: id(1),
          block_number: "10",
          transactionHash_: TX,
          claimId: CLAIM_ID.toString(),
          orgId: "2",
          recipient: "0x1111111111111111111111111111111111111111",
          guarantor: "0x2222222222222222222222222222222222222222",
          recipientType: 0,
          faceValue: "500000000000000000000",
          requestedAmount: "400000000000000000000",
          packetHash: `0x${"cd".repeat(32)}`,
        },
      ],
      claimApproveds: [
        { id: id(4), block_number: "12", transactionHash_: TX, claimId: CLAIM_ID.toString(), amount: "400000000000000000000", approvalExpiresAt: "1790000000" },
      ],
      orgAddeds: [{ id: id(0), block_number: "9", transactionHash_: TX, orgId: "2", name: "Cal Hacks" }],
    };
    const fetch = async (_url: string, init?: RequestInit) => {
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      queries.push(query);
      if (query.includes("_meta")) return Response.json({ data: { _meta: { block: { number: 20 } } } });
      const collection = /page: (\w+)\(/.exec(query)?.[1] ?? "";
      const page = query.includes(`id_gt: "0x"`) ? (rows[collection] ?? []) : [];
      return Response.json({ data: { page } });
    };
    return { fetch, queries };
  }

  it("reads history from the subgraph and decodes fields by ABI type", async () => {
    const graph = fakeSubgraph();
    const reader = createGoldskyChainReader({ url: "https://subgraph.example.test", state: fakeState(), fetch: graph.fetch });
    const events = await reader.getClaimEvents(CLAIM_ID);
    expect(events.map((e) => [e.name, e.logIndex])).toEqual([
      ["ClaimSubmitted", 1],
      ["ClaimApproved", 4],
    ]);
    expect(events[0]?.args).toMatchObject({
      claimId: CLAIM_ID,
      orgId: 2n,
      recipientType: 0,
      faceValue: usd("500"),
      recipient: "0x1111111111111111111111111111111111111111",
    });
    expect(events[1]?.args.approvalExpiresAt).toBe(1_790_000_000);
    expect(graph.queries.every((q) => q.includes(`claimId: "7"`))).toBe(true);
  });

  it("getEvents stops at the subgraph's indexed block", async () => {
    const graph = fakeSubgraph();
    const reader = createGoldskyChainReader({ url: "https://subgraph.example.test", state: fakeState(), fetch: graph.fetch });
    const result = await reader.getEvents({ fromBlock: 0n, toBlock: 1_000n });
    expect(result.toBlock).toBe(20n);
    expect(result.events.map((e) => e.name)).toEqual(["OrgAdded", "ClaimSubmitted", "ClaimApproved"]);
    expect(graph.queries.some((q) => q.includes(`block_number_lte: "20"`))).toBe(true);
  });

  it("listClaims finds IDs in the subgraph and reads current state from the chain", async () => {
    const graph = fakeSubgraph();
    const reader = createGoldskyChainReader({ url: "https://subgraph.example.test", state: fakeState(), fetch: graph.fetch });
    const claims = await reader.listClaims({ recipient: "0x1111111111111111111111111111111111111111", states: ["Funded"] });
    expect(claims.map((c) => c.id)).toEqual([CLAIM_ID]);
    expect(graph.queries[0]).toContain(`recipient: "0x1111111111111111111111111111111111111111"`);
  });

  it("surfaces GraphQL errors", async () => {
    const reader = createGoldskyChainReader({
      url: "https://subgraph.example.test",
      state: fakeState(),
      fetch: async () => Response.json({ errors: [{ message: "Type `Query` has no field `claimSubmitteds`" }] }),
    });
    await expect(reader.getClaimEvents(1n)).rejects.toThrow(/has no field/);
  });

  it("recovers the log index from an instant-subgraph ID", () => {
    expect(logIndexFromId(id(0))).toBe(0);
    expect(logIndexFromId(`${TX}2c010000`)).toBe(300);
    expect(logIndexFromId("0x1234")).toBe(0);
  });

  it("the factory refuses goldsky without goldskyUrl", () => {
    const config = { ...loadNetworkConfig("local"), adapters: { ...loadNetworkConfig("local").adapters, chainReader: "goldsky" as const } };
    expect(() => createChainReader(config)).toThrow(AdapterConfigError);
    const withUrl = { ...config, goldskyUrl: "https://subgraph.example.test" };
    expect(createChainReader(withUrl).kind).toBe("goldsky");
  });
});

describe("refreshClaims", () => {
  const view = (id: bigint, state: ClaimState, amountPaid = 0n): ClaimView => ({
    ...toClaimView({
      id,
      recipient: "0x1111111111111111111111111111111111111111",
      orgId: 1n,
      recipientType: 0,
      state: CLAIM_STATES.indexOf(state),
      callReason: 0,
      principalWrittenOff: false,
      guarantor: "0x2222222222222222222222222222222222222222",
      feeBps: 0,
      submittedAt: 0,
      approvalExpiresAt: 0,
      faceValue: 100n,
      requestedAmount: 100n,
      approvedAmount: 100n,
      purchasePrice: 100n,
      amountDue: 100n,
      amountPaid,
      writtenOffPrincipal: 0n,
      purchasedAt: 0,
      dueAt: 0,
      guarantorCalledAt: 0,
      writeOffEligibleAt: 0,
      feeAccruedAt: 0,
      packetHash: `0x${"00".repeat(32)}`,
    }),
  });

  /** A reader over `chain` that records every batch of IDs it's asked for. */
  function reader(chain: ClaimView[]) {
    const reads: bigint[][] = [];
    return {
      reads,
      claimCount: async () => BigInt(chain.length),
      getClaims: async (list: readonly bigint[]) => {
        reads.push([...list]);
        return list.map((id) => chain[Number(id) - 1] ?? view(id, "None"));
      },
    };
  }

  it("reads every claim the first time", async () => {
    const chain = [view(1n, "Funded"), view(2n, "Settled")];
    const r = reader(chain);
    expect(await refreshClaims(r, [])).toEqual(chain);
    expect(r.reads).toEqual([[1n, 2n]]);
  });

  it("carries final claims over and re-reads open, written-off, and new ones", async () => {
    const before = [view(1n, "Settled"), view(2n, "Recovered"), view(3n, "Rejected"), view(4n, "Cancelled"), view(5n, "WrittenOff"), view(6n, "Funded")];
    // since the last poll: claim 5 took a payment, claim 6 settled, and claim 7 is new
    const now = [...before.slice(0, 4), view(5n, "WrittenOff", 40n), view(6n, "Settled", 100n), view(7n, "Submitted")];
    const r = reader(now);
    expect(await refreshClaims(r, before)).toEqual(now);
    expect(r.reads).toEqual([[5n, 6n, 7n]]);
  });

  it("makes no claim reads when every claim is final and nothing is new", async () => {
    const chain = [view(1n, "Settled"), view(2n, "Cancelled")];
    const r = reader(chain);
    expect(await refreshClaims(r, chain)).toEqual(chain);
    expect(r.reads).toEqual([]);
  });

  it("starts over when the claim count drops, as it does after anvil restarts", async () => {
    const stale = [view(1n, "Settled"), view(2n, "Settled"), view(3n, "Settled")];
    const chain = [view(1n, "Submitted")];
    const r = reader(chain);
    expect(await refreshClaims(r, stale)).toEqual(chain);
    expect(r.reads).toEqual([[1n]]);
  });
});
