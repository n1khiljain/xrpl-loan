import {
  type Chain,
  type EIP1193Provider,
  type Hex,
  type TypedDataDefinition,
  createPublicClient,
  createWalletClient,
  hexToBigInt,
  http,
  numberToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

type TxRequest = { to?: Hex; data?: Hex; value?: Hex; gas?: Hex };
type TypeField = { name: string; type: string };

/** eth_signTypedData_v4 sends numbers as strings; turn int and uint fields back into bigints before signing. */
function reviveNumbers(types: Record<string, TypeField[]>, type: string, value: unknown): unknown {
  const fields = types[type];
  if (!fields || typeof value !== "object" || value === null) {
    return /^u?int\d*$/.test(type) && (typeof value === "string" || typeof value === "number") ? BigInt(value) : value;
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(fields.map((f) => [f.name, reviveNumbers(types, f.type, record[f.name])]));
}

/**
 * An EIP-1193 provider backed by one private key, for the local dev session. Signing happens in the page and
 * everything else goes to the RPC. Local anvil only.
 */
export function devWalletProvider(privateKey: Hex, chain: Chain, rpcUrl: string): EIP1193Provider {
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  const request = async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
    const args = (params ?? []) as unknown[];
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [account.address];
      case "eth_chainId":
        return numberToHex(chain.id);
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain":
        return null;
      case "personal_sign":
        return account.signMessage({ message: { raw: args[0] as Hex } });
      case "eth_signTypedData_v4": {
        const typed = JSON.parse(args[1] as string) as { domain: Record<string, unknown>; types: Record<string, TypeField[]>; primaryType: string; message: unknown };
        const { EIP712Domain: _domain, ...types } = typed.types;
        const message = reviveNumbers(types, typed.primaryType, typed.message);
        return account.signTypedData({ ...typed, types, message } as unknown as TypedDataDefinition);
      }
      case "eth_sendTransaction": {
        const tx = args[0] as TxRequest;
        return walletClient.sendTransaction({
          to: tx.to,
          data: tx.data,
          value: tx.value ? hexToBigInt(tx.value) : undefined,
          gas: tx.gas ? hexToBigInt(tx.gas) : undefined,
        });
      }
      default:
        return publicClient.request({ method, params } as Parameters<typeof publicClient.request>[0]);
    }
  };

  return { request, on: () => {}, removeListener: () => {} } as unknown as EIP1193Provider;
}
