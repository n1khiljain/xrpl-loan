import { claimRegistryAbi, mockFrxUsdAbi } from "@app/abi";
import { type NetworkConfig, requireDeployed } from "@app/config";
import { chainFromConfig, publicClientFor } from "@app/adapters";
import {
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type TypedDataDefinition,
  createWalletClient,
  erc20Abi,
  http,
  verifyTypedData as verifyEoaTypedData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { GuarantyTypedData } from "./guaranty.ts";

/** Registry and token reads the functions need beyond `ChainReader`. */
export interface RegistryReads {
  guarantyNonce(guarantor: Address): Promise<bigint>;
  tokenBalance(wallet: Address): Promise<bigint>;
}

export function registryReads(config: NetworkConfig, client: PublicClient = publicClientFor(config)): RegistryReads {
  const deployed = requireDeployed(config);
  return {
    guarantyNonce: (guarantor) =>
      client.readContract({ address: deployed.claimRegistry, abi: claimRegistryAbi, functionName: "nonces", args: [guarantor] }),
    tokenBalance: (wallet) =>
      client.readContract({ address: deployed.frxUSD, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
  };
}

export type SignatureCheck = (p: { address: Address; typedData: GuarantyTypedData; signature: Hex }) => Promise<boolean>;

/**
 * Checks a guaranty signature. On a live chain this goes through the public client, which also handles ERC-1271
 * smart wallets the way `SignatureChecker` does onchain (FR-C7).
 */
export function chainSignatureCheck(client: PublicClient): SignatureCheck {
  return ({ address, typedData, signature }) =>
    client.verifyTypedData({ address, signature, ...(typedData as unknown as TypedDataDefinition) });
}

/** EOA-only check with no RPC, for tests. */
export const eoaSignatureCheck: SignatureCheck = ({ address, typedData, signature }) =>
  verifyEoaTypedData({ address, signature, ...(typedData as unknown as TypedDataDefinition) }).catch(() => false);

/**
 * Where "Simulate ASUC payout" gets its frxUSD (FR-B10): minted MockFrxUSD, or, on a network that uses Frax's real
 * test frxUSD, a transfer from a payout wallet Frax funds, since nobody else can mint that token (U-25, U-67).
 */
export interface Payout {
  readonly kind: "mint" | "transfer";
  /** What the payout wallet can still send, or null when it mints. */
  available(): Promise<bigint | null>;
  pay(to: Address, amount: bigint): Promise<Hash>;
}

/** Sends from `PAYOUT_PRIVATE_KEY`, a testnet-only key. UNCERTAIN: U-54, U-67 */
export function payoutFor(config: NetworkConfig, privateKey: Hex): Payout {
  const deployed = requireDeployed(config);
  const chain = chainFromConfig(config);
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl) });
  const client = publicClientFor(config);
  const mints = config.frxUSD === null;
  return {
    kind: mints ? "mint" : "transfer",
    available: async () =>
      mints ? null : await client.readContract({ address: deployed.frxUSD, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
    async pay(to, amount) {
      const hash = mints
        ? await wallet.writeContract({ address: deployed.frxUSD, abi: mockFrxUsdAbi, functionName: "mint", args: [to, amount] })
        : await wallet.writeContract({ address: deployed.frxUSD, abi: erc20Abi, functionName: "transfer", args: [to, amount] });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`payout ${hash} reverted`);
      return hash;
    },
  };
}
