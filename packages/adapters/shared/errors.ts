/**
 * Thrown when an operation depends on a Frax interface that has not been documented or shared yet. `uncertainty`
 * names the `docs/UNCERTAINTIES.md` entry that tracks it, so callers can fall back (manual KYC, pasted liquidation
 * address) and log why.
 */
export class NotAvailableError extends Error {
  constructor(
    readonly adapter: string,
    readonly operation: string,
    readonly uncertainty: `U-${number}`,
    detail?: string,
  ) {
    super(`${adapter}.${operation} is not available yet (${uncertainty})${detail ? `: ${detail}` : ""}`);
    this.name = "NotAvailableError";
  }
}

/** Thrown by a factory when the network config picks an implementation whose settings or secrets are missing. */
export class AdapterConfigError extends Error {
  constructor(
    readonly adapter: string,
    message: string,
  ) {
    super(`${adapter}: ${message}`);
    this.name = "AdapterConfigError";
  }
}

/** Thrown when an upstream API answers with an error status or a body we can't parse. */
export class UpstreamError extends Error {
  constructor(
    readonly adapter: string,
    readonly status: number | null,
    message: string,
  ) {
    super(`${adapter}: ${message}`);
    this.name = "UpstreamError";
  }
}
