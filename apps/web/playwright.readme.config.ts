import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// `pnpm --filter web readme-shots`: only e2e/readme.tour.ts, which writes docs/screenshots.
export default defineConfig({ ...base, testMatch: /readme\.tour\.ts/ });
