import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/** The brand tokens in the first block a selector matches, e.g. the light `:root { ... }`. */
function tokens(selector: RegExp): Record<string, string> {
  const block = selector.exec(css)?.[1];
  if (!block) throw new Error(`no block for ${selector}`);
  return Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1] as string, (m[2] as string).toLowerCase()]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// one theme: the first :root block holds the color tokens (U-76)
const THEMES = {
  light: tokens(/^:root\s*\{([^}]*)\}/m),
};

/** The ten tokens BRAND.md names, plus the ones the design canvas adds (U-65). */
const TOKENS = [
  "bg", "surface", "surface-muted", "border", "divider", "text", "text-muted", "accent", "accent-contrast", "link",
  "info", "info-soft", "success", "success-soft", "warning", "warning-soft", "danger", "danger-soft", "highlight", "highlight-contrast",
];

/** Every pairing the UI uses: text-colored tokens on each background, and text on each filled or soft color. */
const TEXT_ON_BACKGROUNDS = ["text", "text-muted", "accent", "link", "success", "warning", "danger", "info"];
const BACKGROUNDS = ["bg", "surface", "surface-muted"];
const FILLED = [
  ["accent-contrast", "accent"],
  ["surface", "danger"],
  ["bg", "text"],
  ["highlight-contrast", "highlight"],
  ["info", "info-soft"],
  ["success", "success-soft"],
  ["warning", "warning-soft"],
  ["danger", "danger-soft"],
  ["text", "divider"],
  ["text-muted", "divider"],
] as const;

describe("brand tokens pass WCAG AA (4.5:1 for text)", () => {
  it("the theme defines every color token", () => {
    for (const theme of Object.values(THEMES)) expect(Object.keys(theme).sort()).toEqual([...TOKENS].sort());
  });

  it("there is no dark theme left", () => {
    expect(css).not.toMatch(/data-theme="dark"|prefers-color-scheme|@custom-variant dark/);
  });

  it("no component uses dark: classes, which Tailwind would tie to the device's dark setting", () => {
    const files = ["../app/", "../components/"].flatMap((dir) =>
      readdirSync(new URL(dir, import.meta.url), { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => new URL(dir + f, import.meta.url)),
    );
    const hits = files.filter((f) => /[\s"'`]dark:[a-z[]/.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => f.pathname)).toEqual([]);
  });

  for (const [name, t] of Object.entries(THEMES)) {
    for (const fg of TEXT_ON_BACKGROUNDS) {
      for (const bg of BACKGROUNDS) {
        it(`${name}: --${fg} on --${bg}`, () => {
          expect(contrast(t[fg] as string, t[bg] as string)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    for (const [fg, bg] of FILLED) {
      it(`${name}: --${fg} on --${bg}`, () => {
        expect(contrast(t[fg] as string, t[bg] as string)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("white text on the ink surfaces passes too", () => {
    const ink = /--ink:\s*(#[0-9a-f]{6})/i.exec(css)?.[1] as string;
    const ink2 = /--ink-2:\s*(#[0-9a-f]{6})/i.exec(css)?.[1] as string;
    expect(contrast("#ffffff", ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", ink2)).toBeGreaterThanOrEqual(4.5);
  });

  it("the contrast math matches known values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});
