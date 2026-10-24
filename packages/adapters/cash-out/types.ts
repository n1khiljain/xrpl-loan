import { type Address, type Hex, getAddress, isAddress, zeroAddress } from "viem";

export type Call = { to: Address; data: Hex; value: bigint };

export type TransferRequest = {
  /** The claimant's wallet, which sends the calls. */
  from: Address;
  /** frxUSD in wei. */
  amount: bigint;
  /** The user's FraxNet liquidation address on Ethereum (U-17, U-37). Ignored by the simulated cash-out. */
  liquidationAddress: Address;
};

/**
 * Builds the calls that move frxUSD from the claimant toward their bank (PRD 8.6). The app sends them from the
 * user's wallet in order. SYSTEM_DESIGN section 4.
 */
export interface CashOut {
  readonly kind: "mesh" | "simulated";
  /** True on testnets, where the bank step is a labeled simulation (U-17). */
  readonly simulated: boolean;
  buildTransfer(request: TransferRequest): Promise<Call[]>;
}

/**
 * Checks a pasted liquidation address before any frxUSD moves (security campaign E-5c): a 20-byte address whose
 * checksum is right if it's mixed case, and not the zero address. Returns it checksummed. Whether it has code can't
 * be checked here: it lives on Ethereum, and the app only has a Fraxtal client.
 */
export function checkLiquidationAddress(value: string): Address {
  const trimmed = value.trim();
  if (!isAddress(trimmed, { strict: true })) {
    throw new RangeError("That isn't a valid address. Copy it again from FraxNet; a typo changes the checksum.");
  }
  const address = getAddress(trimmed);
  if (address === zeroAddress) throw new RangeError("The zero address can't receive a cash-out.");
  return address;
}
