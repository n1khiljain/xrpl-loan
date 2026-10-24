/**
 * Finds the local Supabase stack for integration tests: `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`, and
 * `SUPABASE_TEST_SERVICE_ROLE_KEY` if set (CI), else `supabase status -o env`. Returns null when no stack is
 * running, and the tests that need it are skipped with a notice.
 */
export type LocalStack = { url: string; anonKey: string; publishableKey: string | null; serviceKey: string };

const REPO_ROOT = decodeURIComponent(new URL("../../..", import.meta.url).pathname);

async function fromCli(): Promise<LocalStack | null> {
  const home = Deno.env.get("HOME") ?? "";
  for (const bin of ["supabase", `${home}/.local/bin/supabase`, "/opt/homebrew/bin/supabase"]) {
    try {
      const out = await new Deno.Command(bin, { args: ["status", "-o", "env"], cwd: REPO_ROOT, stdout: "piped", stderr: "null" }).output();
      if (!out.success) continue;
      const vars = Object.fromEntries(
        new TextDecoder()
          .decode(out.stdout)
          .split("\n")
          .map((line) => /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim()))
          .filter((m): m is RegExpExecArray => m !== null)
          .map((m) => [m[1], m[2]]),
      );
      if (vars.API_URL && vars.ANON_KEY && vars.SERVICE_ROLE_KEY) {
        return { url: vars.API_URL, anonKey: vars.ANON_KEY, publishableKey: vars.PUBLISHABLE_KEY ?? null, serviceKey: vars.SERVICE_ROLE_KEY };
      }
    } catch {
      // binary not found; try the next
    }
  }
  return null;
}

async function find(): Promise<LocalStack | null> {
  const url = Deno.env.get("SUPABASE_TEST_URL");
  const anonKey = Deno.env.get("SUPABASE_TEST_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_TEST_SERVICE_ROLE_KEY");
  const stack = url && anonKey && serviceKey ? { url, anonKey, serviceKey, publishableKey: null } : await fromCli();
  if (!stack) return null;
  try {
    const res = await fetch(`${stack.url}/rest/v1/`, { headers: { apikey: stack.serviceKey, authorization: `Bearer ${stack.serviceKey}` } });
    await res.body?.cancel();
    return res.ok ? stack : null;
  } catch {
    return null;
  }
}

export const LOCAL_STACK = await find();
if (!LOCAL_STACK) console.warn("local Supabase stack not running: skipping database integration tests (run `supabase start`)");
