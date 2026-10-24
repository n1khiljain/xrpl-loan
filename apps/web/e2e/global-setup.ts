import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { extname, join, normalize } from "node:path";
import { CACHE, CONTEXT_FILE, type E2EContext, ROOT, WEB } from "./support/paths";

const RPC = "http://127.0.0.1:8545";
const PATH = [process.env.PATH, join(homedir(), ".foundry/bin"), join(homedir(), ".local/bin"), "/opt/homebrew/bin"].join(":");
const env = { ...process.env, PATH, NEXT_TELEMETRY_DISABLED: "1" };
const children: ChildProcess[] = [];

async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return ((await res.json()) as { result: unknown }).result;
}

async function waitFor(what: string, check: () => Promise<boolean>, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** anvil on :8545 with Deploy.s.sol's local addresses. Reused if running; started fresh if not. */
async function ensureChain() {
  const up = await rpc("eth_chainId").catch(() => null);
  if (!up) {
    const anvil = spawn("anvil", ["--host", "0.0.0.0", "--port", "8545", "--silent"], { env, stdio: "ignore" });
    children.push(anvil);
    await waitFor("anvil", async () => Boolean(await rpc("eth_chainId")));
  }
  const local = JSON.parse(readFileSync(join(ROOT, "deployments/local.json"), "utf8")) as { deployed: { claimRegistry: string } };
  const code = (await rpc("eth_getCode", [local.deployed.claimRegistry, "latest"])) as string;
  if (code === "0x") {
    execFileSync("forge", ["script", "script/Deploy.s.sol", "--rpc-url", RPC, "--broadcast"], { cwd: join(ROOT, "contracts"), env: { ...env, NETWORK: "local" }, stdio: "inherit" });
    const again = (await rpc("eth_getCode", [local.deployed.claimRegistry, "latest"])) as string;
    if (again === "0x") throw new Error("anvil has other state at the local addresses; restart anvil and try again");
  }
}

function supabaseStatus(): Record<string, string> {
  const out = execFileSync("supabase", ["status", "-o", "env"], { cwd: ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return Object.fromEntries(
    out
      .split("\n")
      .map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1], m[2]]),
  );
}

/** Local Supabase, and the functions served with a throwaway e2e env (a Privy test key made for this run). */
async function ensureBackend(): Promise<{ status: Record<string, string>; functionsEnv: Record<string, string> }> {
  let status: Record<string, string>;
  try {
    status = supabaseStatus();
  } catch {
    execFileSync("supabase", ["start"], { cwd: ROOT, env, stdio: "inherit" });
    status = supabaseStatus();
  }
  // the anvil deployer is the offchain underwriter on local only; seed.sql doesn't add it (E-6a)
  execFileSync("deno", ["run", "--allow-all", "--config", "supabase/functions/deno.json", "supabase/functions/_tests/local-underwriter.ts"], { cwd: ROOT, env, stdio: "ignore" });
  mkdirSync(CACHE, { recursive: true });
  execFileSync("deno", ["run", "--allow-write", "--config", "supabase/functions/deno.json", "supabase/functions/_tests/make-e2e-env.ts", CACHE], { cwd: ROOT, env, stdio: "ignore" });
  // Linux Docker has no host.docker.internal; CI passes the bridge gateway so the edge runtime can reach anvil
  const dockerHost = process.env.E2E_DOCKER_HOST;
  if (dockerHost) {
    const file = join(CACHE, "functions.env");
    writeFileSync(file, readFileSync(file, "utf8").replaceAll("host.docker.internal", dockerHost));
  }
  const functionsEnv = Object.fromEntries(
    readFileSync(join(CACHE, "functions.env"), "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  // a serve started with another key would reject our tokens
  try {
    execFileSync("pkill", ["-f", "supabase functions serve"], { stdio: "ignore" });
  } catch {
    // none running
  }
  const serve = spawn("supabase", ["functions", "serve", "--env-file", join(CACHE, "functions.env")], { cwd: ROOT, env, stdio: ["ignore", "ignore", "ignore"] });
  children.push(serve);
  const api = status.API_URL as string;
  await waitFor("functions", async () => {
    const res = await fetch(`${api}/functions/v1/me`, { method: "POST" });
    const body = await res.text();
    return res.status === 401 && body.includes("unauthorized");
  }, 180_000);
  return { status, functionsEnv };
}

function build(status: Record<string, string>) {
  if (process.env.E2E_SKIP_BUILD === "1" && existsSync(join(WEB, "out/index.html"))) return;
  execFileSync("pnpm", ["build"], {
    cwd: WEB,
    env: {
      ...env,
      NEXT_PUBLIC_NETWORK: "local",
      NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
      NEXT_PUBLIC_PRIVY_APP_ID: "",
    },
    stdio: "inherit",
  });
}

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain", ".ico": "image/x-icon" };

/** Serves out/ the way a static host would: /claim/?id=1 is out/claim/index.html. */
function serveStatic(): Promise<() => Promise<void>> {
  const root = join(WEB, "out");
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let path = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!path.startsWith(root)) return void res.writeHead(403).end();
    if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
    if (!existsSync(path)) path = join(root, "404.html");
    res.writeHead(path.endsWith("404.html") && !url.pathname.endsWith("404.html") ? 404 : 200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    createReadStream(path).pipe(res);
  });
  return new Promise((resolve) => server.listen(3000, "localhost", () => resolve(() => new Promise((done) => server.close(() => done())))));
}

/** The stand-in Safe UI, on loopback like a real local server, so Chrome lets it frame the app. */
function serveSafeHost(): Promise<() => Promise<void>> {
  const html = readFileSync(join(WEB, "e2e/support/safe-host.html"));
  const server = createServer((_req, res) => res.writeHead(200, { "content-type": "text/html" }).end(html));
  return new Promise((resolve) => server.listen(4010, "127.0.0.1", () => resolve(() => new Promise((done) => server.close(() => done())))));
}

export default async function globalSetup() {
  await ensureChain();
  const { status, functionsEnv } = await ensureBackend();
  build(status);
  const stopServer = await serveStatic();
  const stopSafeHost = await serveSafeHost();
  const context: E2EContext = {
    apiUrl: status.API_URL as string,
    anonKey: status.ANON_KEY as string,
    rpcUrl: RPC,
    privyAppId: functionsEnv.PRIVY_APP_ID as string,
    cronSecret: functionsEnv.CHAIN_SYNC_SECRET as string,
    jwkFile: join(CACHE, "privy-test.jwk.json"),
  };
  writeFileSync(CONTEXT_FILE, JSON.stringify(context, null, 2));
  return async () => {
    await stopServer();
    await stopSafeHost();
    for (const child of children) child.kill();
  };
}
