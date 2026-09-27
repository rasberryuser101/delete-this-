import type { Game } from './game';
import { CATEGORIES } from './prompts';
import { isReaction, type Reaction } from './party';
export type WireMessage =
  | { type: 'ready' }
  | { type: 'countdown'; value: number }
  | { type: 'sync'; game: Game; you: string }
  | { type: 'vote'; photoId: string; roundId: string }
  | { type: 'reaction'; emoji: Reaction; roundId: string }
  | { type: 'error'; message: string };
const str = (value: unknown, max = 100) => typeof value === 'string' && value.length > 0 && value.length <= max;
const id = (value: unknown) => str(value, 100) && /^[\w-]+$/.test(value as string);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validateMessage(raw: unknown): WireMessage | null {
  if (!object(raw)) return null;
  if (raw.type === 'ready') return {type:'ready'};
  if (raw.type === 'countdown' && Number.isInteger(raw.value) && (raw.value as number)>=0 && (raw.value as number)<=3) return raw as WireMessage;
  if (raw.type === 'vote' && id(raw.photoId) && id(raw.roundId)) return raw as WireMessage;
  if (raw.type === 'reaction' && isReaction(raw.emoji) && id(raw.roundId)) return {type:'reaction',emoji:raw.emoji,roundId:raw.roundId as string};
  if (raw.type === 'error' && str(raw.message, 200)) return raw as WireMessage;
  if (raw.type === 'sync' && id(raw.you) && validGame(raw.game)) return raw as WireMessage;
  return null;
}
function validGame(value: unknown): value is Game {
  if (!object(value) || !['lobby','submit','reveal','vote','result'].includes(value.phase as string) || !['party','remote'].includes(value.mode as string) || !Number.isInteger(value.round) || (value.round as number) < 0 || !Array.isArray(value.players) || value.players.length > 8 || !Array.isArray(value.photos) || value.photos.length > 8 || !object(value.votes) || Object.keys(value.votes).length > 8 || !str(value.prompt || 'lobby', 500) || (value.category !== null && !CATEGORIES.includes(value.category as never)) || typeof value.roundId !== 'string' || value.roundId.length > 100 || (value.winnerId !== null && !id(value.winnerId))) return false;
  if(!Number.isInteger(value.revealIndex)||(value.revealIndex as number)<-1||(value.revealIndex as number)>=value.photos.length) return false;
  return value.players.every(p => object(p) && id(p.id) && str(p.name, 24) && Number.isInteger(p.score) && (p.score as number) >= 0 && (p.score as number) < 10000 && typeof p.connected === 'boolean') && value.photos.every(p => object(p) && id(p.id) && id(p.ownerId)) && Object.entries(value.votes).every(([key, v]) => id(key) && id(v));
}
export function decodeMessage(data: unknown): WireMessage | null {
  if (typeof data !== 'string' || data.length > 32000) return null;
  try { return validateMessage(JSON.parse(data)); } catch { return null; }
}
export const encodeMessage = (message: WireMessage): string => JSON.stringify(message);
