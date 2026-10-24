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
