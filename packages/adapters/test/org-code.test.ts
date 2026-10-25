import { describe, expect, it } from "vitest";
import { formatJoinCode, makeJoinCode, normalizeJoinCode } from "../shared/org-code.ts";

describe("organization ids", () => {
  it("makes an eight-character code and accepts it with a hyphen", () => {
    const code = makeJoinCode();
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(formatJoinCode(code)).toBe(`${code.slice(0, 4)}-${code.slice(4)}`);
    expect(normalizeJoinCode(` ${formatJoinCode(code).toLowerCase()} `)).toBe(code);
    expect(normalizeJoinCode("nope")).toBeNull();
    expect(normalizeJoinCode("OOOOOOOO")).toBeNull();
  });
});
