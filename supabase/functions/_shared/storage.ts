import type { SupabaseClient } from "@supabase/supabase-js";

export const RECEIPTS_BUCKET = "receipts";

/** Signed URLs last five minutes. */
export const SIGNED_URL_SECONDS = 300;

/**
 * The private receipts bucket (FR-B3). Paths come back relative to the Supabase URL, because functions served
 * locally see an internal hostname; the web app resolves them against `NEXT_PUBLIC_SUPABASE_URL`.
 */
export interface ReceiptStorage {
  /** A one-time upload target: the web app calls `uploadToSignedUrl(path, token, file)`. */
  signedUpload(path: string): Promise<{ path: string; token: string }>;
  /** A short-lived read URL path, relative to the Supabase URL. */
  signedRead(path: string, seconds: number): Promise<string>;
  /** The stored bytes, or null if nothing was uploaded. */
  read(path: string): Promise<Uint8Array | null>;
}

function relative(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

export function supabaseStorage(client: SupabaseClient, bucket = RECEIPTS_BUCKET): ReceiptStorage {
  const store = () => client.storage.from(bucket);
  return {
    async signedUpload(path) {
      const { data, error } = await store().createSignedUploadUrl(path);
      if (error || !data) throw new Error(`storage: ${error?.message ?? "no upload URL"}`);
      return { path: data.path, token: data.token };
    },
    async signedRead(path, seconds) {
      const { data, error } = await store().createSignedUrl(path, seconds);
      if (error || !data) throw new Error(`storage: ${error?.message ?? "no signed URL"}`);
      return relative(data.signedUrl);
    },
    async read(path) {
      const { data, error } = await store().download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}

/** In-memory bucket for tests. */
export class MemoryStorage implements ReceiptStorage {
  readonly files = new Map<string, Uint8Array>();
  readonly uploads: string[] = [];

  put(path: string, bytes: Uint8Array) {
    this.files.set(path, bytes);
  }
  async signedUpload(path: string) {
    this.uploads.push(path);
    return { path, token: `upload-token-for-${path}` };
  }
  async signedRead(path: string, seconds: number) {
    return `/storage/v1/object/sign/${RECEIPTS_BUCKET}/${path}?token=read-${seconds}`;
  }
  async read(path: string) {
    return this.files.get(path) ?? null;
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
