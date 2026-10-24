import { assertRejects, assertThrows } from "@std/assert";
import { assertLocal, ensureLocalStaff } from "./local-underwriter.ts";

Deno.test("local staff can only be added on this machine", async () => {
  assertThrows(() => assertLocal("https://abc.supabase.co"));
  assertLocal("http://127.0.0.1:54321");
  await assertRejects(() => ensureLocalStaff({ url: "https://abc.supabase.co", serviceKey: "x" }, "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY", "admin"));
});

Deno.test("local staff must be an XRPL address", async () => {
  await assertRejects(() => ensureLocalStaff({ url: "http://127.0.0.1:1", serviceKey: "x" }, "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "admin"));
});
