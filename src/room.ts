import type { PeerOptions } from 'peerjs';
export const CONNECTION_ERROR = 'Direkte Verbindung konnte in diesem Netzwerk leider nicht hergestellt werden.';
export const SIGNALING_ERROR = 'Der Lobby-Dienst ist gerade nicht erreichbar. Bitte später erneut versuchen.';
export const DEFAULT_STUN = 'stun:stun.l.google.com:19302';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeRoomCode(randomBytes: Uint8Array = crypto.getRandomValues(new Uint8Array(6))): string {
  if (randomBytes.length !== 6) throw new Error('Sechs Zufallsbytes erwartet.');
  return Array.from(randomBytes, byte => ALPHABET[byte % ALPHABET.length]).join('');
}
export function normalizeRoomCode(input: string): string {
  const value = input.trim();
  let code = value;
  if (value.startsWith('https://') || value.startsWith('http://')) {
    try { const url = new URL(value); code = new URLSearchParams(url.hash.split('?')[1] ?? '').get('code') ?? value; }
    catch { throw new Error('Der Einladungslink ist ungültig.'); }
  }
  code = code.toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new Error('Bitte einen gültigen sechsstelligen Lobbycode eingeben.');
  return code;
}
export const peerIdFor = (code: string): string => `delete-this-${normalizeRoomCode(code)}`;
export function peerOptions(stun = DEFAULT_STUN): PeerOptions {
  if (!/^stuns?:[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(stun)) throw new Error('STUN-Adresse ungültig.');
  return {host:'0.peerjs.com', port:443, secure:true, path:'/', debug:0, config:{iceServers:[{urls:stun}],iceTransportPolicy:'all'}};
}
export function roomLink(code: string, location: Pick<Location,'origin'|'pathname'>): string {
  return `${location.origin}${location.pathname}#/spiel?code=${normalizeRoomCode(code)}`;
}
