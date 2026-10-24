import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else out.push(path);
  }
  return out;
}

const SOURCES = [...files(fileURLToPath(new URL("../app", import.meta.url))), ...files(fileURLToPath(new URL("../components", import.meta.url)))].filter(
  (p) => /\.(tsx?|css)$/.test(p),
);

describe("copy and styling rules", () => {
  it("no raw hex colors outside app/globals.css (design tokens only)", () => {
    const hits = SOURCES.filter((p) => !p.endsWith("app/globals.css")).flatMap((p) =>
      readFileSync(p, "utf8")
        .split("\n")
        .map((line, i) => ({ i, line }))
        // a color literal: # plus 3, 4, 6, or 8 hex digits, not part of an address or hash
        .filter(({ line }) => /(^|[^&0-9a-zA-Z_])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/.test(line))
        .map(({ i, line }) => `${p}:${i + 1}: ${line.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  it("no rgb(), hsl(), or oklch() color functions outside globals.css", () => {
    const hits = SOURCES.filter((p) => !p.endsWith("app/globals.css")).filter((p) => /\b(rgba?|hsla?|oklch|oklab)\(/.test(readFileSync(p, "utf8")));
    expect(hits).toEqual([]);
  });
});
