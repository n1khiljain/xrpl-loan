import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { logoFiles } from "../components/brand/lockup";
import { LockupView } from "../components/brand/lockup-view";
import { TestnetBanner } from "../components/app/testnet-banner";

const NONE = { bab: null, babOnDark: null, frax: null, fraxOnDark: null };
const ALL = { bab: "/brand/bab-logo.png", babOnDark: "/brand/bab-logo-on-dark.png", frax: "/brand/frax-logo.png", fraxOnDark: "/brand/frax-logo-on-dark.png" };

describe("header lockup (BRAND.md, U-65)", () => {
  it("falls back to the org names as text when the files are missing", () => {
    const html = renderToStaticMarkup(<LockupView files={NONE} />);
    expect(html).toContain("Blockchain at Berkeley");
    expect(html).toContain(">Frax<");
    expect(html).not.toContain("<img");
    expect(html.match(/data-fallback="text"/g)).toHaveLength(2);
  });

  it("uses the official files from public/brand when they exist, Frax first as in the design canvas", () => {
    const html = renderToStaticMarkup(<LockupView files={ALL} />);
    // one theme, so the default lockup is the regular files only (U-76)
    expect(html).toContain('src="/brand/bab-logo.png"');
    expect(html).toContain('src="/brand/frax-logo.png"');
    expect(html).not.toContain("on-dark.png");
    expect(html.indexOf("frax-logo")).toBeLessThan(html.indexOf("bab-logo"));
  });

  it("on dark surfaces uses only the on-dark files", () => {
    const html = renderToStaticMarkup(<LockupView files={ALL} tone="on-dark" />);
    expect(html).toContain('src="/brand/bab-logo-on-dark.png"');
    expect(html).toContain('src="/brand/frax-logo-on-dark.png"');
    expect(html).not.toContain('src="/brand/bab-logo.png"');
  });

  it("on pale surfaces uses only the regular files", () => {
    const html = renderToStaticMarkup(<LockupView files={ALL} tone="on-light" />);
    expect(html).toContain('src="/brand/bab-logo.png"');
    expect(html).toContain('src="/brand/frax-logo.png"');
    expect(html).not.toContain("on-dark.png");
  });

  it("falls back to the other variant when only one exists", () => {
    const html = renderToStaticMarkup(<LockupView files={{ ...NONE, bab: "/brand/bab-logo.png", fraxOnDark: "/brand/frax-logo-on-dark.png" }} />);
    expect(html.match(/src="\/brand\/bab-logo\.png"/g)).toHaveLength(1);
    expect(html.match(/src="\/brand\/frax-logo-on-dark\.png"/g)).toHaveLength(1);
  });

  it("finds each file in public/brand at build time, SVG before PNG", () => {
    const dir = mkdtempSync(join(tmpdir(), "brand-"));
    expect(logoFiles(dir)).toEqual(NONE);
    writeFileSync(join(dir, "frax-logo.png"), "");
    expect(logoFiles(dir)).toEqual({ ...NONE, frax: "/brand/frax-logo.png" });
    writeFileSync(join(dir, "frax-logo.svg"), "");
    expect(logoFiles(dir)).toEqual({ ...NONE, frax: "/brand/frax-logo.svg" });
  });

  it("the repo ships all four official files", () => {
    expect(logoFiles(new URL("../public/brand", import.meta.url).pathname)).toEqual(ALL);
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
    walk(new URL("../app", import.meta.url).pathname);
    walk(new URL("../components", import.meta.url).pathname);
    expect(offenders).toEqual([]);
  });
});

describe("testnet banner (FR-F9)", () => {
  it("renders the BRAND.md text when isTestnet is true", () => {
    const html = renderToStaticMarkup(<TestnetBanner isTestnet />);
    expect(html).toContain("Testnet pilot. No real money moves.");
    expect(html).toContain('role="status"');
  });

  it("renders nothing when isTestnet is false", () => {
    expect(renderToStaticMarkup(<TestnetBanner isTestnet={false} />)).toBe("");
  });
});
