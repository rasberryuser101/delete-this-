export type Role = 'HOST' | 'PLAYER' | 'DISPLAY';
export type GuestRole = Exclude<Role, 'HOST'>;
export type DeviceIdentity = { id: string; publicKey: string; sign: (text: string) => Promise<string> };
export function storedIdentity(role: GuestRole): string {
  const key = role === 'DISPLAY' ? 'delete-this-display-id' : 'delete-this-player-id';
  try {
    const old = localStorage.getItem(key);
    if (old && /^[\da-f-]{36}$/i.test(old)) return old;
    const id = crypto.randomUUID(); localStorage.setItem(key, id); return id;
  } catch { return crypto.randomUUID(); }
}
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const unhex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], s => parseInt(s, 16));
/** Keys remain in RAM. A reload requires host approval; a temporary reconnect does not. */
export async function makeIdentity(id: string): Promise<DeviceIdentity> {
  const keys = await crypto.subtle.generateKey({name:'ECDSA', namedCurve:'P-256'}, true, ['sign','verify']);
  return {id, publicKey:hex(await crypto.subtle.exportKey('raw', keys.publicKey)),
    sign: async text => hex(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'}, keys.privateKey, new TextEncoder().encode(text)))};
}
export async function verifyIdentity(key: string, signature: string, text: string): Promise<boolean> {
  if (!/^04[\da-f]{128}$/.test(key) || !/^[\da-f]{128}$/.test(signature)) return false;
  try { const publicKey = await crypto.subtle.importKey('raw', unhex(key), {name:'ECDSA',namedCurve:'P-256'}, false, ['verify']);
    return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'}, publicKey, unhex(signature), new TextEncoder().encode(text));
  } catch { return false; }
}
export const NAME_KEY = 'delete-this-name';
export function rememberedName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}
/**
 * Start values for the name field. A previously stored name may be prefilled for this
 * session, but "Name merken" ALWAYS starts unticked (no pre-ticked consent, EuGH C-673/17
 * Planet49); without an active tick, saveName removes the stored name on create/join.
 */
export function initialNameChoice(): { name: string; remember: false } {
  return { name: rememberedName(), remember: false };
}
/** The display name is only stored when the player opts in ("Name merken"). */
export function saveName(name: string, remember: boolean): void {
  try { if (remember && name.trim()) localStorage.setItem(NAME_KEY, name.trim().slice(0, 30)); else localStorage.removeItem(NAME_KEY); } catch { /* optional */ }
}
