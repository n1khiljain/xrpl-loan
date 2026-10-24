import { getAddress } from "viem";

/**
 * The message a wallet signs to prove it belongs to a Privy user (U-50). The web app signs it and the `me`
 * function verifies it, so both import it from here.
 */
export function bindingMessage(p: { privyUserId: string; wallet: string; issuedAt: string }): string {
  return [
    "Link this wallet to your account for B@B x Frax college org financing.",
    "",
    `Wallet: ${getAddress(p.wallet)}`,
    `Account: ${p.privyUserId}`,
    `Issued at: ${p.issuedAt}`,
  ].join("\n");
}
