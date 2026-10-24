import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { claimNftAbi, claimRegistryAbi, mockFrxUsdAbi, orgRegistryAbi, receivablesPoolAbi } from "@app/abi";
import { type NetworkConfig, loadNetworkConfig, paramsAsBigInt } from "@app/config";
import {
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

const ROOT = resolve(import.meta.dirname, "../../../..");
const OUT = join(ROOT, "contracts/out");

/** anvil's public dev mnemonic, the same one `Deploy.s.sol` uses on local. Not a secret. */
const DEV_MNEMONIC = "test test test test test test test test test test test junk";

export function devAccount(index: number) {
  return mnemonicToAccount(DEV_MNEMONIC, { addressIndex: index });
}

function anvilBinary(): string | null {
  const candidates = [process.env.ANVIL_BIN, join(homedir(), ".foundry/bin/anvil"), "anvil"].filter(
    (c): c is string => Boolean(c),
  );
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (probe.status === 0) return candidate;
  }
  return null;
}

export const ANVIL = anvilBinary();
export const HAS_ARTIFACTS = existsSync(join(OUT, "ClaimRegistry.sol/ClaimRegistry.json"));

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? ok(address.port) : fail(new Error("no port"))));
    });
  });
}

function bytecode(file: string, name: string): Hex {
  const artifact = JSON.parse(readFileSync(join(OUT, `${file}/${name}.json`), "utf8")) as { bytecode: { object: Hex } };
  return artifact.bytecode.object;
}

export type Anvil = {
  rpcUrl: string;
  chain: Chain;
  publicClient: PublicClient;
  wallet(index: number): WalletClient<Transport, Chain, Account>;
  stop(): void;
};

export async function startAnvil(): Promise<Anvil> {
  if (!ANVIL) throw new Error("anvil not found; install Foundry or set ANVIL_BIN");
  const port = await freePort();
  const child: ChildProcess = spawn(ANVIL, ["--port", String(port), "--silent"], { stdio: "ignore" });
  const rpcUrl = `http://127.0.0.1:${port}`;
  const chain = { ...foundry, rpcUrls: { default: { http: [rpcUrl] } } } as const satisfies Chain;
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl), pollingInterval: 50 }) as PublicClient;
  for (let i = 0; ; i++) {
    try {
      await publicClient.getChainId();
      break;
    } catch (error) {
      if (i > 100) throw error;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  return {
    rpcUrl,
    chain,
    publicClient,
    wallet: (index) => createWalletClient({ account: devAccount(index), chain, transport: http(rpcUrl) }),
    stop: () => child.kill(),
  };
}

export type System = {
  frxUSD: Address;
  orgRegistry: Address;
  claimNft: Address;
  pool: Address;
  claimRegistry: Address;
  block: bigint;
  /** `deployments/local.json` with these addresses filled in and the RPC URL pointed at this anvil. */
  config: NetworkConfig;
};

/** Deploys and wires the contracts the way `Deploy.s.sol` does on local, from the forge artifacts. */
export async function deploySystem(anvil: Anvil): Promise<System> {
  const admin = anvil.wallet(0);
  const base = loadNetworkConfig("local");
  const p = paramsAsBigInt(base);
  const block = await anvil.publicClient.getBlockNumber();

  async function deploy(abi: Abi, file: string, name: string, args: readonly unknown[]): Promise<Address> {
    const hash = await admin.deployContract({ abi, bytecode: bytecode(file, name), args });
    const receipt = await anvil.publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`${name} did not deploy`);
    return receipt.contractAddress;
  }
  async function send(hash: Promise<Hex>) {
    const receipt = await anvil.publicClient.waitForTransactionReceipt({ hash: await hash });
    if (receipt.status !== "success") throw new Error(`tx ${receipt.transactionHash} reverted`);
  }

  const me = admin.account.address;
  const frxUSD = await deploy(mockFrxUsdAbi, "MockFrxUSD.sol", "MockFrxUSD", []);
  const orgRegistry = await deploy(orgRegistryAbi, "OrgRegistry.sol", "OrgRegistry", [me]);
  const claimNft = await deploy(claimNftAbi, "ClaimNFT.sol", "ClaimNFT", [me]);
  const pool = await deploy(receivablesPoolAbi, "ReceivablesPool.sol", "ReceivablesPool", [frxUSD, me]);
  const claimRegistry = await deploy(claimRegistryAbi, "ClaimRegistry.sol", "ClaimRegistry", [
    me,
    pool,
    claimNft,
    orgRegistry,
    {
      advanceRateBps: Number(p.advanceRateBps),
      feeBps: Number(p.feeBps),
      perClaimCap: p.perClaimCap,
      perOrgCap: p.perOrgCap,
      overdueWindow: base.params.overdueWindowSeconds,
      approvalExpiry: base.params.approvalExpirySeconds,
      writeOffGrace: base.params.writeOffGraceSeconds,
    },
  ]);

  await send(admin.writeContract({ address: pool, abi: receivablesPoolAbi, functionName: "setRegistry", args: [claimRegistry] }));
  await send(admin.writeContract({ address: claimNft, abi: claimNftAbi, functionName: "setRegistry", args: [claimRegistry] }));
  await send(admin.writeContract({ address: pool, abi: receivablesPoolAbi, functionName: "setDepositCap", args: [p.poolDepositCap] }));
  await send(admin.writeContract({ address: pool, abi: receivablesPoolAbi, functionName: "setAllowlistEnabled", args: [false] }));
  for (const role of ["UNDERWRITER_ROLE", "ATTESTER_ROLE"] as const) {
    const id = await anvil.publicClient.readContract({ address: claimRegistry, abi: claimRegistryAbi, functionName: role });
    await send(admin.writeContract({ address: claimRegistry, abi: claimRegistryAbi, functionName: "grantRole", args: [id, me] }));
  }

  const config: NetworkConfig = {
    ...base,
    rpcUrl: anvil.rpcUrl,
    deployed: { block: Number(block), frxUSD, orgRegistry, claimRegistry, pool, claimNft },
  };
  return { frxUSD, orgRegistry, claimNft, pool, claimRegistry, block, config };
}
