import { AdapterConfigError, NotAvailableError, UpstreamError } from "../shared/errors.ts";
import type { Fetch } from "../shared/chain.ts";
import { FRAXNET_REQUIRED_SCOPES, FRAXNET_SCOPES, FraxNetAuthError, type FraxNetClient, type FraxNetIdentity, type FraxNetTokens } from "./types.ts";

export type RealFraxNetOptions = {
  appUrl: string;
  /** REST API base, e.g. `https://net-test.frax.com/api/v1` */
  apiBase: string;
  /** OAuth issuer, e.g. `https://net-test-oauth.frax.com` */
  issuer: string;
  /** `FRAXNET_CLIENT_ID`. Public, but kept with the secret so one place configures the app. */
  clientId?: string;
  /** `FRAXNET_CLIENT_SECRET`. Only ever sent to the token endpoint, never to a browser. */
  clientSecret?: string;
  fetch?: Fetch;
  now?: () => Date;
};

const trim = (url: string) => url.replace(/\/+$/, "");

type Json = Record<string, unknown>;

async function readJson(response: Response, what: string): Promise<Json> {
  try {
    const body = await response.json();
    if (body && typeof body === "object") return body as Json;
  } catch {
    // fall through
  }
  throw new UpstreamError("FraxNetClient", response.status, `${what} returned a body that is not a JSON object`);
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function need(body: Json, key: string, what: string): string {
  const value = str(body[key]);
  if (value === null || value === "") throw new UpstreamError("FraxNetClient", null, `${what} is missing ${key}`);
  return value;
}

/**
 * FraxNet's OAuth 2.0 / OpenID Connect app integration (U-77). The authorization server is Ory Hydra at the
 * issuer, so the endpoints are Hydra's fixed paths; the API is `apiBase`. Codes are exchanged as a confidential
 * client (HTTP Basic) with PKCE on top, as FraxNet recommends.
 */
export function createRealFraxNetClient(options: RealFraxNetOptions): FraxNetClient {
  const doFetch: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => new Date());
  const issuer = trim(options.issuer);
  const api = trim(options.apiBase);

  function credentials(): { id: string; secret: string } {
    if (!options.clientId || !options.clientSecret) {
      throw new AdapterConfigError("FraxNetClient", "FRAXNET_CLIENT_ID and FRAXNET_CLIENT_SECRET are needed to connect FraxNet (U-77)");
    }
    return { id: options.clientId, secret: options.clientSecret };
  }

  async function token(form: Record<string, string>): Promise<FraxNetTokens> {
    const { id, secret } = credentials();
    const basic = btoa(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`);
    const response = await doFetch(`${issuer}/oauth2/token`, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(form).toString(),
    });
    const body = await readJson(response, "the token endpoint");
    if (!response.ok) {
      const code = str(body.error);
      if (code) throw new FraxNetAuthError(code, str(body.error_description) ?? `HTTP ${response.status}`);
      throw new UpstreamError("FraxNetClient", response.status, `the token endpoint returned HTTP ${response.status}`);
    }
    const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
    return {
      accessToken: need(body, "access_token", "the token response"),
      refreshToken: str(body.refresh_token),
      expiresAt: new Date(now().getTime() + expiresIn * 1000).toISOString(),
      scopes: (str(body.scope) ?? "").split(" ").filter(Boolean),
    };
  }

  async function request(path: string, accessToken: string, body?: unknown): Promise<Json> {
    const response = await doFetch(`${api}${path}`, {
      ...(body === undefined
        ? { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } }
        : {
            method: "POST",
            headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    const what = `${body === undefined ? "GET" : "POST"} ${path}`;
    if (response.status === 401 || response.status === 403) {
      const error = await readJson(response, what).catch(() => ({}) as Json);
      throw new FraxNetAuthError(str(error.error) ?? (response.status === 401 ? "invalid_token" : "insufficient_scope"), str(error.error_description) ?? `${what} returned HTTP ${response.status}`);
    }
    if (!response.ok) throw new UpstreamError("FraxNetClient", response.status, `${what} returned HTTP ${response.status}`);
    return readJson(response, what);
  }

  return {
    kind: "real",
    verifyUrl: () => options.appUrl,
    authorizeUrl(request) {
      const params = new URLSearchParams({
        client_id: credentials().id,
        redirect_uri: request.redirectUri,
        response_type: "code",
        scope: FRAXNET_SCOPES.join(" "),
        required_scope: FRAXNET_REQUIRED_SCOPES.join(" "),
        state: request.state,
        nonce: request.nonce,
        code_challenge: request.codeChallenge,
        code_challenge_method: "S256",
      });
      return `${issuer}/oauth2/auth?${params.toString()}`;
    },
    exchangeCode: ({ code, codeVerifier, redirectUri }) =>
      token({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier }),
    refresh: (refreshToken) => token({ grant_type: "refresh_token", refresh_token: refreshToken }),
    async getIdentity(accessToken) {
      const [me, org] = await Promise.all([request("/me", accessToken), request("/org", accessToken)]);
      const meOrg = (me.organization ?? {}) as Json;
      const orgId = need(org, "id", "GET /org");
      if (str(meOrg.id) !== null && meOrg.id !== orgId) {
        throw new UpstreamError("FraxNetClient", null, "GET /me and GET /org disagree on the organization");
      }
      if (typeof org.verified !== "boolean") throw new UpstreamError("FraxNetClient", null, "GET /org is missing verified");
      const identity: FraxNetIdentity = {
        userId: need(me, "id", "GET /me"),
        email: str(me.email),
        firstName: str(me.firstName),
        lastName: str(me.lastName),
        org: {
          id: orgId,
          name: str(org.name) ?? str(meOrg.name) ?? "",
          verified: org.verified,
          verifiedAt: str(org.verifiedAt),
          isBusiness: typeof org.isBusiness === "boolean" ? org.isBusiness : null,
        },
      };
      return identity;
    },
    async addWallet(accessToken, wallet) {
      await request("/org/addresses", accessToken, { name: wallet.name, address: wallet.address, chainId: wallet.chainId });
    },
    getLiquidationAddress: () =>
      Promise.reject(new NotAvailableError("FraxNetClient", "getLiquidationAddress", "U-37", "FraxNet's API has no liquidation address route")),
  };
}
