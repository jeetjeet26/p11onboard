// Signed, short-lived state tokens used to protect the Dropbox OAuth redirect.
// We sign a small JSON payload with HMAC-SHA256 so the callback can verify the
// originating user id and prevent CSRF without storing server-side state.

import { getEnv } from "./auth.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function getStateSecret(): string {
  return getEnv("DROPBOX_OAUTH_STATE_SECRET");
}

export interface StatePayload {
  userId: string;
  issuedAt: number;
  returnTo?: string;
  nonce: string;
}

export async function signState(payload: StatePayload): Promise<string> {
  const key = await getHmacKey(getStateSecret());
  const encoded = base64UrlEncode(textEncoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(encoded));
  const sig = base64UrlEncode(new Uint8Array(signature));
  return `${encoded}.${sig}`;
}

export async function verifyState(token: string, maxAgeSeconds = 900): Promise<StatePayload> {
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) {
    throw new Error("Malformed state token");
  }
  const key = await getHmacKey(getStateSecret());
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlDecode(sig),
    textEncoder.encode(encoded)
  );
  if (!ok) {
    throw new Error("Invalid state signature");
  }
  const payloadJson = textDecoder.decode(base64UrlDecode(encoded));
  const payload = JSON.parse(payloadJson) as StatePayload;
  if (typeof payload.issuedAt !== "number") {
    throw new Error("State missing issuedAt");
  }
  const ageSeconds = (Date.now() - payload.issuedAt) / 1000;
  if (ageSeconds > maxAgeSeconds) {
    throw new Error("State token expired");
  }
  return payload;
}

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}
