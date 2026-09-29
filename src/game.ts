import { pickPrompt, type PackLabel } from './prompts';
export const ROUND_OPTIONS = [3, 5, 10] as const;
export type RoundLimit = typeof ROUND_OPTIONS[number];
export type Mode = 'PARTY' | 'REMOTE';
export type GameStyle = 'CLASSIC' | 'CUSTOM' | 'REVERSE' | 'MIX';
export type RoundStyle = Exclude<GameStyle, 'MIX'>;
export type Phase = 'lobby' | 'write' | 'prompt' | 'submit' | 'caption' | 'reveal' | 'vote' | 'result';
export interface Player { id: string; name: string; score: number; connected: boolean; avatar?: string; spectator?: boolean; removed?: boolean }
export interface Photo { id: string; ownerId: string; caption?: string; authorId?: string }
export interface Game {
  phase: Phase; mode: Mode; style: GameStyle; mixStyles: RoundStyle[]; roundStyle: RoundStyle; winnerBonus: boolean;
  roundLimit: RoundLimit; round: number; roundId: string; prompt: string; pack: PackLabel | null;
  players: Player[]; photos: Photo[]; votes: Record<string, string>; winnerId: string | null; revealIndex: number;
  suggestions: Record<string,string>; assignments: Record<string,string>; skipVotes: string[]; promptSkips: number;
  roundPoints: Record<string,number>; roundSkipped: boolean;
}
export const capacity = (mode:Mode) => mode === 'PARTY' ? 20 : 8;
export const activePlayers = (game:Game) => game.players.filter(p=>p.connected&&!p.spectator);
export const scoringOwner = (photo:Photo) => photo.authorId ?? photo.ownerId;
export const createGame = (hostName:string,mode:Mode,roundLimit:RoundLimit=5):Game => ({phase:'lobby',mode,style:'CLASSIC',mixStyles:['CLASSIC','CUSTOM','REVERSE'],roundStyle:'CLASSIC',winnerBonus:true,roundLimit,round:0,roundId:'',prompt:'',pack:null,players:[{id:'host',name:hostName,score:0,connected:true}],photos:[],votes:{},winnerId:null,revealIndex:-1,suggestions:{},assignments:{},skipVotes:[],promptSkips:0,roundPoints:{},roundSkipped:false});
export function joinPlayer(game:Game,player:Player):Game {
  if(game.players.length>=41||!['lobby','result'].includes(game.phase)||game.players.filter(p=>!p.spectator&&!p.removed).length>=capacity(game.mode)||game.players.some(p=>p.id===player.id))throw new Error(`Beitritt nur vor einer Runde mit maximal ${capacity(game.mode)} Spielern.`);
  return {...game,players:[...game.players,player]};
}
export function configureGame(game:Game,settings:Partial<Pick<Game,'style'|'mixStyles'|'winnerBonus'>>):Game {
  if(!['lobby','result'].includes(game.phase)||isMatchOver(game))throw new Error('Einstellungen nur zwischen den Runden ändern.');
  if(settings.mixStyles&&(!settings.mixStyles.length||settings.mixStyles.length>3||new Set(settings.mixStyles).size!==settings.mixStyles.length||settings.mixStyles.some(s=>!['CLASSIC','CUSTOM','REVERSE'].includes(s))))throw new Error('Wähle mindestens eine Variante für den Mix.');
  return {...game,...settings};
}
export function nextRound(game:Game,packs:string[],used:string[],random=Math.random):Game {
  if(!['lobby','result'].includes(game.phase)||activePlayers(game).length<2)throw new Error('Es braucht mindestens zwei verbundene Spieler.');
  if(game.round>=game.roundLimit)throw new Error('Die Partie ist beendet. Startet eine Revanche in der Lobby.');
  const roundStyle:RoundStyle=game.style==='MIX'?game.mixStyles[Math.min(game.mixStyles.length-1,Math.floor(random()*game.mixStyles.length))]:game.style;
  const selected=roundStyle==='CLASSIC'?pickPrompt(packs,used,random):null;
  return {...game,phase:roundStyle==='CUSTOM'?'write':'prompt',roundStyle,round:game.round+1,roundId:crypto.randomUUID(),prompt:selected?.text??(roundStyle==='REVERSE'?'Erst das Foto. Dann die frechste Bildunterschrift.':'Eure eigenen Prompts sind dran.'),pack:selected?.pack??{id:roundStyle.toLowerCase(),title:roundStyle==='REVERSE'?'Reverse':'Eigene Prompts',icon:roundStyle==='REVERSE'?'↔':'✎'},photos:[],votes:{},winnerId:null,revealIndex:-1,suggestions:{},assignments:{},skipVotes:[],promptSkips:0,roundPoints:{},roundSkipped:false};
}
export function openSubmissions(game:Game):Game {
  if(game.phase!=='prompt')throw new Error('Zuerst den Prompt lesen.');
  return {...game,phase:'submit'};
}
export function writePrompt(game:Game,id:string,text:string):Game {
  const clean=text.trim();
  if(game.phase!=='write'||!activePlayers(game).some(p=>p.id===id)||game.suggestions[id]||clean.length<5||clean.length>250)throw new Error('Schreibe einen Prompt mit 5–250 Zeichen.');
  return {...game,suggestions:{...game.suggestions,[id]:clean}};
}
export function chooseWrittenPrompt(game:Game,random=Math.random):Game {
  const texts=Object.values(game.suggestions);
  if(game.phase!=='write'||!texts.length)throw new Error('Es fehlt noch ein eigener Prompt.');
  return {...game,phase:'prompt',prompt:texts[Math.min(texts.length-1,Math.floor(random()*texts.length))]};
}
export function submitPhoto(game:Game,ownerId:string,photoId:string):Game {
  if(game.phase!=='submit'||!activePlayers(game).some(p=>p.id===ownerId)||game.photos.some(p=>p.ownerId===ownerId||p.id===photoId))throw new Error('Foto kann in dieser Runde nicht eingereicht werden.');
  return {...game,photos:[...game.photos,{id:photoId,ownerId}]};
}
export const allSubmitted = (game:Game) => activePlayers(game).every(p=>game.photos.some(photo=>photo.ownerId===p.id));
export function assignCaptions(game:Game,random=Math.random):Game {
  if(game.phase!=='submit'||game.roundStyle!=='REVERSE'||game.photos.length<2)throw new Error('Reverse braucht mindestens zwei Fotos.');
  const photos=shuffle(game.photos,random);
  const assignments=Object.fromEntries(photos.map((p,i)=>[p.ownerId,photos[(i+1)%photos.length].id]));
  return {...game,phase:'caption',photos,assignments};
}
export function writeCaption(game:Game,id:string,text:string):Game {
  const clean=text.trim(),photoId=game.assignments[id];
  if(game.phase!=='caption'||!activePlayers(game).some(p=>p.id===id)||!photoId||clean.length<3||clean.length>250||game.photos.some(p=>p.id===photoId&&p.caption))throw new Error('Schreibe eine Bildunterschrift mit 3–250 Zeichen.');
  return {...game,photos:game.photos.map(p=>p.id===photoId?{...p,caption:clean,authorId:id}:p)};
}
export const allCaptioned = (game:Game) => game.photos.every(p=>!!p.caption||!activePlayers(game).some(player=>game.assignments[player.id]===p.id));
function shuffle<T>(items:T[],random:()=>number):T[] {
  const result=[...items];for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;
}
export function reveal(game:Game,random=Math.random,force=false):Game {
  if(!['submit','caption'].includes(game.phase)||(!force&&(game.phase==='submit'?!allSubmitted(game):!allCaptioned(game))))throw new Error('Es fehlen noch Einreichungen.');
  const photos=game.roundStyle==='REVERSE'?game.photos.filter(p=>p.caption):game.photos;
  if(photos.length<2)throw new Error('Es braucht mindestens zwei Einreichungen.');
  return {...game,phase:'reveal',photos:shuffle(photos,random),revealIndex:-1};
}
export function nextReveal(game:Game):Game {
  if(game.phase!=='reveal')throw new Error('Gerade läuft keine Foto-Show.');
  return game.revealIndex+1<game.photos.length?{...game,revealIndex:game.revealIndex+1}:{...game,phase:'vote'};
}
export const visiblePhotos = (game:Game) => game.phase==='reveal'?game.photos.slice(0,game.revealIndex+1):game.phase==='vote'?game.photos:[];
export const photosFor = (game:Game,id:string) => game.phase==='caption'?game.photos.filter(p=>p.id===game.assignments[id]):visiblePhotos(game);
export function finishVoting(game:Game,random=Math.random):Game {
  if(game.phase!=='vote')throw new Error('Gerade läuft keine Abstimmung.');
  const counts=new Map(game.photos.map(p=>[p.id,0]));
  Object.values(game.votes).forEach(id=>{if(counts.has(id))counts.set(id,counts.get(id)!+1);});
  const max=Math.max(0,...counts.values()),tied=game.photos.filter(p=>counts.get(p.id)===max);
  const winnerId=max>0&&tied.length?scoringOwner(tied[Math.min(tied.length-1,Math.floor(random()*tied.length))]):null;
  const roundPoints:Record<string,number>={};
  for(const photo of game.photos){const id=scoringOwner(photo);roundPoints[id]=(roundPoints[id]??0)+(counts.get(photo.id)??0);}
  if(winnerId&&game.winnerBonus)roundPoints[winnerId]=(roundPoints[winnerId]??0)+1;
  return {...game,phase:'result',winnerId,roundPoints,players:game.players.map(p=>({...p,score:p.score+(roundPoints[p.id]??0)}))};
}
export const canVote = (game:Game,id:string) => activePlayers(game).some(p=>p.id===id)&&game.photos.some(p=>scoringOwner(p)!==id);
export function castVote(game:Game,voterId:string,photoId:string,random=Math.random):Game {
  const photo=game.photos.find(p=>p.id===photoId);
  if(game.phase!=='vote'||!canVote(game,voterId)||!photo||scoringOwner(photo)===voterId||game.votes[voterId])throw new Error('Diese Stimme ist ungültig.');
  const next={...game,votes:{...game.votes,[voterId]:photoId}};
  return activePlayers(next).filter(p=>canVote(next,p.id)).every(p=>next.votes[p.id])?finishVoting(next,random):next;
}
export function disconnectPlayer(game:Game,id:string,random=Math.random):Game {
  const players=game.phase==='lobby'?game.players.filter(p=>p.id!==id):game.players.map(p=>p.id===id?{...p,connected:false}:p);
  const next={...game,players,skipVotes:game.skipVotes.filter(v=>v!==id)};
  return next.phase==='vote'&&activePlayers(next).filter(p=>canVote(next,p.id)).every(p=>next.votes[p.id])?finishVoting(next,random):next;
}
export function skipRound(game:Game):Game {
  if(['lobby','result'].includes(game.phase))throw new Error('Keine laufende Runde.');
  return {...game,phase:'result',photos:[],votes:{},assignments:{},suggestions:{},skipVotes:[],winnerId:null,roundPoints:{},roundSkipped:true,revealIndex:-1};
}
export function voteToSkip(game:Game,id:string):Game {
  if(!['prompt','submit'].includes(game.phase)||game.roundStyle==='REVERSE'||game.promptSkips>=3||!activePlayers(game).some(p=>p.id===id))throw new Error('Dieser Prompt kann nicht übersprungen werden.');
  return game.skipVotes.includes(id)?game:{...game,skipVotes:[...game.skipVotes,id]};
}
export const skipMajority = (game:Game) => game.skipVotes.length>activePlayers(game).length/2;
export function replacePrompt(game:Game,packs:string[],used:string[],random=Math.random):Game {
  if(!skipMajority(game)||game.promptSkips>=3)throw new Error('Noch keine Mehrheit.');
  const texts=Object.values(game.suggestions).filter(t=>t!==game.prompt);
  const fresh=texts.filter(t=>!used.includes(t)),choices=fresh.length?fresh:texts;
  const selected=game.roundStyle==='CUSTOM'?{text:choices.length?choices[Math.min(choices.length-1,Math.floor(random()*choices.length))]:game.prompt,pack:game.pack}:pickPrompt(packs,used,random);
  return {...game,phase:'prompt',roundId:crypto.randomUUID(),prompt:selected.text,pack:selected.pack,photos:[],votes:{},assignments:{},skipVotes:[],promptSkips:game.promptSkips+1,revealIndex:-1};
}
export function viewFor(game:Game,viewerId:string):Game {
  const visible=new Set(visiblePhotos(game).map(p=>p.id));
  return {...game,suggestions:game.suggestions[viewerId]?{[viewerId]:game.suggestions[viewerId]}:{},assignments:game.assignments[viewerId]?{[viewerId]:game.assignments[viewerId]}:{},photos:game.photos.map(photo=>({...photo,ownerId:photo.ownerId===viewerId?viewerId:'hidden',...(photo.authorId?{authorId:photo.authorId===viewerId?viewerId:'hidden'}:{}),...(!visible.has(photo.id)&&game.phase!=='result'&&game.assignments[viewerId]!==photo.id?{caption:undefined}:{})})),votes:Object.fromEntries(Object.keys(game.votes).map(id=>[id,'cast']))};
}
export type PublicDisplayState = Omit<Game,'votes'> & {countdown:number};
export function displayView(game:Game,countdown=0):PublicDisplayState {
  const {votes:_,...state}=viewFor(game,'display');void _;
  return {...state,countdown,suggestions:{},assignments:{},revealIndex:visiblePhotos(game).length?game.revealIndex:-1,photos:visiblePhotos(game).map(p=>({...p,ownerId:'hidden',...(p.authorId?{authorId:'hidden'}:{})}))};
}
export const isMatchOver=(game:Game)=>game.phase==='result'&&game.round>=game.roundLimit;
export function leaderboard(game:Game){const players=game.players.filter(p=>!p.spectator).sort((a,b)=>b.score-a.score);return players.map(player=>({...player,rank:players.findIndex(p=>p.score===player.score)+1}));}
export function setRoundLimit(game:Game,limit:RoundLimit):Game {if(game.phase!=='lobby'||game.round!==0||!ROUND_OPTIONS.includes(limit))throw new Error('Rundenzahl nur vor der Partie ändern.');return {...game,roundLimit:limit};}
export function rematch(game:Game):Game {if(!isMatchOver(game))throw new Error('Die Partie läuft noch.');return {...createGame(game.players[0].name,game.mode,game.roundLimit),style:game.style,mixStyles:game.mixStyles,winnerBonus:game.winnerBonus,players:game.players.filter(p=>!p.removed).map(p=>({...p,score:0}))};}
