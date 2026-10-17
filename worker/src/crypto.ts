export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** The hexadecimal SHA-256 of a secret, as stored in D1 (section 6.3). */
export async function sha256Hex(text: string): Promise<string> {
  return [...(await sha256(text))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 32 random bytes as 43 base64url characters. */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

/** Section 6.3: AES-GCM with a random 12-byte IV, stored as `v1:` and the base64 of IV and ciphertext. */
export async function encryptSecret(plain: string, base64Key: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0)), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  return `v1:${toBase64(new Uint8Array([...iv, ...cipher]))}`;
}
