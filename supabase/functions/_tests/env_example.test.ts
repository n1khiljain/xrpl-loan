import { assert, assertEquals } from "@std/assert";
import { ENV_NAMES } from "../_shared/env.ts";

const text = await Deno.readTextFile(new URL("../../../.env.example", import.meta.url));
const entries = new Map(
  text
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);

/** Values that are fine to commit: names, local URLs. Everything else must be empty. */
const PUBLIC_DEFAULTS: Record<string, string> = {
  NETWORK: "local",
  NEXT_PUBLIC_NETWORK: "local",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  APP_BASE_URL: "http://localhost:3000",
};

/** SYSTEM_DESIGN section 9 plus what the functions read. */
const WEB = ["NEXT_PUBLIC_NETWORK", "NEXT_PUBLIC_PRIVY_APP_ID", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];

Deno.test(".env.example lists every variable the functions and the web app read", () => {
  for (const name of [...ENV_NAMES, ...WEB]) assert(entries.has(name), `.env.example is missing ${name}`);
});

Deno.test(".env.example has no real values", () => {
  for (const [name, value] of entries) {
    assertEquals(value, PUBLIC_DEFAULTS[name] ?? "", `${name} must be empty in .env.example`);
  }
});

Deno.test("functions read env only through the typed list", async () => {
  const offenders: string[] = [];
  for await (const entry of Deno.readDir(new URL("..", import.meta.url))) {
    if (!entry.isDirectory || entry.name === "_tests") continue;
    for await (const file of Deno.readDir(new URL(`../${entry.name}`, import.meta.url))) {
      if (!file.name.endsWith(".ts") || file.name.endsWith(".test.ts")) continue;
      const source = await Deno.readTextFile(new URL(`../${entry.name}/${file.name}`, import.meta.url));
      if (source.includes("Deno.env.get") && !(entry.name === "_shared" && ["env.ts", "local-stack.ts", "testing.ts"].includes(file.name))) {
        offenders.push(`${entry.name}/${file.name}`);
      }
    }
  }
  assertEquals(offenders, []);
});
