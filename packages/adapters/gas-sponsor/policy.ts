import type { Address, Hash } from "viem";
import type { GasSponsor } from "./types.ts";

/** One top-up per wallet per day (FR-B7). */
export const DRIP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Where top-ups are recorded. `reserve` must be atomic, so two requests for the same wallet at the same moment
 * can't both pass the daily limit. The Supabase ledger does this in one SQL function under an advisory lock.
 */
export interface DripLedger {
  /** Whether the wallet has a profile. Only wallets with a profile get gas (FR-B7). */
  hasProfile(wallet: Address): Promise<boolean>;
  /**
   * Holds this wallet's top-up for the next 24 hours. Returns a reservation ID, or null when the wallet already
   * has a sent or held top-up newer than `windowMs`.
   */
  reserve(wallet: Address, windowMs: number): Promise<string | null>;
  /** Marks a reservation as sent. `txHash` is null when the mock sponsor reported funded without sending. */
  confirm(reservationId: string, sent: { txHash: Hash | null; amountWei: bigint }): Promise<void>;
  /** Drops a reservation that sent nothing, so it doesn't count toward the limit. */
  release(reservationId: string): Promise<void>;
}

export type DripPolicyOptions = {
  ledger: DripLedger;
  /** Recorded in the ledger for each top-up. */
  amountWei: bigint;
};

/**
 * Wraps any `GasSponsor` with the FR-B7 rules: no profile, no gas; at most one top-up per wallet in any 24 hours.
 * A check that finds the balance above the threshold, or a send that fails, does not count toward the limit.
 */
export function withDripPolicy(sponsor: GasSponsor, options: DripPolicyOptions): GasSponsor {
  const { ledger } = options;
  return {
    kind: sponsor.kind,
    async ensureGas(wallet) {
      if (!(await ledger.hasProfile(wallet))) return { funded: false, reason: "no_profile" };
      const reservation = await ledger.reserve(wallet, DRIP_WINDOW_MS);
      if (reservation === null) return { funded: false, reason: "rate_limited" };
      try {
        const result = await sponsor.ensureGas(wallet);
        if (result.funded) {
          await ledger.confirm(reservation, {
            txHash: result.txHash ?? null,
            amountWei: result.txHash ? options.amountWei : 0n,
          });
        } else {
          await ledger.release(reservation);
        }
        return result;
      } catch (error) {
        await ledger.release(reservation);
        throw error;
      }
    },
  };
}

/** In-memory `DripLedger` for tests and local scripts. */
export function createMemoryDripLedger(options: { profiles: Iterable<Address>; now?: () => Date }) {
  const now = options.now ?? (() => new Date());
  const profiles = new Set([...options.profiles].map((w) => w.toLowerCase()));
  const rows = new Map<string, { wallet: string; at: number; txHash: Hash | null; amountWei: bigint }>();
  let next = 1;
  const ledger: DripLedger & { rows: typeof rows } = {
    rows,
    async hasProfile(wallet) {
      return profiles.has(wallet.toLowerCase());
    },
    async reserve(wallet, windowMs) {
      const w = wallet.toLowerCase();
      const cutoff = now().getTime() - windowMs;
      for (const row of rows.values()) if (row.wallet === w && row.at > cutoff) return null;
      const id = String(next++);
      rows.set(id, { wallet: w, at: now().getTime(), txHash: null, amountWei: 0n });
      return id;
    },
    async confirm(id, sent) {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, txHash: sent.txHash, amountWei: sent.amountWei });
    },
    async release(id) {
      rows.delete(id);
    },
  };
  return ledger;
}
