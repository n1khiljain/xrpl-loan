import type { NetworkConfig } from "@app/config";
import { createdNodeId, valueToUnits } from "@app/adapters";
import { Client, type SubmittableTransaction, type TxResponse, type Wallet as XrplWallet, signLoanSetByCounterparty } from "xrpl";
import type { Db, Wallet } from "./db/types.ts";

/** What a custodial account holds on the ledger. */
export type Balances = {
  /** False until the account is funded with its XRP reserve. */
  exists: boolean;
  /** XRP in drops. */
  xrpDrops: string;
  /** The loan asset in base units, or null without a trust line to its issuer. */
  asset: string | null;
};

export type Submitted = { hash: string; result: string; ledgerIndex: number | null; createdId: string | null };

/** Why a transaction was recorded, for ledger_txs and explorer links. */
export type TxPurpose = { purpose: string; receivableId?: string | null };

/**
 * The XRPL operations the functions perform. `XrplLedger` talks to the network named in the config; tests use
 * `FakeLedger`. Every submitted transaction is recorded in ledger_txs whether it succeeded or not.
 */
export interface Ledger {
  /** Asks the network's faucet to fund a new account. Test networks only. */
  fund(address: Wallet): Promise<{ txHash: string | null }>;
  balances(address: Wallet): Promise<Balances>;
  /** Autofills, signs with `signer`, submits, and waits for validation. */
  submit(signer: XrplWallet, tx: SubmittableTransaction, why: TxPurpose): Promise<Submitted>;
  /**
   * A LoanSet needs the borrower and the broker. The borrower signs first; autofill has already priced the
   * broker's signature. The broker's signature is added and the one transaction is submitted.
   */
  submitCoSigned(signer: XrplWallet, counterparty: XrplWallet, tx: SubmittableTransaction, why: TxPurpose): Promise<Submitted>;
  /** A ledger object by its index, or null when the network has no such entry. */
  readEntry(index: string): Promise<Record<string, unknown> | null>;
  /** Every object of one type the account owns, e.g. the broker's vaults and loan brokers. */
  ownedObjects(address: string, type: "vault" | "loan_broker"): Promise<Record<string, unknown>[]>;
  /** How many of a vault's shares (an MPT) `holder` has, and how many exist in all; null where there are none. */
  shareHolding(shareMptId: string, holder: string): Promise<{ held: string | null; outstanding: string | null }>;
}

export class LedgerError extends Error {
  constructor(
    readonly result: string,
    message: string,
    readonly hash: string | null = null,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

/** Opens a connection per call: edge functions are short-lived and a socket can't outlive the request. */
export async function withClient<T>(config: Pick<NetworkConfig, "wsUrl">, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client(config.wsUrl, { connectionTimeout: 10_000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

export function xrplLedger(config: NetworkConfig, db: Db): Ledger {
  return {
    async fund(address) {
      if (!config.faucetUrl) throw new LedgerError("no_faucet", `${config.network} has no faucet`);
      const res = await fetch(config.faucetUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destination: address, userAgent: "xrpl-receivables" }),
      });
      if (!res.ok) throw new LedgerError("faucet_failed", `the faucet answered ${res.status}`);
      const body = (await res.json()) as { transactionHash?: string };
      const txHash = body.transactionHash ?? null;
      if (txHash) await db.recordLedgerTx({ txHash, txType: "Payment", account: address, receivableId: null, purpose: "fund_wallet", result: "faucet" });
      return { txHash };
    },

    balances(address) {
      return withClient(config, async (client) => {
        let xrpDrops = "0";
        try {
          const info = await client.request({ command: "account_info", account: address, ledger_index: "validated" });
          xrpDrops = info.result.account_data.Balance;
        } catch (error) {
          if ((error as { data?: { error?: string } }).data?.error === "actNotFound") return { exists: false, xrpDrops, asset: null };
          throw error;
        }
        let asset: string | null = null;
        if (config.asset.issuer) {
          const lines = await client.request({ command: "account_lines", account: address, peer: config.asset.issuer, ledger_index: "validated" });
          const line = lines.result.lines.find((l) => l.currency === config.asset.currency);
          if (line) asset = valueToUnits(line.balance).toString();
        }
        return { exists: true, xrpDrops, asset };
      });
    },

    submit(signer, tx, why) {
      return withClient(config, async (client) => {
        const prepared = await client.autofill(tx);
        const signed = signer.sign(prepared);
        let response: TxResponse;
        try {
          response = await client.submitAndWait(signed.tx_blob);
        } catch (error) {
          throw new LedgerError("submit_failed", error instanceof Error ? error.message : String(error), signed.hash);
        }
        const meta = response.result.meta;
        const result = typeof meta === "object" && meta !== null && "TransactionResult" in meta ? String(meta.TransactionResult) : "unknown";
        await db.recordLedgerTx({
          txHash: signed.hash,
          txType: tx.TransactionType,
          account: tx.Account as Wallet,
          receivableId: why.receivableId ?? null,
          purpose: why.purpose,
          result,
        });
        if (result !== "tesSUCCESS") throw new LedgerError(result, `${tx.TransactionType} failed with ${result}`, signed.hash);
        return { hash: signed.hash, result, ledgerIndex: response.result.ledger_index ?? null, createdId: null };
      });
    },

    submitCoSigned(signer, counterparty, tx, why) {
      return withClient(config, async (client) => {
        const prepared = await client.autofill(tx);
        const first = signer.sign(prepared);
        const combined = signLoanSetByCounterparty(counterparty, first.tx_blob);
        let response: TxResponse;
        try {
          response = await client.submitAndWait(combined.tx_blob);
        } catch (error) {
          throw new LedgerError("submit_failed", error instanceof Error ? error.message : String(error), combined.hash);
        }
        const meta = response.result.meta;
        const result = typeof meta === "object" && meta !== null && "TransactionResult" in meta ? String(meta.TransactionResult) : "unknown";
        await db.recordLedgerTx({
          txHash: combined.hash,
          txType: tx.TransactionType,
          account: tx.Account as Wallet,
          receivableId: why.receivableId ?? null,
          purpose: why.purpose,
          result,
        });
        if (result !== "tesSUCCESS") throw new LedgerError(result, `${tx.TransactionType} failed with ${result}`, combined.hash);
        return { hash: combined.hash, result, ledgerIndex: response.result.ledger_index ?? null, createdId: createdNodeId(meta, "Loan") };
      });
    },

    readEntry(index) {
      return withClient(config, async (client) => {
        try {
          const info = await client.request({ command: "ledger_entry", index, ledger_index: "validated" });
          const node = info.result.node;
          return node && typeof node === "object" ? (node as unknown as Record<string, unknown>) : null;
        } catch (error) {
          const code = (error as { data?: { error?: string } }).data?.error;
          if (code === "entryNotFound" || code === "actNotFound") return null;
          throw error;
        }
      });
    },

    ownedObjects(address, type) {
      return withClient(config, async (client) => {
        const out: Record<string, unknown>[] = [];
        let marker: unknown = undefined;
        // a broker that has opened many series pages its objects, so follow the marker to the end
        for (let page = 0; page < 20; page++) {
          const res = await client.request({ command: "account_objects", account: address, type, ledger_index: "validated", limit: 200, ...(marker ? { marker } : {}) });
          out.push(...(res.result.account_objects as unknown as Record<string, unknown>[]));
          marker = res.result.marker;
          if (!marker) break;
        }
        return out;
      });
    },

    shareHolding(shareMptId, holder) {
      return withClient(config, async (client) => {
        const read = async (request: Parameters<Client["request"]>[0]) => {
          try {
            return ((await client.request(request)) as { result: { node?: Record<string, unknown> } }).result.node ?? null;
          } catch (error) {
            const code = (error as { data?: { error?: string } }).data?.error;
            if (code === "entryNotFound" || code === "actNotFound") return null;
            throw error;
          }
        };
        const token = await read({ command: "ledger_entry", mptoken: { mpt_issuance_id: shareMptId, account: holder }, ledger_index: "validated" });
        const issuance = await read({ command: "ledger_entry", mpt_issuance: shareMptId, ledger_index: "validated" });
        const held = token?.MPTAmount;
        const outstanding = issuance?.OutstandingAmount;
        return { held: typeof held === "string" ? held : null, outstanding: typeof outstanding === "string" ? outstanding : null };
      });
    },
  };
}

/** A ledger that only remembers what it was asked, for tests. */
export class FakeLedger implements Ledger {
  readonly funded: Wallet[] = [];
  readonly submitted: Array<{ tx: SubmittableTransaction; why: TxPurpose }> = [];
  readonly balanceOf = new Map<Wallet, Balances>();
  readonly entries = new Map<string, Record<string, unknown>>();
  /** Ledger index the next co-signed submit reports as created. */
  nextCreatedId: string | null = "D".repeat(64);
  failFund = false;

  async fund(address: Wallet) {
    if (this.failFund) throw new LedgerError("faucet_failed", "the faucet answered 503");
    this.funded.push(address);
    this.balanceOf.set(address, { exists: true, xrpDrops: "100000000", asset: null });
    return { txHash: "F".repeat(64) };
  }
  async balances(address: Wallet) {
    return this.balanceOf.get(address) ?? { exists: false, xrpDrops: "0", asset: null };
  }
  async submit(_signer: XrplWallet, tx: SubmittableTransaction, why: TxPurpose) {
    this.submitted.push({ tx, why });
    return { hash: this.submitted.length.toString(16).toUpperCase().padStart(64, "0"), result: "tesSUCCESS", ledgerIndex: 1, createdId: null };
  }
  async submitCoSigned(_signer: XrplWallet, _counterparty: XrplWallet, tx: SubmittableTransaction, why: TxPurpose) {
    this.submitted.push({ tx, why });
    return {
      hash: this.submitted.length.toString(16).toUpperCase().padStart(64, "0"),
      result: "tesSUCCESS",
      ledgerIndex: 1,
      createdId: this.nextCreatedId,
    };
  }
  async readEntry(index: string) {
    return this.entries.get(index) ?? null;
  }
  /** Objects by owner and type, for `ownedObjects`. */
  readonly owned = new Map<string, Record<string, unknown>[]>();
  /** `${shareMptId}:${holder}` to shares held, and shareMptId to shares outstanding. */
  readonly shares = new Map<string, string>();
  async ownedObjects(address: string, type: "vault" | "loan_broker") {
    return this.owned.get(`${address}:${type}`) ?? [];
  }
  async shareHolding(shareMptId: string, holder: string) {
    return { held: this.shares.get(`${shareMptId}:${holder}`) ?? null, outstanding: this.shares.get(shareMptId) ?? null };
  }
}
