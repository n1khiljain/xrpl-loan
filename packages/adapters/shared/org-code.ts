/** Letters and digits that stay readable when someone types an organization id. No 0, 1, I, or O. */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Eight characters from `JOIN_CODE_ALPHABET`. Stored without a hyphen. */
export function makeJoinCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length]).join("");
}

/** `ABCD-EFGH` for showing and copying. Anything that isn't eight characters is returned as given. */
export function formatJoinCode(code: string): string {
  const raw = code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (raw.length !== 8) return code.trim();
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** The stored form of an organization id someone typed, or null when it can't be one. */
export function normalizeJoinCode(input: string): string | null {
  const code = input.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (code.length !== 8) return null;
  for (const ch of code) if (!JOIN_CODE_ALPHABET.includes(ch)) return null;
  return code;
}
