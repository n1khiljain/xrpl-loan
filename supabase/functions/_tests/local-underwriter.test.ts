import { assertEquals, assertRejects } from "@std/assert";
import { ANVIL_UNDERWRITER, ensureLocalUnderwriter } from "./local-underwriter.ts";

/** anvil / hardhat default mnemonic accounts 0 to 9: publicly known keys. */
const ANVIL_ACCOUNTS = [
  ANVIL_UNDERWRITER,
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
  "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
  "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
  "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc",
  "0x976ea74026e726554db657fa54763abd0c3a0aa9",
  "0x14dc79964da2c08b23698b3d3cc7ca32193d9955",
  "0x23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f",
  "0xa0ee7a142d267c1f36714e4a8f75612f20a79720",
];

// E-6a (fixed): the seed every `db reset` runs makes nobody staff; the anvil underwriter is added by local scripts
Deno.test("E6: supabase/seed.sql names no publicly known anvil account", async () => {
  const seed = (await Deno.readTextFile(new URL("../../seed.sql", import.meta.url))).toLowerCase();
  assertEquals(ANVIL_ACCOUNTS.filter((a) => seed.includes(a)), []);
  assertEquals(/insert\s+into\s+public\.staff/.test(seed), false);
});

Deno.test("E6: the local underwriter script refuses a Supabase that isn't on this machine", async () => {
  await assertRejects(() => ensureLocalUnderwriter({ url: "https://abcdefgh.supabase.co", serviceKey: "x" }), Error, "local only");
});
