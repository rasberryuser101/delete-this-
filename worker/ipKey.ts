/**
 * Pseudonymous IP key for the persistent RateGate counters.
 * HMAC-SHA-256 (Web Crypto) with the dedicated Worker secret IP_HASH_SALT.
 * No Workers-only globals here, so vitest can import it directly.
 */
export const IP_SALT_MISSING_MESSAGE = 'Der Lobby-Dienst ist noch nicht vollständig eingerichtet. Bitte später erneut versuchen oder den Betreiber informieren.';
export type IpKeyEnv = { IP_HASH_SALT?: string };
const keys = new Map<string, Promise<CryptoKey>>();
const hmacKey = (salt: string) => {
  let key = keys.get(salt);
  if (!key) { key = crypto.subtle.importKey('raw', new TextEncoder().encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); keys.clear(); keys.set(salt, key); }
  return key;
};
/** Fail closed: without a secret there is no IP key (never a fixed fallback salt). */
export function ipSalt(env: IpKeyEnv): string | null {
  return env.IP_HASH_SALT?.trim() ? env.IP_HASH_SALT : null;
}
/** Hex HMAC-SHA-256 of the IP; null if IP_HASH_SALT is missing or empty. */
export async function ipKey(env: IpKeyEnv, ip: string): Promise<string | null> {
  const salt = ipSalt(env);
  if (!salt) return null;
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(salt), new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(mac), b => b.toString(16).padStart(2, '0')).join('');
}
