import SafeAppsSDK from "@safe-global/safe-apps-sdk";
import type { Address, Hex } from "viem";
import { config } from "./config";

export type SafeTx = { to: Address; data: Hex; value: bigint; label: string };
export type SafeContext = { safeAddress: Address; chainId: number };

/**
 * The Safe UIs the admin pages may run inside (U-27, U-89): Frax's for this network and Safe{Wallet}. Keep in step
 * with `frame-ancestors` in public/_headers. On local anvil, the stand-in Safe on loopback that the e2e tests use.
 */
// UNCERTAIN: U-89
export const SAFE_ORIGINS: string[] = [
  ...new Set([...(config.safeUi ? [new URL(config.safeUi).origin] : []), "https://app.safe.global"]),
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Origins the Safe Apps SDK accepts messages from: anything else could pose as the Safe (security campaign E-5b). */
export function safeAllowedDomains(): RegExp[] {
  const exact = SAFE_ORIGINS.map((origin) => new RegExp(`^${escapeRegExp(origin)}$`));
  return config.network === "local" ? [...exact, /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/] : exact;
}

let sdk: SafeAppsSDK | null = null;
function getSdk(): SafeAppsSDK {
  sdk ??= new SafeAppsSDK({ allowedDomains: safeAllowedDomains(), debug: false });
  return sdk;
}

/** Resolves the Safe this page is running inside, or null outside a Safe (U-27). */
export async function detectSafe(timeoutMs = 400): Promise<SafeContext | null> {
  if (typeof window === "undefined" || window.parent === window) return null;
  const info = await Promise.race([
    getSdk().safe.getInfo().catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  return info ? { safeAddress: info.safeAddress as Address, chainId: info.chainId } : null;
}

/** Proposes the transactions to the Safe's other signers. Returns the Safe transaction hash. */
export async function proposeInSafe(txs: SafeTx[]): Promise<string> {
  const { safeTxHash } = await getSdk().txs.send({
    txs: txs.map((tx) => ({ to: tx.to, data: tx.data, value: tx.value.toString() })),
  });
  return safeTxHash;
}

/** A Transaction Builder batch file for signers who aren't using the Safe App (FR-F7). */
export function transactionBuilderJson(txs: SafeTx[], meta: { name: string; description: string; safeAddress?: string }) {
  return {
    version: "1.0",
    chainId: String(config.chainId),
    createdAt: Date.now(),
    meta: {
      name: meta.name,
      description: meta.description,
      txBuilderVersion: "1.16.5",
      createdFromSafeAddress: meta.safeAddress ?? "",
      createdFromOwnerAddress: "",
    },
    transactions: txs.map((tx) => ({
      to: tx.to,
      value: tx.value.toString(),
      data: tx.data,
      contractMethod: null,
      contractInputsValues: null,
    })),
  };
}

/** Chain prefixes Safe URLs use. UNCERTAIN: U-61 */
const SAFE_PREFIX: Record<string, string> = { fraxtal: "fraxtal", "fraxtal-testnet": "fraxtal-testnet", sepolia: "sep" };

/** Opens this admin page as a Safe App in Frax's Safe UI, or null where there's no Safe UI (local). */
export function openInSafeUrl(safeAddress: string | null, path: string): string | null {
  if (!config.safeUi) return null;
  const app = typeof window === "undefined" ? path : new URL(path, window.location.origin).toString();
  const safe = safeAddress && SAFE_PREFIX[config.network] ? `safe=${SAFE_PREFIX[config.network]}:${safeAddress}&` : "";
  return `${config.safeUi.replace(/\/+$/, "")}/apps/open?${safe}appUrl=${encodeURIComponent(app)}`;
}

export function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
