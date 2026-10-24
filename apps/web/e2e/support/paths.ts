import { join, resolve } from "node:path";

export const WEB = resolve(import.meta.dirname, "../..");
export const ROOT = resolve(WEB, "../..");
export const CACHE = join(WEB, "e2e/.cache");
export const CONTEXT_FILE = join(CACHE, "context.json");
export const SCREENSHOTS = join(WEB, "e2e/screenshots");

export type E2EContext = {
  apiUrl: string;
  anonKey: string;
  rpcUrl: string;
  privyAppId: string;
  cronSecret: string;
  jwkFile: string;
};
