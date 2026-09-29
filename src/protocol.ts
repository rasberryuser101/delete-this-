import type { Game, PublicDisplayState } from './game';
import { isReaction, type Reaction } from './party';
export type ControlMessage =
  | { type: 'ready' }
  | { type: 'display-sync'; state: PublicDisplayState }
  | { type: 'countdown'; value: number }
  | { type: 'sync'; game: Game; you: string }
  | { type: 'vote'; photoId: string; roundId: string }
  | { type: 'reaction'; emoji: Reaction; roundId: string }
  | { type: 'error'; message: string };
export type WireMessage = ControlMessage;
const str = (value: unknown, max = 100) => typeof value === 'string' && value.length > 0 && value.length <= max;
const id = (value: unknown) => str(value, 100) && /^[\w-]+$/.test(value as string);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validateMessage(raw: unknown): WireMessage | null {
  if (!object(raw)) return null;
  const fields:Record<string,string[]>={ready:['type'],countdown:['type','value'],sync:['type','game','you'],'display-sync':['type','state'],vote:['type','photoId','roundId'],reaction:['type','emoji','roundId'],error:['type','message']};
  if(typeof raw.type!=='string'||!fields[raw.type]||Object.keys(raw).some(k=>!fields[raw.type as string].includes(k)))return null;
  if(raw.type==='display-sync'&&object(raw.state)&&!('votes' in raw.state)){const {countdown,...game}=raw.state;if(Number.isInteger(countdown)&&(countdown as number)>=0&&(countdown as number)<=3&&validGame({...game,votes:{}})&&game.mode==='PARTY')return raw as ControlMessage;return null;}
  if (raw.type === 'ready') return {type:'ready'};
  if (raw.type === 'countdown' && Number.isInteger(raw.value) && (raw.value as number)>=0 && (raw.value as number)<=3) return raw as WireMessage;
  if (raw.type === 'vote' && id(raw.photoId) && id(raw.roundId)) return raw as WireMessage;
  if (raw.type === 'reaction' && isReaction(raw.emoji) && id(raw.roundId)) return {type:'reaction',emoji:raw.emoji,roundId:raw.roundId as string};
  if (raw.type === 'error' && str(raw.message, 200)) return raw as WireMessage;
  if (raw.type === 'sync' && id(raw.you) && validGame(raw.game)) return raw as WireMessage;
  return null;
}
function validGame(value: unknown): value is Game {
  if (!object(value) || Object.keys(value).some(k=>!['phase','mode','roundLimit','round','roundId','prompt','pack','players','photos','votes','winnerId','revealIndex'].includes(k)) || !['lobby','submit','reveal','vote','result'].includes(value.phase as string) || !['PARTY','REMOTE'].includes(value.mode as string) || ![3,5,10].includes(value.roundLimit as number) || !Number.isInteger(value.round) || (value.round as number)>(value.roundLimit as number) || (value.round as number) < 0 || !Array.isArray(value.players) || value.players.length > 10 || !Array.isArray(value.photos) || value.photos.length > 10 || !object(value.votes) || Object.keys(value.votes).length > 10 || !str(value.prompt || 'lobby', 500) || (value.pack !== null && (!object(value.pack) || Object.keys(value.pack).some(k=>!['id','title','icon'].includes(k)) || !id(value.pack.id) || !str(value.pack.title,60) || !str(value.pack.icon,16))) || typeof value.roundId !== 'string' || value.roundId.length > 100 || (value.winnerId !== null && !id(value.winnerId))) return false;
  if(!Number.isInteger(value.revealIndex)||(value.revealIndex as number)<-1||(value.revealIndex as number)>=value.photos.length) return false;
  return value.players.every(p => object(p) && Object.keys(p).every(k=>['id','name','score','connected'].includes(k)) && id(p.id) && str(p.name, 30) && Number.isInteger(p.score) && (p.score as number) >= 0 && (p.score as number) < 10000 && typeof p.connected === 'boolean') && value.photos.every(p => object(p) && Object.keys(p).every(k=>['id','ownerId'].includes(k)) && id(p.id) && id(p.ownerId)) && Object.entries(value.votes).every(([key, v]) => id(key) && id(v));
}
export function decodeMessage(data: unknown): WireMessage | null {
  if (typeof data !== 'string' || data.length > 32000) return null;
  try { return validateMessage(JSON.parse(data)); } catch { return null; }
}
export function encodeMessage(message:ControlMessage):string {if(!validateMessage(message))throw new Error('Ungültige Steuernachricht.');return JSON.stringify(message);}
