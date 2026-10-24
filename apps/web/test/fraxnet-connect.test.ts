import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rememberReturnPath, safeReturnPath, takeReturnPath } from "@/lib/fraxnet-connect";

describe("Connect FraxNet return path (U-77)", () => {
  // vitest runs in node here, so give it the one browser store this uses
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("only accepts same-site paths", () => {
    expect(safeReturnPath("/guarantee/?invite=abc")).toBe("/guarantee/?invite=abc");
    for (const bad of [null, "", "https://evil.example/", "//evil.example/x", "/\\evil.example", "onboard/"]) {
      expect(safeReturnPath(bad)).toBeNull();
    }
  });

  it("is used once, and an unsafe path is never stored", () => {
    rememberReturnPath("/claims/new/");
    expect(takeReturnPath()).toBe("/claims/new/");
    expect(takeReturnPath()).toBeNull();
    rememberReturnPath("//evil.example/");
    expect(takeReturnPath()).toBeNull();
  });
});
