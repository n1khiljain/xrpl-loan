import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const ADAPTERS = ["fraxnet", "gas-sponsor", "cash-out", "chain-reader"] as const;

function sources(dir: string): { file: string; text: string }[] {
  return readdirSync(join(ROOT, dir))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ file: `${dir}/${name}`, text: readFileSync(join(ROOT, dir, name), "utf8") }));
}

const ALL = [...ADAPTERS, "shared"].flatMap(sources);

function imports(text: string): string[] {
  return [...text.matchAll(/(?:import|export)[^"']*?from\s+["']([^"']+)["']/g)].map((m) => m[1] ?? "");
}

describe("adapter sources", () => {
  it("run in the browser and in Deno: no Node built-ins, process, or Buffer", () => {
    for (const { file, text } of ALL) {
      expect(imports(text).filter((spec) => spec.startsWith("node:")), file).toEqual([]);
      expect(text, file).not.toMatch(/\bprocess\.|\bBuffer\b|\brequire\(/);
    }
  });

  it("use .ts extensions on relative imports, which Deno needs", () => {
    for (const { file, text } of ALL) {
      const relative = imports(text).filter((spec) => spec.startsWith("."));
      expect(relative.filter((spec) => !spec.endsWith(".ts")), file).toEqual([]);
    }
  });

  it("import only their own folder, shared/, @app/*, and viem (FR-A2)", () => {
    for (const adapter of ADAPTERS) {
      for (const { file, text } of sources(adapter)) {
        for (const spec of imports(text)) {
          const allowed =
            spec.startsWith("./") ||
            spec.startsWith("../shared/") ||
            spec === "@app/config" ||
            spec === "@app/abi" ||
            spec === "viem" ||
            spec.startsWith("viem/");
          expect(allowed, `${file} imports ${spec}`).toBe(true);
        }
      }
    }
  });

  it("use purchase language only (U-09)", () => {
    for (const { file, text } of ALL) expect(text, file).not.toMatch(/\b(loan|borrow\w*|interest|repay\w*)\b/i);
  });
});
