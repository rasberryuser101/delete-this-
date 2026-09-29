import type { Game, PublicDisplayState } from './game';
import { capacity } from './game';
import { isReaction, type Reaction } from './party';
export type ControlMessage =
  | {type:'ready'} | {type:'display-sync';state:PublicDisplayState} | {type:'countdown';value:number}
  | {type:'sync';game:Game;you:string} | {type:'vote';photoId:string;roundId:string}
  | {type:'skip-prompt';roundId:string} | {type:'write-prompt'|'caption';text:string;roundId:string}
  | {type:'avatar';path:string} | {type:'reaction';emoji:Reaction;roundId:string} | {type:'error';message:string};
export type WireMessage=ControlMessage;
const str=(value:unknown,max=100)=>typeof value==='string'&&value.length>0&&value.length<=max;
const id=(value:unknown)=>str(value,100)&&/^[\w-]+$/.test(value as string);
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const avatar=(v:unknown)=>typeof v==='string'&&/^media\/art\/avatars\/[\w-]+\.(svg|png|webp|jpg|jpeg)$/.test(v)&&v.length<=120;
export function validateMessage(raw:unknown):WireMessage|null {
  if(!object(raw))return null;
  const fields:Record<string,string[]>={ready:['type'],countdown:['type','value'],sync:['type','game','you'],'display-sync':['type','state'],vote:['type','photoId','roundId'],'skip-prompt':['type','roundId'],'write-prompt':['type','text','roundId'],caption:['type','text','roundId'],avatar:['type','path'],reaction:['type','emoji','roundId'],error:['type','message']};
  if(typeof raw.type!=='string'||!fields[raw.type]||Object.keys(raw).some(k=>!fields[raw.type as string].includes(k)))return null;
  if(raw.type==='display-sync'&&object(raw.state)&&!('votes' in raw.state)){const {countdown,...game}=raw.state;if(Number.isInteger(countdown)&&(countdown as number)>=0&&(countdown as number)<=3&&validGame({...game,votes:{}})&&game.mode==='PARTY')return raw as ControlMessage;return null;}
  if(raw.type==='ready')return {type:'ready'};
  if(raw.type==='countdown'&&Number.isInteger(raw.value)&&(raw.value as number)>=0&&(raw.value as number)<=3)return raw as WireMessage;
  if(raw.type==='vote'&&id(raw.photoId)&&id(raw.roundId))return raw as WireMessage;
  if(raw.type==='skip-prompt'&&id(raw.roundId))return raw as WireMessage;
  if(['write-prompt','caption'].includes(raw.type)&&str(raw.text,250)&&id(raw.roundId))return raw as WireMessage;
  if(raw.type==='avatar'&&avatar(raw.path))return raw as WireMessage;
  if(raw.type==='reaction'&&isReaction(raw.emoji)&&id(raw.roundId))return raw as WireMessage;
  if(raw.type==='error'&&str(raw.message,200))return raw as WireMessage;
  if(raw.type==='sync'&&id(raw.you)&&validGame(raw.game))return raw as WireMessage;
  return null;
}
function validGame(value:unknown):value is Game {
  if(!object(value)||Object.keys(value).some(k=>!['phase','mode','style','mixStyles','roundStyle','winnerBonus','roundLimit','round','roundId','prompt','pack','players','photos','votes','winnerId','revealIndex','suggestions','assignments','skipVotes','promptSkips','roundPoints','roundSkipped'].includes(k))||!['lobby','write','prompt','submit','caption','reveal','vote','result'].includes(value.phase as string)||!['PARTY','REMOTE'].includes(value.mode as string)||!['CLASSIC','CUSTOM','REVERSE','MIX'].includes(value.style as string)||!['CLASSIC','CUSTOM','REVERSE'].includes(value.roundStyle as string)||typeof value.winnerBonus!=='boolean'||typeof value.roundSkipped!=='boolean'||![3,5,10].includes(value.roundLimit as number)||!Number.isInteger(value.round)||(value.round as number)>(value.roundLimit as number)||(value.round as number)<0||!Array.isArray(value.players)||value.players.length>41||!Array.isArray(value.photos)||value.photos.length>20||!object(value.votes)||Object.keys(value.votes).length>20||!str(value.prompt||'lobby',500)||(value.pack!==null&&(!object(value.pack)||Object.keys(value.pack).some(k=>!['id','title','icon'].includes(k))||!id(value.pack.id)||!str(value.pack.title,60)||!str(value.pack.icon,16)))||typeof value.roundId!=='string'||value.roundId.length>100||(value.winnerId!==null&&!id(value.winnerId)))return false;
  if(!Number.isInteger(value.revealIndex)||(value.revealIndex as number)<-1||(value.revealIndex as number)>=value.photos.length||!Number.isInteger(value.promptSkips)||(value.promptSkips as number)<0||(value.promptSkips as number)>3)return false;
  if(!Array.isArray(value.mixStyles)||!value.mixStyles.length||value.mixStyles.length>3||new Set(value.mixStyles).size!==value.mixStyles.length||!value.mixStyles.every(s=>['CLASSIC','CUSTOM','REVERSE'].includes(s)))return false;
  if(!Array.isArray(value.skipVotes)||value.skipVotes.length>20||!value.skipVotes.every(id)||new Set(value.skipVotes).size!==value.skipVotes.length)return false;
  const map=(v:unknown,test:(item:unknown)=>boolean)=>object(v)&&Object.keys(v).length<=20&&Object.entries(v).every(([k,item])=>id(k)&&test(item));
  if(!map(value.suggestions,v=>str(v,250))||!map(value.assignments,id)||!map(value.roundPoints,v=>Number.isInteger(v)&&(v as number)>=0&&(v as number)<=21))return false;
  if(value.players.filter(p=>object(p)&&!p.spectator&&!p.removed).length>capacity(value.mode as Game['mode']))return false;
  return value.players.every(p=>object(p)&&Object.keys(p).every(k=>['id','name','score','connected','avatar','spectator','removed'].includes(k))&&id(p.id)&&str(p.name,30)&&Number.isInteger(p.score)&&(p.score as number)>=0&&(p.score as number)<10000&&typeof p.connected==='boolean'&&(p.avatar===undefined||avatar(p.avatar))&&(p.spectator===undefined||typeof p.spectator==='boolean')&&(p.removed===undefined||typeof p.removed==='boolean')&&(!p.spectator||p.id==='host'))&&new Set(value.players.map(p=>(p as Record<string,unknown>).id)).size===value.players.length&&value.photos.every(p=>object(p)&&Object.keys(p).every(k=>['id','ownerId','caption','authorId'].includes(k))&&id(p.id)&&id(p.ownerId)&&(p.caption===undefined||str(p.caption,250))&&(p.authorId===undefined||id(p.authorId)))&&Object.entries(value.votes).every(([k,v])=>id(k)&&id(v));
}
export function decodeMessage(data:unknown):WireMessage|null {if(typeof data!=='string'||data.length>32000)return null;try{return validateMessage(JSON.parse(data));}catch{return null;}}
export function encodeMessage(message:ControlMessage):string {if(!validateMessage(message))throw new Error('Ungültige Steuernachricht.');return JSON.stringify(message);}
