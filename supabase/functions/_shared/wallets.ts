import { Wallet as XrplWallet } from "xrpl";
import type { Db, Wallet } from "./db/types.ts";

/**
 * Custodial XRPL wallets. Each person gets one when they first set up their account; the seed is encrypted with
 * AES-256-GCM under WALLET_ENCRYPTION_KEY (32 random bytes, base64) and bound to its address as associated data,
 * so a stored ciphertext can't be swapped onto another address. Only edge functions hold the key.
 */
export interface Custody {
  /** A new wallet: its address and the encrypted seed to store. */
  create(): Promise<{ address: Wallet; encryptedSeed: string }>;
  /** The signing wallet for an address the app holds. */
  signer(address: Wallet): Promise<XrplWallet>;
}

const VERSION = "v1";
const encoder = new TextEncoder();

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export async function importWalletKey(base64: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = unb64(base64.trim());
  } catch {
    throw new Error("WALLET_ENCRYPTION_KEY must be base64");
  }
  if (raw.byteLength !== 32) throw new Error("WALLET_ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)");
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSeed(key: CryptoKey, address: string, seed: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(address) }, key, encoder.encode(seed));
  return `${VERSION}.${b64(iv)}.${b64(new Uint8Array(sealed))}`;
}

export async function decryptSeed(key: CryptoKey, address: string, sealed: string): Promise<string> {
  const [version, iv, body] = sealed.split(".");
  if (version !== VERSION || !iv || !body) throw new Error("unrecognized encrypted seed");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv) as BufferSource, additionalData: encoder.encode(address) },
    key,
    unb64(body) as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

export function createCustody(deps: { db: Db; key: Promise<CryptoKey> }): Custody {
  return {
    async create() {
      const wallet = XrplWallet.generate();
      const address = wallet.classicAddress as Wallet;
      return { address, encryptedSeed: await encryptSeed(await deps.key, address, wallet.seed as string) };
    },
    async signer(address) {
      const row = await deps.db.getWallet(address);
      if (!row) throw new Error(`the app holds no wallet for ${address}`);
      const wallet = XrplWallet.fromSeed(await decryptSeed(await deps.key, address, row.encryptedSeed));
      if (wallet.classicAddress !== address) throw new Error("decrypted seed doesn't match its address");
      return wallet;
    },
  };
}
