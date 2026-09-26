import type { Game } from './game';
import { CATEGORIES } from './prompts';
export const CHUNK_SIZE = 16 * 1024;
export const MAX_WIRE_BYTES = 450_000;
export type WireMessage =
  | { type: 'hello'; name: string }
  | { type: 'sync'; game: Game; you: string }
  | { type: 'photo-begin'; id: string; roundId: string; bytes: number; mime: 'image/webp' | 'image/jpeg' }
  | { type: 'photo-end'; id: string }
  | { type: 'vote'; photoId: string; roundId: string }
  | { type: 'error'; message: string };
const str = (value: unknown, max = 100) => typeof value === 'string' && value.length > 0 && value.length <= max;
const id = (value: unknown) => str(value, 100) && /^[\w-]+$/.test(value as string);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validateMessage(raw: unknown): WireMessage | null {
  if (!object(raw)) return null;
  if (raw.type === 'hello' && str(raw.name, 24)) return raw as WireMessage;
  if (raw.type === 'vote' && id(raw.photoId) && id(raw.roundId)) return raw as WireMessage;
  if (raw.type === 'photo-begin' && id(raw.id) && id(raw.roundId) && Number.isInteger(raw.bytes) && (raw.bytes as number) > 0 && (raw.bytes as number) <= MAX_WIRE_BYTES && ['image/webp', 'image/jpeg'].includes(raw.mime as string)) return raw as WireMessage;
  if (raw.type === 'photo-end' && id(raw.id)) return raw as WireMessage;
  if (raw.type === 'error' && str(raw.message, 200)) return raw as WireMessage;
  if (raw.type === 'sync' && id(raw.you) && validGame(raw.game)) return raw as WireMessage;
  return null;
}
function validGame(value: unknown): value is Game {
  if (!object(value) || !['lobby','submit','vote','result'].includes(value.phase as string) || !['party','remote'].includes(value.mode as string) || !Number.isInteger(value.round) || (value.round as number) < 0 || !Array.isArray(value.players) || value.players.length > 8 || !Array.isArray(value.photos) || value.photos.length > 8 || !object(value.votes) || Object.keys(value.votes).length > 8 || !str(value.prompt || 'lobby', 500) || (value.category !== null && !CATEGORIES.includes(value.category as never)) || typeof value.roundId !== 'string' || value.roundId.length > 100 || (value.winnerId !== null && !id(value.winnerId))) return false;
  return value.players.every(p => object(p) && id(p.id) && str(p.name, 24) && Number.isInteger(p.score) && (p.score as number) >= 0 && (p.score as number) < 10000 && typeof p.connected === 'boolean') && value.photos.every(p => object(p) && id(p.id) && id(p.ownerId)) && Object.entries(value.votes).every(([key, v]) => id(key) && id(v));
}
export function decodeMessage(data: string): WireMessage | null {
  if (data.length > 32000) return null;
  try { return validateMessage(JSON.parse(data)); } catch { return null; }
}
export function sendMessage(channel: RTCDataChannel, message: WireMessage): void {
  if (channel.readyState === 'open') channel.send(JSON.stringify(message));
}
export async function sendImage(channel: RTCDataChannel, idValue: string, roundId: string, blob: Blob): Promise<void> {
  if (channel.readyState !== 'open' || blob.size > MAX_WIRE_BYTES) throw new Error('Bild zu groß oder Verbindung getrennt.');
  const mime = blob.type as 'image/webp' | 'image/jpeg';
  if (!['image/webp','image/jpeg'].includes(mime)) throw new Error('Bildformat ungültig.');
  sendMessage(channel, {type:'photo-begin', id:idValue, roundId, bytes:blob.size, mime});
  const bytes = new Uint8Array(await blob.arrayBuffer());
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    if (channel.readyState !== 'open') throw new Error('Verbindung getrennt.');
    while (channel.bufferedAmount > 128_000) {
      await new Promise<void>((resolve, reject) => { const timeout = setTimeout(() => { channel.removeEventListener('bufferedamountlow', ready); reject(new Error('Übertragung unterbrochen.')); }, 10000); const ready = () => { clearTimeout(timeout); resolve(); }; channel.bufferedAmountLowThreshold = 32_000; channel.addEventListener('bufferedamountlow', ready, {once: true}); });
    }
    channel.send(bytes.slice(i, i + CHUNK_SIZE));
  }
  sendMessage(channel, {type:'photo-end', id:idValue});
}
export class ImageReceiver {
  private incoming: { id: string; roundId: string; mime: string; bytes: number; chunks: Uint8Array[]; received: number } | null = null;
  begin(message: Extract<WireMessage,{type:'photo-begin'}>): boolean {
    if (this.incoming) return false;
    this.incoming = {...message, chunks: [], received: 0}; return true;
  }
  push(data: ArrayBuffer): boolean {
    const incoming = this.incoming;
    if (!incoming || data.byteLength === 0 || data.byteLength > CHUNK_SIZE || incoming.received + data.byteLength > incoming.bytes) { this.clear(); return false; }
    incoming.chunks.push(new Uint8Array(data)); incoming.received += data.byteLength; return true;
  }
  finish(message: Extract<WireMessage,{type:'photo-end'}>): {id:string; roundId:string; blob:Blob} | null {
    const current = this.incoming; this.clear();
    if (!current || current.id !== message.id || current.received !== current.bytes) return null;
    const bytes = new Uint8Array(current.received); let offset = 0;
    for (const chunk of current.chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const valid = current.mime === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff : String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
    return valid ? {id:current.id, roundId:current.roundId, blob:new Blob([bytes], {type:current.mime})} : null;
  }
  clear(): void { this.incoming = null; }
}
