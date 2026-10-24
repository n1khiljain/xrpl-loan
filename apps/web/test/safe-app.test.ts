import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { describe, expect, it } from "vitest";

const PUBLIC = join(import.meta.dirname, "../public");
type Manifest = { name: string; description: string; iconPath: string };
const read = (path: string) => JSON.parse(readFileSync(join(PUBLIC, path), "utf8")) as Manifest;

describe("Safe App manifest (SYSTEM_DESIGN 6.4, U-27, U-64)", () => {
  it("sits next to both app URLs, since Safe{Wallet} reads <appUrl>/manifest.json", () => {
    const root = read("manifest.json");
    const admin = read("admin/manifest.json");
    expect(admin.name).toBe(root.name);
    expect(admin.description).toBe(root.description);
    expect(root.name).toMatch(/B@B x Frax/);
  });

  it("points both icons at the same official file in public/brand", () => {
    const fromRoot = posix.normalize(read("manifest.json").iconPath);
    const fromAdmin = posix.normalize(posix.join("admin", read("admin/manifest.json").iconPath));
    expect(fromAdmin).toBe(fromRoot);
    expect(fromRoot).toMatch(/^brand\/bab-(logo|mark)(-on-dark)?\.(svg|png)$/);
    expect(existsSync(join(PUBLIC, fromRoot))).toBe(true);
  });

  it("_headers allows the Safe UI to fetch the manifests and the icon cross-origin", () => {
    const headers = readFileSync(join(PUBLIC, "_headers"), "utf8");
    for (const path of ["/manifest.json", "/admin/manifest.json", "/brand/*"]) {
      expect(headers).toMatch(new RegExp(`^${path.replace(/[.*/]/g, "\\$&")}\\n  Access-Control-Allow-Origin: \\*$`, "m"));
    }
  });
});
