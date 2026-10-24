import type { NetworkConfig } from "@app/config";
import type { Fetch } from "../shared/chain.ts";
import { AdapterConfigError } from "../shared/errors.ts";
import { type MockFraxNetOptions, type VerificationStore, createMockFraxNetClient } from "./mock.ts";
import { createRealFraxNetClient } from "./real.ts";
import type { FraxNetClient } from "./types.ts";

export * from "./types.ts";
export * from "./real.ts";
export * from "./mock.ts";
export * from "./pkce.ts";

export type FraxNetDeps = {
  /** `FRAXNET_CLIENT_ID` and `FRAXNET_CLIENT_SECRET`, used by the real client (U-77). */
  clientId?: string;
  clientSecret?: string;
  fetch?: Fetch;
  /** Backing store for the mock client's liquidation addresses. */
  store?: VerificationStore;
  /** What the mock's organizations say. */
  mockOrg?: MockFraxNetOptions["org"];
};

/** Picks the implementation named by `config.adapters.fraxnet` (FR-A1). */
export function createFraxNetClient(config: NetworkConfig, deps: FraxNetDeps = {}): FraxNetClient {
  const { appUrl, apiBase, oauthIssuer } = config.fraxnet;
  switch (config.adapters.fraxnet) {
    case "mock":
      return createMockFraxNetClient({ appUrl, ...(deps.store ? { store: deps.store } : {}), ...(deps.mockOrg ? { org: deps.mockOrg } : {}) });
    case "real": {
      if (apiBase === null || oauthIssuer === null) {
        throw new AdapterConfigError("FraxNetClient", "'real' needs fraxnet.apiBase and fraxnet.oauthIssuer (U-77)");
      }
      return createRealFraxNetClient({
        appUrl,
        apiBase,
        issuer: oauthIssuer,
        ...(deps.clientId ? { clientId: deps.clientId } : {}),
        ...(deps.clientSecret ? { clientSecret: deps.clientSecret } : {}),
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      });
    }
  }
}
