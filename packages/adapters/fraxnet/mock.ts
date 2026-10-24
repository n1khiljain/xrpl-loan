import type { Address } from "viem";
import { FRAXNET_SCOPES, FraxNetAuthError, type FraxNetClient, type FraxNetIdentity, type FraxNetWallet } from "./types.ts";

/** Where the mock reads liquidation addresses. Edge functions pass one backed by the profile table (U-37). */
export interface VerificationStore {
  getLiquidationAddress(wallet: Address): Promise<Address | null>;
}

export interface MockFraxNetClient extends FraxNetClient {
  readonly kind: "mock";
  setLiquidationAddress(wallet: Address, address: Address | null): void;
  /** Wallets added through `addWallet`, by mock user id (this instance only). */
  readonly wallets: Map<string, FraxNetWallet[]>;
}

export type MockFraxNetOptions = {
  appUrl: string;
  store?: VerificationStore;
  /** What every mock organization says; tests flip `verified` or `isBusiness`. Defaults to a verified person. */
  org?: Partial<FraxNetIdentity["org"]>;
  now?: () => Date;
};

const CODE = "mock-code.";
const ACCESS = "mock-access.";
const REFRESH = "mock-refresh.";

/**
 * Local and test FraxNetClient with no network calls. "Signing in to FraxNet" sends the browser straight back to
 * the redirect URI with a code, so the whole connect flow runs on a laptop. Each connect is a new FraxNet user,
 * whose id travels inside the mock code and tokens (functions run in separate isolates, so there's no shared map).
 */
export function createMockFraxNetClient(options: MockFraxNetOptions): MockFraxNetClient {
  const liquidation = new Map<string, Address | null>();
  const wallets = new Map<string, FraxNetWallet[]>();
  const now = options.now ?? (() => new Date());
  const tokens = (id: string) => ({
    accessToken: `${ACCESS}${id}`,
    refreshToken: `${REFRESH}${id}`,
    expiresAt: new Date(now().getTime() + 3_600_000).toISOString(),
    scopes: [...FRAXNET_SCOPES],
  });
  const idFrom = (value: string, prefix: string, code: string) => {
    if (!value.startsWith(prefix) || value.length === prefix.length) throw new FraxNetAuthError(code, "not a mock FraxNet value");
    return value.slice(prefix.length);
  };

  return {
    kind: "mock",
    verifyUrl: () => options.appUrl,
    authorizeUrl(request) {
      const url = new URL(request.redirectUri);
      url.searchParams.set("code", `${CODE}${crypto.randomUUID()}`);
      url.searchParams.set("state", request.state);
      return url.toString();
    },
    exchangeCode: async ({ code }) => tokens(idFrom(code, CODE, "invalid_grant")),
    refresh: async (refreshToken) => tokens(idFrom(refreshToken, REFRESH, "invalid_grant")),
    async getIdentity(accessToken) {
      const id = idFrom(accessToken, ACCESS, "invalid_token");
      return {
        userId: `mock-user-${id}`,
        email: null,
        firstName: null,
        lastName: null,
        org: { id: `mock-org-${id}`, name: "Personal account", verified: true, verifiedAt: now().toISOString(), isBusiness: false, ...options.org },
      };
    },
    async addWallet(accessToken, wallet) {
      const id = idFrom(accessToken, ACCESS, "invalid_token");
      const list = (wallets.get(id) ?? []).filter((w) => w.address.toLowerCase() !== wallet.address.toLowerCase() || w.chainId !== wallet.chainId);
      wallets.set(id, [...list, wallet]);
    },
    wallets,
    async getLiquidationAddress(wallet) {
      const key = wallet.toLowerCase();
      if (liquidation.has(key)) return liquidation.get(key) ?? null;
      return (await options.store?.getLiquidationAddress(wallet)) ?? null;
    },
    setLiquidationAddress(wallet, address) {
      liquidation.set(wallet.toLowerCase(), address);
    },
  };
}
