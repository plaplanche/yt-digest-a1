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

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function aesKey(base64Key: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", unb64(base64Key), "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-GCM with a random 12-byte IV, stored as `v1:` and the base64 of IV and ciphertext (section 6.3). */
export async function encryptSecret(plain: string, base64Key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(base64Key), new TextEncoder().encode(plain)));
  return `v1:${b64(new Uint8Array([...iv, ...data]))}`;
}

export async function decryptSecret(stored: string, base64Key: string): Promise<string> {
  const raw = unb64(stored.slice(3));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await aesKey(base64Key), raw.slice(12));
  return new TextDecoder().decode(plain);
}
