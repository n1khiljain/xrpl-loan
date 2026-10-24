import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { logoFiles } from "../components/brand/lockup";
import { LockupView } from "../components/brand/lockup-view";
import { TestnetBanner } from "../components/app/testnet-banner";

const NONE = { bab: null, babOnDark: null };
const ALL = { bab: "/brand/bab-logo.png", babOnDark: "/brand/bab-logo-on-dark.png" };

describe("header lockup", () => {
  it("falls back to the org name as text when the files are missing", () => {
    const html = renderToStaticMarkup(<LockupView files={NONE} />);
    expect(html).toContain("Blockchain at Berkeley");
    expect(html).not.toContain("<img");
    expect(html.match(/data-fallback="text"/g)).toHaveLength(1);
  });

  it("uses the official B@B file and names no other brand's logo", () => {
    const html = renderToStaticMarkup(<LockupView files={ALL} />);
    expect(html).toContain('src="/brand/bab-logo.png"');
    expect(html).not.toContain("on-dark.png");
    expect(html.match(/<img/g)).toHaveLength(1);
    expect(html).not.toMatch(/frax|ripple|xrpl-logo/i);
  });

  it("on dark surfaces uses the on-dark file", () => {
    const html = renderToStaticMarkup(<LockupView files={ALL} tone="on-dark" />);
    expect(html).toContain('src="/brand/bab-logo-on-dark.png"');
  });

  it("falls back to the other variant when only one exists", () => {
    const html = renderToStaticMarkup(<LockupView files={{ ...NONE, babOnDark: "/brand/bab-logo-on-dark.png" }} />);
    expect(html).toContain('src="/brand/bab-logo-on-dark.png"');
  });

  it("finds each file in public/brand at build time, SVG before PNG", () => {
    const dir = mkdtempSync(join(tmpdir(), "brand-"));
    expect(logoFiles(dir)).toEqual(NONE);
    writeFileSync(join(dir, "bab-logo.png"), "");
    expect(logoFiles(dir)).toEqual({ ...NONE, bab: "/brand/bab-logo.png" });
    writeFileSync(join(dir, "bab-logo.svg"), "");
    expect(logoFiles(dir)).toEqual({ ...NONE, bab: "/brand/bab-logo.svg" });
  });

  it("the repo ships the official files and no Frax ones", () => {
    expect(logoFiles(fileURLToPath(new URL("../public/brand", import.meta.url)))).toEqual(ALL);
    expect(readdirSync(fileURLToPath(new URL("../public/brand", import.meta.url))).filter((f) => /frax|frxusd/i.test(f))).toEqual([]);
  });

  it("no logo is drawn in code: no inline SVG anywhere in app/ or components/", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(tsx?|css)$/.test(name) && /<svg|<path\b|<polygon|<circle/.test(readFileSync(path, "utf8"))) offenders.push(path);
      }
    };
    walk(fileURLToPath(new URL("../app", import.meta.url)));
    walk(fileURLToPath(new URL("../components", import.meta.url)));
    expect(offenders).toEqual([]);
  });
});

describe("test network banner", () => {
  it("renders the banner text when isTestnet is true", () => {
    const html = renderToStaticMarkup(<TestnetBanner isTestnet />);
    expect(html).toContain("XRPL test network. No real money moves.");
    expect(html).toContain('role="status"');
  });

  it("renders nothing when isTestnet is false", () => {
    expect(renderToStaticMarkup(<TestnetBanner isTestnet={false} />)).toBe("");
  });
});
