import { loadNetworkConfig } from "@app/config";
import { describe, expect, it, vi } from "vitest";
import {
  AdapterConfigError,
  FRAXNET_REQUIRED_SCOPES,
  FRAXNET_SCOPES,
  FraxNetAuthError,
  type FraxNetIdentity,
  NotAvailableError,
  UpstreamError,
  createFraxNetClient,
  createMockFraxNetClient,
  createRealFraxNetClient,
  pkceChallenge,
  pkcePair,
  verificationFromIdentity,
} from "../index.ts";

const WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const LIQUIDATION = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const NOW = new Date("2026-10-08T12:00:00Z");
const ISSUER = "https://net-test-oauth.frax.com";
const API = "https://net-test.frax.com/api/v1";

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

function real(fetch: FetchFn, creds = true) {
  return createRealFraxNetClient({
    appUrl: "https://net-test.frax.com",
    apiBase: `${API}/`,
    issuer: `${ISSUER}/`,
    ...(creds ? { clientId: "client:id", clientSecret: "s3cret/+=" } : {}),
    fetch,
    now: () => NOW,
  });
}

const ME = { id: "usr_1", email: "jordan@example.test", emailVerified: true, firstName: "Jordan", lastName: "Park", organization: { id: "org_1", name: "Jordan Park" }, app: { id: "app", name: "FraxNet College" }, scopes: [] };
const ORG = { id: "org_1", name: "Jordan Park", verified: true, verifiedAt: "2026-09-18T10:00:00.000Z", isBusiness: false, createdAt: "2026-09-01T00:00:00.000Z" };

function identity(org: Partial<FraxNetIdentity["org"]>): FraxNetIdentity {
  return { userId: "u", email: null, firstName: null, lastName: null, org: { id: "o", name: "n", verified: true, verifiedAt: null, isBusiness: false, ...org } };
}

describe("FraxNetClient factory", () => {
  it("local and sepolia use the mock; fraxtal-testnet talks to FraxNet's staging OAuth (U-77)", () => {
    for (const network of ["local", "sepolia"] as const) expect(createFraxNetClient(loadNetworkConfig(network)).kind).toBe("mock");
    const testnet = createFraxNetClient(loadNetworkConfig("fraxtal-testnet"));
    expect(testnet.kind).toBe("real");
    expect(testnet.verifyUrl()).toBe("https://net-test.frax.com");
  });

  it("'real' needs the API base and the OAuth issuer", () => {
    const base = loadNetworkConfig("fraxtal-testnet");
    expect(() => createFraxNetClient({ ...base, fraxnet: { ...base.fraxnet, oauthIssuer: null } })).toThrow(AdapterConfigError);
    expect(() => createFraxNetClient({ ...base, fraxnet: { ...base.fraxnet, apiBase: null } })).toThrow(AdapterConfigError);
  });
});

describe("PKCE", () => {
  it("matches the RFC 7636 appendix B example", async () => {
    await expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("makes a fresh 43-character verifier each time", async () => {
    const [a, b] = await Promise.all([pkcePair(), pkcePair()]);
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.verifier).not.toBe(b.verifier);
    await expect(pkceChallenge(a.verifier)).resolves.toBe(a.challenge);
  });
});

describe("real FraxNetClient (U-77)", () => {
  it("builds the authorization URL with PKCE, the locked scopes, and the client id", () => {
    const url = new URL(real(vi.fn()).authorizeUrl({ redirectUri: "https://app.example/fraxnet/callback/", state: "state-123", nonce: "n", codeChallenge: "c" }));
    expect(`${url.origin}${url.pathname}`).toBe(`${ISSUER}/oauth2/auth`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client:id",
      redirect_uri: "https://app.example/fraxnet/callback/",
      response_type: "code",
      scope: FRAXNET_SCOPES.join(" "),
      required_scope: FRAXNET_REQUIRED_SCOPES.join(" "),
      state: "state-123",
      nonce: "n",
      code_challenge: "c",
      code_challenge_method: "S256",
    });
  });

  it("won't start or exchange without the client id and secret", async () => {
    const fetch = vi.fn<FetchFn>();
    const client = real(fetch, false);
    expect(() => client.authorizeUrl({ redirectUri: "https://a.example/", state: "state-123", nonce: "n", codeChallenge: "c" })).toThrow(AdapterConfigError);
    await expect(client.exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "https://a.example/" })).rejects.toBeInstanceOf(AdapterConfigError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("exchanges a code with HTTP Basic (URL-encoded) and the PKCE verifier, and reads the granted scopes", async () => {
    const fetch = vi.fn<FetchFn>(async () =>
      Response.json({ access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "bearer", scope: "openid org:read offline_access" }),
    );
    const tokens = await real(fetch).exchangeCode({ code: "the-code", codeVerifier: "the-verifier", redirectUri: "https://app.example/fraxnet/callback/" });
    expect(tokens).toEqual({ accessToken: "at", refreshToken: "rt", expiresAt: "2026-10-08T13:00:00.000Z", scopes: ["openid", "org:read", "offline_access"] });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${ISSUER}/oauth2/token`);
    expect((init?.headers as Record<string, string>).authorization).toBe(`Basic ${btoa("client%3Aid:s3cret%2F%2B%3D")}`);
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: "https://app.example/fraxnet/callback/",
      code_verifier: "the-verifier",
    });
  });

  it("refreshes with the refresh token, and a missing refresh token comes back as null", async () => {
    const fetch = vi.fn<FetchFn>(async () => Response.json({ access_token: "at2", expires_in: 60, scope: "openid org:read" }));
    const tokens = await real(fetch).refresh("rt");
    expect(tokens).toMatchObject({ accessToken: "at2", refreshToken: null, expiresAt: "2026-10-08T12:01:00.000Z" });
    expect(Object.fromEntries(new URLSearchParams(String(fetch.mock.calls[0]?.[1]?.body)))).toEqual({ grant_type: "refresh_token", refresh_token: "rt" });
  });

  it("turns OAuth errors into FraxNetAuthError with FraxNet's code", async () => {
    const client = real(async () => Response.json({ error: "invalid_grant", error_description: "expired" }, { status: 400 }));
    const exchange = client.exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "https://a.example/" });
    await expect(exchange).rejects.toBeInstanceOf(FraxNetAuthError);
    await expect(exchange).rejects.toMatchObject({ code: "invalid_grant" });
    await expect(real(async () => new Response("<html>", { status: 502 })).refresh("rt")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("reads the person and their organization's verified flag from /me and /org with the bearer token", async () => {
    const fetch = vi.fn<FetchFn>(async (input) => Response.json(input.endsWith("/me") ? ME : ORG));
    await expect(real(fetch).getIdentity("at")).resolves.toEqual({
      userId: "usr_1",
      email: "jordan@example.test",
      firstName: "Jordan",
      lastName: "Park",
      org: { id: "org_1", name: "Jordan Park", verified: true, verifiedAt: "2026-09-18T10:00:00.000Z", isBusiness: false },
    });
    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual([`${API}/me`, `${API}/org`]);
    expect((fetch.mock.calls[0]?.[1]?.headers as Record<string, string>).authorization).toBe("Bearer at");
  });

  it("maps 401 and 403 to FraxNetAuthError and a malformed /org to UpstreamError", async () => {
    const expired = real(async () => Response.json({ error: "invalid_token", error_description: "revoked" }, { status: 401 }));
    await expect(expired.getIdentity("at")).rejects.toMatchObject({ name: "FraxNetAuthError", code: "invalid_token" });
    const scoped = real(async () => new Response("", { status: 403 }));
    await expect(scoped.getIdentity("at")).rejects.toMatchObject({ name: "FraxNetAuthError", code: "insufficient_scope" });
    const garbled = real(async (input) => Response.json(input.endsWith("/me") ? ME : { id: "org_1", name: "x" }));
    await expect(garbled.getIdentity("at")).rejects.toBeInstanceOf(UpstreamError);
    const mismatched = real(async (input) => Response.json(input.endsWith("/me") ? ME : { ...ORG, id: "org_2" }));
    await expect(mismatched.getIdentity("at")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("adds the app wallet to the FraxNet organization with POST /org/addresses (U-78)", async () => {
    const fetch = vi.fn<FetchFn>(async () => Response.json({ id: "a1", name: "FraxNet College", address: WALLET, chainId: 252, depositContract: "0x", createdAt: "x" }, { status: 201 }));
    await real(fetch).addWallet("at", { address: WALLET, chainId: 252, name: "FraxNet College" });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${API}/org/addresses`);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer at");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "FraxNet College", address: WALLET, chainId: 252 });
    // a token without addresses:manage is refused as insufficient_scope; a chain FraxNet won't take is an upstream error
    await expect(real(async () => new Response("", { status: 403 })).addWallet("at", { address: WALLET, chainId: 252, name: "x" })).rejects.toMatchObject({ code: "insufficient_scope" });
    await expect(real(async () => Response.json({ error: "invalid_request" }, { status: 400 })).addWallet("at", { address: WALLET, chainId: 1, name: "x" })).rejects.toBeInstanceOf(UpstreamError);
  });

  it("has no liquidation address route yet (U-37)", async () => {
    const fetch = vi.fn<FetchFn>();
    await expect(real(fetch).getLiquidationAddress(WALLET)).rejects.toMatchObject({ name: "NotAvailableError", uncertainty: "U-37" });
    await expect(real(fetch).getLiquidationAddress(WALLET)).rejects.toBeInstanceOf(NotAvailableError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("KYC from a FraxNet identity (U-77)", () => {
  it("a verified personal organization is approved; anything else waits on FraxNet", () => {
    expect(verificationFromIdentity(identity({}))).toEqual({ status: "approved", reason: "verified" });
    expect(verificationFromIdentity(identity({ isBusiness: null }))).toEqual({ status: "pending", reason: "not_verified" });
    expect(verificationFromIdentity(identity({ verified: false }))).toEqual({ status: "pending", reason: "not_verified" });
    expect(verificationFromIdentity(identity({ isBusiness: true }))).toEqual({ status: "pending", reason: "business_org" });
  });
});

describe("mock FraxNetClient", () => {
  it("runs the whole connect flow offline: straight back to the redirect URI, then tokens, then a verified person", async () => {
    const client = createMockFraxNetClient({ appUrl: "https://net.frax.com", now: () => NOW });
    const back = new URL(client.authorizeUrl({ redirectUri: "http://localhost:3000/fraxnet/callback/", state: "state-123", nonce: "n", codeChallenge: "c" }));
    expect(`${back.origin}${back.pathname}`).toBe("http://localhost:3000/fraxnet/callback/");
    expect(back.searchParams.get("state")).toBe("state-123");
    const tokens = await client.exchangeCode({ code: back.searchParams.get("code") ?? "", codeVerifier: "v", redirectUri: "x" });
    const first = await client.getIdentity(tokens.accessToken);
    expect(first.org).toMatchObject({ verified: true, isBusiness: false });
    const refreshed = await client.refresh(tokens.refreshToken ?? "");
    expect((await client.getIdentity(refreshed.accessToken)).userId).toBe(first.userId);
  });

  it("each connect is a different FraxNet user, and tests can make the organization unverified", async () => {
    const client = createMockFraxNetClient({ appUrl: "https://net.frax.com", org: { verified: false } });
    const code = () => new URL(client.authorizeUrl({ redirectUri: "http://x.test/cb", state: "state-123", nonce: "n", codeChallenge: "c" })).searchParams.get("code") ?? "";
    const a = await client.getIdentity((await client.exchangeCode({ code: code(), codeVerifier: "v", redirectUri: "x" })).accessToken);
    const b = await client.getIdentity((await client.exchangeCode({ code: code(), codeVerifier: "v", redirectUri: "x" })).accessToken);
    expect(a.userId).not.toBe(b.userId);
    expect(a.org.verified).toBe(false);
  });

  it("records added wallets per user, once per address and chain", async () => {
    const client = createMockFraxNetClient({ appUrl: "https://net.frax.com" });
    const code = new URL(client.authorizeUrl({ redirectUri: "http://x.test/cb", state: "state-123", nonce: "n", codeChallenge: "c" })).searchParams.get("code") ?? "";
    const { accessToken } = await client.exchangeCode({ code, codeVerifier: "v", redirectUri: "x" });
    await client.addWallet(accessToken, { address: WALLET, chainId: 252, name: "first" });
    await client.addWallet(accessToken, { address: WALLET.toLowerCase() as `0x${string}`, chainId: 252, name: "renamed" });
    expect([...client.wallets.values()]).toEqual([[{ address: WALLET.toLowerCase(), chainId: 252, name: "renamed" }]]);
  });

  it("rejects codes and tokens it didn't issue, like FraxNet would", async () => {
    const client = createMockFraxNetClient({ appUrl: "https://net.frax.com" });
    await expect(client.exchangeCode({ code: "forged", codeVerifier: "v", redirectUri: "x" })).rejects.toMatchObject({ code: "invalid_grant" });
    await expect(client.getIdentity("forged")).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("reports liquidation addresses tests set, then its store", async () => {
    const client = createMockFraxNetClient({ appUrl: "https://net.frax.com", store: { getLiquidationAddress: async () => LIQUIDATION } });
    await expect(client.getLiquidationAddress(WALLET)).resolves.toBe(LIQUIDATION);
    client.setLiquidationAddress(WALLET, null);
    await expect(client.getLiquidationAddress(WALLET)).resolves.toBeNull();
  });
});
