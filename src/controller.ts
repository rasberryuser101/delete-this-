import { AdmissionGate, APPROVAL_MS, peerCheck, type JoinRequest } from './admission';
import { activePlayers, allCaptioned, assignCaptions, capacity, chooseWrittenPrompt, configureGame, finishVoting, openSubmissions, photosFor, replacePrompt, skipMajority, skipRound, voteToSkip, writeCaption, writePrompt, isMatchOver, setRoundLimit, rematch, type GameOptions, type RoundLimit, allSubmitted, castVote, createGame, disconnectPlayer, joinPlayer, nextRound, nextReveal, reveal, submitPhoto, displayView, viewFor, type Game, type Mode } from './game';
import { processImage } from './image';
import { PhotoStore } from './photoStore';
import { decodeMessage, encodeMessage, type WireMessage } from './protocol';
import { CONNECTION_ERROR, JOIN_TIMEOUT_MS, NETWORK_ERROR, createLobbySession, makeRoomCode, normalizeRoomCode, type LobbySession, type LobbyOptions } from './room';
import { parsePhotoMetadata, receivePhoto, transferPhoto, withDeadline, type PhotoMetadata } from './transfer';
import { play, type Sound } from './sound';
import { AVATARS, CUSTOM } from './customization';
import { isReaction, reactionAllowed, REACTION_SOUNDS, type Reaction } from './party';

type Stage = 'idle'|'search'|'approval'|'connecting'|'connected'|'error';
export type PlayState = {game:Game|null; role:'HOST'|'PLAYER'|'DISPLAY'|null; you:string; roomCode:string; hostKey:string; busy:boolean; status:string; error:string; countdown:number; progress:number; images:Record<string,string>; requests:JoinRequest[]; displays:{id:string;name:string;connected:boolean}[]; stage:Stage; diagnostic:string; check:string; online:boolean; reaction:{id:string;emoji:Reaction}|null; autoReveal:boolean};
const initial = (): PlayState => ({game:null,role:null,you:'host',roomCode:'',hostKey:'',busy:false,status:'',error:'',countdown:0,progress:0,images:{},requests:[],displays:[],stage:'idle',diagnostic:'',check:'',online:true,reaction:null,autoReveal:true});
const message = (e:unknown) => e instanceof Error ? e.message : 'Das hat leider nicht geklappt.';
type Dependencies = {session:(options:LobbyOptions)=>LobbySession|Promise<LobbySession>; process:typeof processImage; receive:typeof receivePhoto; sound:(s:Sound)=>void};

/** Authoritative state independent of React renders; all asynchronous work is session-bound. */
export class GameController {
  private state = initial();
  private listeners = new Set<()=>void>();
  private session:LobbySession|null = null;
  private displays=new Map<string,{name:string;connected:boolean}>();
  private lastJoin:{name:string;code:string;role:'PLAYER'|'DISPLAY';hostKey?:string}|null=null;
  private lastHost:{name:string;mode:Mode;displayOnly:boolean;avatar?:string}|null=null;
  private selectedPacks:string[]=[];
  private promptTimer:ReturnType<typeof setTimeout>|undefined;
  private avatar='';
  private host = '';
  private allowed = new Map<string,string>();
  private gate = new AdmissionGate(requests => this.patch({requests}));
  private photos = new PhotoStore();
  private used:string[] = [];
  private lifetime = new AbortController();
  private round = new AbortController();
  private epoch = 0;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private poll:ReturnType<typeof setInterval>|undefined;
  private countdownTimer:ReturnType<typeof setTimeout>|undefined;
  private cancelJoin:(()=>void)|undefined;
  private receiving = new Set<string>();
  private distributing = new Map<string,Promise<boolean>>();
  private delivered = new Map<string,Set<string>>();
  private reactionTimes = new Map<string,number>();
  private lastReactionAt = -Infinity;
  private revealTimer:ReturnType<typeof setTimeout>|undefined;
  private reactionTimer:ReturnType<typeof setTimeout>|undefined;
  private deps:Dependencies;
  constructor(deps:Partial<Dependencies>={}) { this.deps={session:createLobbySession,process:processImage,receive:receivePhoto,sound:play,...deps}; }
  subscribe = (fn:()=>void) => {this.listeners.add(fn); return ()=>{this.listeners.delete(fn);};};
  snapshot = () => this.state;
  private patch(values:Partial<PlayState>) {this.state={...this.state,...values}; this.listeners.forEach(fn=>fn());}
  setStatus = (status:string) => this.patch({status});
  clearError = () => this.patch({error:''});
  fail = (e:unknown) => {this.patch({error:message(e),status:'',busy:false});this.deps.sound('error');};
  private checkName(name:string) { if(!name.trim()) throw new Error('Bitte zuerst einen Namen eingeben.'); return name.trim().slice(0,30); }
  private clearPhotos() {clearTimeout(this.promptTimer);clearTimeout(this.revealTimer);this.round.abort(); this.round=new AbortController(); this.photos.clear();this.session?.clearTransfers?.();this.receiving.clear();this.distributing.clear();this.delivered.clear();this.reactionTimes.clear();this.lastReactionAt=-Infinity;clearTimeout(this.reactionTimer);this.patch({images:{},progress:0,reaction:null,busy:false});}
  private put(id:string,blob:Blob) {this.photos.put(id,blob);this.patch({images:this.photos.urls()});}
  leave = () => {
    this.epoch++; this.lifetime.abort();this.lifetime=new AbortController();
    this.cancelJoin?.();this.cancelJoin=undefined;clearTimeout(this.timer);clearTimeout(this.countdownTimer);clearInterval(this.poll);
    this.gate.clear();this.allowed.clear();this.used=[];this.host='';this.displays.clear();
    const session=this.session;this.session=null; if(session) void session.room.leave().catch(()=>{});
    this.clearPhotos();this.state=initial();this.listeners.forEach(fn=>fn());
  };
  private updateDisplays(){this.patch({displays:[...this.displays].map(([id,d])=>({id,...d}))});}
  private async send(id:string,msg:WireMessage) {
    const session=this.session; if(!session) throw new Error('Verbindung beendet.');
    return withDeadline(signal=>session.control.request(encodeMessage(msg),{target:id,signal,timeoutMs:5_000}),7_000,this.lifetime.signal);
  }
  private async sync(id:string) {
    const game=this.state.game;if(!game || !this.allowed.has(id)) return;
    if(this.displays.has(id))await this.send(id,{type:'display-sync',state:displayView(game,this.state.countdown)});
    else {await this.send(id,{type:'sync',game:viewFor(game,id),you:id});if(this.state.countdown)await this.send(id,{type:'countdown',value:this.state.countdown});}
  }
  private publish(game:Game) {
    const previous=this.state.game;
    if(game.roundId!==previous?.roundId || game.phase==='result') this.clearPhotos();
    if(!game.reactionsEnabled){clearTimeout(this.reactionTimer);this.patch({reaction:null});}
    this.patch({game,countdown:0,...(game.phase==='lobby'||game.roundId!==previous?.roundId?{autoReveal:game.autoReveal}:{})});
    for(const player of game.players) if(player.id!=='host'&&player.connected) void this.sync(player.id).catch(()=>{});
    for(const [id,d] of this.displays)if(d.connected)void this.sync(id).catch(()=>{});
    if(game.phase==='result'&&previous?.phase!=='result') this.deps.sound(isMatchOver(game)?'gameover':'winner');
  }
  create = async (name:string, mode:Mode,displayOnly=false,avatar?:string) => {
    let epoch=this.epoch;
    try {
      const clean=this.checkName(displayOnly&&!name.trim()?'Bildschirm':name); this.leave();epoch=this.epoch;
      this.lastHost={name:clean,mode,displayOnly,avatar};this.lastJoin=null;
      const game=createGame(clean,mode);game.players[0]={...game.players[0],spectator:displayOnly&&mode==='PARTY',...(avatar&&AVATARS.includes(avatar)?{avatar}:{})};
      const code=makeRoomCode();this.patch({game,role:'HOST',roomCode:code,busy:true,status:'Sichere Lobby wird geöffnet …',stage:'connected'});
      const session=await this.deps.session({code,role:'HOST',signal:this.lifetime.signal,onStatus:status=>{if(epoch===this.epoch)this.patch({status,...(status.includes('fehlgeschlagen')?{online:false}:status==='Verbunden'||status==='Wieder verbunden'?{online:true}:{})});},canPhoto:(...args)=>this.canPhoto(...args),authorize:async(id,remote)=>{
        if(epoch!==this.epoch)throw new Error('Lobby beendet.');

        const game=this.state.game;
        if(remote.role==='DISPLAY'&&game?.mode!=='PARTY')throw new Error('Displays nur mit gemeinsamem Bildschirm.');
        const existing=game?.players.some(p=>p.id===id)||this.displays.has(id);
        if(epoch!==this.epoch||(!existing&&remote.role!=='DISPLAY'&&(!['lobby','result'].includes(game?.phase??'')||this.state.countdown))||(remote.role==='DISPLAY'?this.displays.size>=3&&!existing:!!game&&(game.players.filter(p=>!p.spectator&&!p.removed).length>=capacity(game.mode)||this.allowed.size-this.displays.size>=capacity(game.mode)-(game.players[0].spectator?0:1))&&!existing))throw new Error('Lobby geschlossen oder voll.');
        await this.gate.request(id,remote.name!,remote.role==='DISPLAY'?'DISPLAY':'PLAYER',remote.check);
        const current=this.state.game;
        if(epoch!==this.epoch||!current||(!existing&&remote.role==='PLAYER'&&(!['lobby','result'].includes(current.phase)||this.state.countdown||current.players.filter(p=>!p.spectator&&!p.removed).length>=capacity(current.mode)||this.allowed.size-this.displays.size>=capacity(current.mode)-(current.players[0].spectator?0:1))))throw new Error('Lobby geschlossen oder voll.');
        if(remote.role==='DISPLAY'){if(this.displays.size>=3&&!existing)throw new Error('Zu viele Displays.');this.displays.set(id,{name:remote.name!,connected:false});}
        this.allowed.set(id,remote.name!);
      },onJoinError:(id)=>{if(epoch!==this.epoch)return;this.gate.decide(id,false,'Verbindungsversuch beendet.');if(!this.state.game?.players.some(p=>p.id===id)) this.allowed.delete(id);}});
      if(epoch!==this.epoch){void session.room.leave().catch(()=>{});return;}
      this.session=session;this.patch({hostKey:session.publicKey??''});this.attach(session,epoch);
      session.room.onPeerJoin=id=>{
        if(epoch!==this.epoch) return;
        const name=this.allowed.get(id), game=this.state.game;if(!name||!game)return;
        const display=this.displays.get(id);if(display){display.connected=true;this.updateDisplays();this.delivered.delete(id);void this.sync(id).then(()=>this.distribute(id)).catch(()=>{});this.patch({status:`${name} ist als Display dabei!`});return;}
        this.delivered.delete(id);
        const existing=game.players.find(p=>p.id===id);
        if(existing) {this.publish({...game,players:game.players.map(p=>p.id===id?{...p,connected:true}:p)});void this.sync(id).then(()=>this.distribute(id)).catch(()=>{});}
        else {try{this.publish(joinPlayer(game,{id,name,score:0,connected:true}));}catch{return;}}
        this.deps.sound('connected');this.patch({status:`${name} ist dabei!`});
      };
      this.patch({busy:false,status:'Lobby offen. Gäste müssen von dir freigegeben werden.'});this.startPolling(epoch);
    } catch(e) {if(epoch===this.epoch){this.leave();this.fail(e);}}
  };
  approve = (id:string,yes:boolean) => this.gate.decide(id,yes);
  join = async (name:string,input:string,guestRole:'PLAYER'|'DISPLAY'='PLAYER',expectedHostKey?:string,avatar?:string) => {
    let epoch=this.epoch;
    try {
      const clean=this.checkName(name), code=normalizeRoomCode(input);if(/^https?:\/\//.test(input.trim()))expectedHostKey=new URLSearchParams(new URL(input.trim()).hash.split('?')[1]??'').get('host')??expectedHostKey;this.leave();epoch=this.epoch;
      this.lastJoin={name:clean,code,role:guestRole,hostKey:expectedHostKey};if(avatar&&AVATARS.includes(avatar))this.avatar=avatar;
      this.lastHost=null;
      this.patch({role:guestRole,roomCode:code,busy:true,stage:'search',status:'Suche Lobby …'});
      let rejectJoin!:(e:Error)=>void, resolveJoin!:()=>void;
      const joined=new Promise<void>((resolve,reject)=>{resolveJoin=resolve;rejectJoin=reject;});
      void joined.catch(()=>{}); // also handled when session creation throws synchronously
      const arm=(ms:number,text:()=>string)=>{clearTimeout(this.timer);this.timer=setTimeout(()=>rejectJoin(new Error(text())),ms);};
      this.cancelJoin=()=>rejectJoin(new Error('Beitritt abgebrochen.'));
      let transportFailed=false;
      const session=await this.deps.session({code,role:guestRole,name:clean,signal:this.lifetime.signal,expectedHostKey,onStatus:status=>{if(epoch===this.epoch)this.patch({status,...(status.includes('fehlgeschlagen')?{online:false}:status==='Verbunden'||status==='Wieder verbunden'?{online:true}:{})});},canPhoto:(...args)=>this.canPhoto(...args),
        authorize:(id,remote)=>{if(remote.publicKey)this.patch({hostKey:remote.publicKey});if(this.host&&this.host!==id)throw new Error('Anderer Host.');this.host=id;},
        onStage:(stage)=>{if(epoch!==this.epoch||this.state.stage==='connected')return;if(stage==='connecting'){this.patch({stage:'connecting',status:'Freigegeben. Verbinde …'});arm(JOIN_TIMEOUT_MS,()=>this.session?.connectionError?.()??NETWORK_ERROR);return;}this.patch({stage:'approval',status:'Anfrage angekommen. Der Host muss dich freigeben.'});arm(APPROVAL_MS+10_000,()=> 'Keine Freigabe erhalten. Bitte den Host fragen und erneut beitreten.');},
        onJoinError:(id,error)=>{if(epoch!==this.epoch)return;transportFailed=true;if(this.state.stage==='connected'){if(error.includes('abgelehnt')){this.leave();this.fail(new Error('Du wurdest aus der Lobby entfernt.'));}else this.patch({online:false,busy:false,status:'Verbindung unterbrochen. Erneut verbinden …'});return;}if(id===this.host)rejectJoin(new Error(error.includes('abgelehnt')?error:NETWORK_ERROR));}
      });
      if(epoch!==this.epoch){void session.room.leave().catch(()=>{});return;}
      this.session=session;this.patch({check:session.publicKey?session.publicKey.slice(-12).toUpperCase():peerCheck(session.selfId)});this.attach(session,epoch);
      session.room.onPeerJoin=id=>{if(epoch!==this.epoch||id!==this.host)return;if(this.state.stage==='connected'){this.patch({online:true,status:'Wieder verbunden'});void this.send(this.host,{type:'ready'}).catch(()=>{});}else resolveJoin();};
      arm(JOIN_TIMEOUT_MS,()=>transportFailed?NETWORK_ERROR:session.relayCount()===0?'Kein Lobby-Dienst erreichbar. Internet, VPN oder Inhaltsblocker prüfen.':CONNECTION_ERROR);
      this.startPolling(epoch);
      try {await joined;} finally {clearTimeout(this.timer);this.cancelJoin=undefined;}
      if(epoch!==this.epoch)return;
      this.patch({busy:false,stage:'connected',online:true,status:'Freigegeben! Spielstand wird geladen …'});
      for(let attempt=0;attempt<3;attempt++) {
        if(epoch!==this.epoch)return;
        try { await this.send(this.host,{type:'ready'}); break; }
        catch { if(attempt===2 && !this.state.game)throw new Error('Spielstand konnte nicht geladen werden. Bitte erneut beitreten.'); this.patch({status:'Spielstand wird erneut angefordert …'}); }
      }
      if(this.state.game)this.patch({online:true,status:''});if(guestRole==='PLAYER'&&this.avatar)await this.chooseAvatar(this.avatar);this.deps.sound('connected');
    } catch(e) {if(epoch!==this.epoch)return;const diagnostic=this.state.diagnostic;this.leave();this.patch({stage:'error',diagnostic});this.fail(e);}
  };
  private attach(session:LobbySession,epoch:number) {
    session.control.onRequest=async(data,{peerId})=>{if(epoch!==this.epoch)throw new Error('Sitzung beendet.');await this.control(data,peerId);return {ok:true};};
    session.photo.onRequest=(data,{peerId,metadata,signal})=>this.acceptPhoto(data,peerId,metadata,epoch,signal);
    session.room.onPeerLeave=id=>{
      if(epoch!==this.epoch)return;
      if(this.state.role==='HOST') {
        this.gate.decide(id,false,'Gerät hat die Verbindung verloren.');
        this.delivered.delete(id);this.distributing.delete(id);
        const display=this.displays.get(id);if(display){display.connected=false;this.updateDisplays();return;}
        const game=this.state.game;
        if(game?.players.some(p=>p.id===id)) {
          // Keep identity/scores for same-tab reconnection; host can remove it explicitly.
          this.publish(disconnectPlayer(game,id));this.settleRound();
          this.patch({status:'Ein Gerät ist offline. Ihr könnt weiterspielen oder die Runde überspringen.'});
        }
      } else if(id===this.host) this.patch({online:false,busy:false,status:'Host-Verbindung unterbrochen. Warte auf Wiederverbindung …'});
    };
  }
  private startPolling(epoch:number) {
    // Local status only: no repeated network snapshots or image transfers.
    this.poll=setInterval(()=>{if(epoch===this.epoch&&this.session?.diagnostics)void this.session.diagnostics().then(diagnostic=>{if(epoch===this.epoch)this.patch({diagnostic});});},3_000);
  }
  private async control(data:unknown,id:string) {
    const msg=decodeMessage(data);if(!msg)throw new Error('Ungültige Nachricht.');
    if(this.state.role==='HOST') {
      if(!this.allowed.has(id)||(!this.displays.get(id)?.connected&&!this.state.game?.players.some(p=>p.id===id&&p.connected)))throw new Error('Nicht freigegeben.');
      if(this.displays.has(id)&&msg.type!=='ready')throw new Error('Display darf keine Spieleraktionen ausführen.');
      if(msg.type==='ready') { await this.sync(id); void this.distribute(id); }
      else if(msg.type==='avatar') {this.applyAvatar(id,msg.path);}
      else if(msg.type==='write-prompt'||msg.type==='caption') {this.applyText(id,msg.type,msg.text,msg.roundId);}
      else if(msg.type==='skip-prompt') {this.applyPromptSkip(id,msg.roundId);}
      else if(msg.type==='reaction') this.broadcastReaction(msg,id);
      else if(msg.type==='vote') {
        const g=this.state.game!;
        if(msg.roundId!==g.roundId)throw new Error('Runde beendet.');
        if(g.votes[id]===msg.photoId)return; // retry after a lost ACK is harmless
        this.publish(castVote(g,id,msg.photoId));
      } else throw new Error('Nachricht hier nicht erlaubt.');
    } else {
      if(id!==this.host)throw new Error('Nicht der Host.');
      if(msg.type==='display-sync'){
        if(this.state.role!=='DISPLAY')throw new Error('Falsche Ansicht.');
        if(this.state.game?.roundId!==msg.state.roundId||msg.state.phase==='result')this.clearPhotos();
        const previous=this.state.game;
        const {countdown,...publicGame}=msg.state;
        if(!publicGame.reactionsEnabled){clearTimeout(this.reactionTimer);this.patch({reaction:null});}
        this.patch({game:{...publicGame,votes:{}},autoReveal:publicGame.autoReveal,you:this.session!.selfId,online:true,status:'',countdown});
        if(previous?.phase!==publicGame.phase){if(publicGame.phase==='reveal')this.deps.sound('drumroll');if(publicGame.phase==='vote')this.deps.sound('voting');if(publicGame.phase==='result')this.deps.sound(publicGame.round>=publicGame.roundLimit?'gameover':'winner');}
      } else if(msg.type==='sync') {
        if(this.state.role==='DISPLAY')throw new Error('Privater Spielstand nicht für Displays.');
        if(msg.you!==this.session?.selfId)throw new Error('Spielerzuordnung ungültig.');
        const previous=this.state.game;
        if(previous?.roundId!==msg.game.roundId||msg.game.phase==='result')this.clearPhotos();
        if(!msg.game.reactionsEnabled){clearTimeout(this.reactionTimer);this.patch({reaction:null});}
        this.patch({game:msg.game,autoReveal:msg.game.autoReveal,you:msg.you,online:true,status:'',...(previous?.roundId!==msg.game.roundId?{countdown:0}:{})});
        if(previous?.phase!==msg.game.phase) {if(msg.game.phase==='prompt')this.deps.sound('prompt');if(msg.game.phase==='reveal')this.deps.sound('drumroll');if(msg.game.phase==='vote')this.deps.sound('voting');if(msg.game.phase==='result')this.deps.sound(isMatchOver(msg.game)?'gameover':'winner');}
        if(msg.game.phase==='reveal'&&msg.game.revealIndex>=0&&previous?.revealIndex!==msg.game.revealIndex&&(msg.game.mode==='PARTY'||this.photos.getBlob(msg.game.photos[msg.game.revealIndex].id)))this.deps.sound('camera');
      } else if(msg.type==='countdown') {this.patch({countdown:msg.value});if(msg.value)this.deps.sound('countdown');}
      else if(msg.type==='reaction') {const game=this.state.game;if(game?.reactionsEnabled&&!this.state.countdown&&msg.roundId===game.roundId&&reactionAllowed(game.phase))this.showReaction(msg.emoji);}
      else if(msg.type==='error')throw new Error(msg.message);
      else throw new Error('Nachricht hier nicht erlaubt.');
    }
  }
  private async acceptPhoto(data:unknown,id:string,metadata:unknown,epoch:number,transferSignal?:AbortSignal) {
    const meta=parsePhotoMetadata(metadata);const game=this.state.game;
    if(!meta||!game||game.roundId!==meta.roundId||epoch!==this.epoch)throw new Error('Foto gehört nicht zur aktuellen Runde.');
    const host=this.state.role==='HOST';
    if(host?!this.allowed.has(id)||this.displays.has(id)||!game.players.some(p=>p.id===id&&p.connected):id!==this.host)throw new Error('Nicht freigegeben.');
    const ack={ok:true as const,id:meta.id,roundId:meta.roundId};
    if(host&&game.photos.some(p=>p.ownerId===id&&p.id===meta.id))return ack;
    if(!host&&photosFor(game,this.state.you).some(p=>p.id===meta.id)&&this.photos.getBlob(meta.id))return ack;
    if(host?game.phase!=='submit'||game.photos.some(p=>p.ownerId===id||p.id===meta.id):((game.mode!=='REMOTE'&&this.state.role!=='DISPLAY'&&game.phase!=='caption')||!photosFor(game,this.state.you).some(p=>p.id===meta.id)))throw new Error('Foto wird gerade nicht erwartet.');
    if(this.receiving.has(id))throw new Error('Bitte eine Übertragung nach der anderen.');
    this.receiving.add(id);const roundSignal=this.round.signal;
    try {
      const blob=await this.deps.receive(data,meta);
      if(transferSignal?.aborted||epoch!==this.epoch||roundSignal.aborted||this.state.game?.roundId!==meta.roundId)throw new Error('Runde beendet.');
      if(host&&(!this.allowed.has(id)||!this.state.game.players.some(p=>p.id===id&&p.connected)))throw new Error('Nicht mehr freigegeben.');
      if(host) {
        const next=submitPhoto(this.state.game,id,meta.id);this.put(meta.id,blob);this.publish(next);this.deps.sound('submit');
        this.settleRound();
      } else {this.put(meta.id,blob);if(this.state.game.phase==='reveal'&&this.state.game.photos[this.state.game.revealIndex]?.id===meta.id)this.deps.sound('camera');}
      return ack;
    } finally {if(epoch===this.epoch&&!roundSignal.aborted)this.receiving.delete(id);}
  }
  private canPhoto(id:string,direction:'send'|'receive',meta:PhotoMetadata,visibility:'PRIVATE'|'PUBLIC'):boolean {
    const g=this.state.game;if(!g||g.roundId!==meta.roundId)return false;
    if(this.state.role==='HOST'){
      if(!this.allowed.has(id))return false;
      if(direction==='receive')return visibility==='PRIVATE'&&!this.displays.has(id)&&(g.phase==='submit'||(['caption','reveal','vote'].includes(g.phase)&&g.photos.some(p=>p.ownerId===id&&p.id===meta.id)))&&g.players.some(p=>p.id===id&&p.connected);
      return visibility==='PUBLIC'&&(g.mode==='REMOTE'||this.displays.has(id)||g.phase==='caption')&&photosFor(g,id).some(p=>p.id===meta.id);
    }
    if(id!==this.host)return false;
    if(direction==='send')return this.state.role==='PLAYER'&&visibility==='PRIVATE'&&g.phase==='submit';
    return visibility==='PUBLIC'&&(this.state.role==='DISPLAY'||g.mode==='REMOTE'||g.phase==='caption')&&photosFor(g,this.state.you).some(p=>p.id===meta.id);
  }
  retry = async()=>{if(this.state.busy)return;this.clearError();if(this.session){await this.session.recover?.();if(this.state.role!=='HOST'&&this.state.online)await this.send(this.host,{type:'ready'}).catch(()=>{});}else if(this.lastHost)await this.create(this.lastHost.name,this.lastHost.mode,this.lastHost.displayOnly,this.lastHost.avatar);else if(this.lastJoin)await this.join(this.lastJoin.name,this.lastJoin.code,this.lastJoin.role,this.lastJoin.hostKey,this.avatar);};
  submit = async(file:File) => {
    const game=this.state.game, epoch=this.epoch;
    if(this.state.role==='DISPLAY'||!game||game.phase!=='submit'||this.state.busy||!this.state.online)return;
    const roundId=game.roundId,signal=this.round.signal;this.patch({busy:true,error:'',progress:0,status:'Foto wird lokal verkleinert …'});
    try {
      const blob=await this.deps.process(file);
      if(epoch!==this.epoch||signal.aborted||this.state.game?.roundId!==roundId)return;
      const id=crypto.randomUUID();
      if(this.state.role==='HOST') {const next=submitPhoto(this.state.game,'host',id);this.put(id,blob);this.publish(next);this.settleRound();}
      else {
        const meta:PhotoMetadata={version:2,id,roundId,bytes:blob.size,mime:blob.type as PhotoMetadata['mime']};
        this.patch({status:'Foto wird direkt zum Host gesendet …'});
        await transferPhoto(this.session!.photo,this.host,blob,meta,signal,n=>{if(epoch===this.epoch&&!signal.aborted)this.patch({progress:n});});
      }
      if(epoch===this.epoch&&!signal.aborted){this.patch({status:'Foto bestätigt! ✅',progress:100});this.deps.sound('submit');}
    } catch(e){if(epoch===this.epoch&&!signal.aborted)this.fail(e);}
    finally{if(epoch===this.epoch&&this.state.game?.roundId===roundId)this.patch({busy:false});}
  };
  private showReveal(force=false) {
    const game=this.state.game;if(!game||!['submit','caption'].includes(game.phase))return;
    this.publish(reveal(game,Math.random,force));this.deps.sound('drumroll');this.patch({status:''});this.scheduleReveal(CUSTOM.show.introMs);
  }
  private settleRound() {
    const game=this.state.game;if(this.state.role!=='HOST'||!game)return;
    if(['prompt','submit'].includes(game.phase)&&game.roundStyle!=='REVERSE'&&skipMajority(game)&&game.promptSkips<3){const next=replacePrompt(game,this.selectedPacks,this.used);this.used.push(next.prompt);this.publish(next);this.introducePrompt();}
    else if(game.phase==='write'&&activePlayers(game).length>0&&activePlayers(game).every(p=>game.suggestions[p.id])){this.publish(chooseWrittenPrompt(game));this.introducePrompt();}
    else if(game.phase==='submit'&&allSubmitted(game)&&game.photos.length>=2){if(game.roundStyle==='REVERSE'){const photos=game.photos.filter(p=>activePlayers(game).some(player=>player.id===p.ownerId));if(photos.length<2)return;this.publish(assignCaptions({...game,photos}));for(const p of activePlayers(this.state.game!))if(p.id!=='host')void this.distribute(p.id);}else this.showReveal();}
    else if(game.phase==='caption'&&allCaptioned(game)&&game.photos.filter(p=>p.caption).length>=2)this.showReveal();
  }
  private introducePrompt() {
    clearTimeout(this.promptTimer);this.deps.sound('prompt');
    const epoch=this.epoch,roundId=this.state.game?.roundId;
    this.promptTimer=setTimeout(()=>{const game=this.state.game;if(epoch===this.epoch&&game&&game.roundId===roundId&&game.phase==='prompt')this.publish(openSubmissions(game));},4500);
  }
  private setAutoReveal = (enabled:boolean) => {
    this.patch({autoReveal:enabled});clearTimeout(this.revealTimer);
    if(enabled)this.scheduleReveal();
  };
  private scheduleReveal(delay=CUSTOM.show.photoMs) {
    clearTimeout(this.revealTimer);
    if(this.state.role!=='HOST'||!this.state.autoReveal||this.state.game?.phase!=='reveal')return;
    const epoch=this.epoch;
    this.revealTimer=setTimeout(()=>{
      if(epoch!==this.epoch)return;
      if(this.state.busy||!this.state.online){this.scheduleReveal(1000);return;}
      void this.advanceReveal();
    },delay);
  }
  private distribute(id:string):Promise<boolean> {
    const pending=this.distributing.get(id);if(pending)return pending;
    const game=this.state.game,epoch=this.epoch,signal=this.round.signal;
    if(!game||!['caption','reveal','vote'].includes(game.phase)||(game.mode!=='REMOTE'&&!this.displays.has(id)&&game.phase!=='caption')||!this.session||!this.allowed.has(id))return Promise.resolve(false);
    const session=this.session;
    const task=(async()=>{try {
      await this.sync(id); // game/round must be acknowledged before images arrive
      const sent=this.delivered.get(id)??new Set<string>();this.delivered.set(id,sent);
      for(const p of photosFor(game,id)) {
        if(signal.aborted||epoch!==this.epoch||!this.allowed.has(id)||(!this.displays.get(id)?.connected&&!this.state.game?.players.some(p=>p.id===id&&p.connected)))return false;
        if(sent.has(p.id))continue;
        const blob=this.photos.getBlob(p.id);if(!blob)throw new Error('Foto fehlt.');
        await transferPhoto(session.photo,id,blob,{version:2,id:p.id,roundId:game.roundId,bytes:blob.size,mime:blob.type as PhotoMetadata['mime']},signal,()=>{});
        sent.add(p.id);
      }
      return true;
    } catch {if(epoch===this.epoch&&!signal.aborted)this.patch({status:'Ein Foto fehlt noch auf einem Gerät. Die Show pausiert. Mit Weiter erneut versuchen.'});return false;}
    })();
    this.distributing.set(id,task);
    void task.finally(()=>{if(this.distributing.get(id)===task)this.distributing.delete(id);});return task;
  }
  advanceReveal = async() => {
    const game=this.state.game,epoch=this.epoch,signal=this.round.signal;
    if(this.state.role!=='HOST'||!game||game.phase!=='reveal'||this.state.busy||!this.state.online)return;
    clearTimeout(this.revealTimer);
    this.patch({busy:true,error:'',status:''});
    const deliver=async()=>{const players=game.mode==='REMOTE'?this.state.game!.players.filter(p=>p.id!=='host'&&p.connected).map(p=>p.id):[];const displays=[...this.displays].filter(([,d])=>d.connected).map(([id])=>id);return (await Promise.all([...players,...displays].map(id=>this.distribute(id)))).every(Boolean);};
    try {
      if(!await deliver()){this.setAutoReveal(false);return;}
      if(epoch!==this.epoch||signal.aborted||this.state.game?.phase!=='reveal')return;
      const next=nextReveal(this.state.game);this.publish(next);
      this.deps.sound(next.phase==='vote'?'voting':'camera');
      if(next.phase==='reveal'){if(!await deliver())this.setAutoReveal(false);else this.patch({autoReveal:this.state.game!.autoReveal});}
    }catch(e){if(epoch===this.epoch&&!signal.aborted)this.fail(e);}
    finally{if(epoch===this.epoch&&!signal.aborted){this.patch({busy:false});this.scheduleReveal();}}
  };
  private showReaction(emoji:Reaction) {
    clearTimeout(this.reactionTimer);this.patch({reaction:{id:crypto.randomUUID(),emoji}});if(this.state.game?.reactionSounds)this.deps.sound(REACTION_SOUNDS[emoji]);
    this.reactionTimer=setTimeout(()=>this.patch({reaction:null}),1400);
  }
  private broadcastReaction(msg:Extract<WireMessage,{type:'reaction'}>,id:string) {
    const game=this.state.game;if(!game||!game.reactionsEnabled||this.state.countdown||msg.roundId!==game.roundId||!reactionAllowed(game.phase))throw new Error('Reaktion gehört nicht zur aktuellen Show.');
    const now=Date.now();if(now-(this.reactionTimes.get(id)??-Infinity)<1800||now-this.lastReactionAt<1500)return;
    this.lastReactionAt=now;
    this.reactionTimes.set(id,now);this.showReaction(msg.emoji);
    for(const p of game.players)if(p.id!=='host'&&p.connected)void this.send(p.id,msg).catch(()=>{});
    for(const [peer,d] of this.displays)if(d.connected)void this.send(peer,msg).catch(()=>{});
  }
  react = async(emoji:Reaction) => {
    const game=this.state.game;if(this.state.role==='DISPLAY'||!game||!isReaction(emoji)||!game.reactionsEnabled||this.state.countdown||!this.state.online||!reactionAllowed(game.phase))return;
    const msg={type:'reaction' as const,emoji,roundId:game.roundId};
    if(this.state.role==='HOST')this.broadcastReaction(msg,'host');
    else {const now=Date.now();if(now-(this.reactionTimes.get('local')??-Infinity)<1800)return;this.reactionTimes.set('local',now);try{await this.send(this.host,msg);}catch{/* Reactions are optional. */}}
  };
  vote = async(id:string) => {
    const game=this.state.game,epoch=this.epoch;if(this.state.role==='DISPLAY'||!game||this.state.busy||!this.state.online)return;
    this.patch({busy:true});
    try {if(this.state.role==='HOST')this.publish(castVote(game,'host',id));else await this.send(this.host,{type:'vote',photoId:id,roundId:game.roundId});this.deps.sound('vote');}
    catch(e){if(epoch===this.epoch)this.fail(e);}finally{if(epoch===this.epoch)this.patch({busy:false});}
  };
  configure = (settings:Partial<GameOptions>) => {
    if(this.state.role!=='HOST'||!this.state.game||this.state.countdown)return;
    try{if(settings.style&&!['CLASSIC','CUSTOM','REVERSE','MIX'].includes(settings.style))throw new Error('Unbekannte Variante.');this.publish(configureGame(this.state.game,settings));}catch(e){this.fail(e);}
  };
  private applyAvatar(id:string,path:string) {
    const game=this.state.game;
    if(!game||!['lobby','result'].includes(game.phase)||this.state.countdown||!AVATARS.includes(path))throw new Error('Avatar nur zwischen den Runden ändern.');
    this.publish({...game,players:game.players.map(p=>p.id===id?{...p,avatar:path}:p)});
  }
  chooseAvatar = async(path:string) => {
    if(!AVATARS.includes(path))return;this.avatar=path;
    try{if(this.state.role==='HOST')this.applyAvatar('host',path);else if(this.state.role==='PLAYER')await this.send(this.host,{type:'avatar',path});}catch(e){this.fail(e);}
  };
  private applyText(id:string,type:'write-prompt'|'caption',text:string,roundId:string) {
    const game=this.state.game;if(!game||game.roundId!==roundId)throw new Error('Runde beendet.');
    // Retries after a lost ACK cannot add a second submission.
    if(type==='write-prompt'&&game.suggestions[id]===text.trim())return;
    if(type==='caption'&&game.photos.some(p=>p.id===game.assignments[id]&&p.caption===text.trim()))return;
    this.publish(type==='write-prompt'?writePrompt(game,id,text):writeCaption(game,id,text));this.settleRound();
  }
  sendText = async(text:string) => {
    const game=this.state.game,epoch=this.epoch;if(!game||!['write','caption'].includes(game.phase)||this.state.busy||!this.state.online)return;
    const type=game.phase==='write'?'write-prompt':'caption';this.patch({busy:true,error:''});
    try{if(this.state.role==='HOST')this.applyText('host',type,text,game.roundId);else if(this.state.role==='PLAYER')await this.send(this.host,{type,text,roundId:game.roundId});this.deps.sound('submit');}catch(e){if(epoch===this.epoch)this.fail(e);}finally{if(epoch===this.epoch)this.patch({busy:false});}
  };
  private applyPromptSkip(id:string,roundId:string) {
    const game=this.state.game;if(!game||game.roundId!==roundId)throw new Error('Runde beendet.');
    const voted=voteToSkip(game,id);
    if(skipMajority(voted)){const next=replacePrompt(voted,this.selectedPacks,this.used);this.used.push(next.prompt);this.publish(next);this.patch({status:'Die Mehrheit sagt: nächster Prompt!'});this.introducePrompt();}
    else this.publish(voted);
  }
  skipPrompt = async() => {
    const game=this.state.game;if(!game||!this.state.online||this.state.busy)return;
    try{if(this.state.role==='HOST')this.applyPromptSkip('host',game.roundId);else if(this.state.role==='PLAYER')await this.send(this.host,{type:'skip-prompt',roundId:game.roundId});this.deps.sound('button');}catch(e){this.fail(e);}
  };
  skipCurrentRound = () => {
    if(this.state.role!=='HOST'||!this.state.game)return;
    try{this.publish(skipRound(this.state.game));this.patch({busy:false,error:'',status:'Runde übersprungen. Keine Punkte vergeben.'});}catch(e){this.fail(e);}
  };
  closeStage = () => {
    const game=this.state.game;if(this.state.role!=='HOST'||!game)return;
    try{
      if(game.phase==='write'){this.publish(chooseWrittenPrompt(game));this.introducePrompt();}
      else if(game.phase==='prompt'){clearTimeout(this.promptTimer);this.publish(openSubmissions(game));}
      else if(game.phase==='vote')this.publish(finishVoting(game));
      else if(game.phase==='submit'&&game.roundStyle==='REVERSE'){
        const photos=game.photos.filter(p=>activePlayers(game).some(player=>player.id===p.ownerId));this.publish(assignCaptions({...game,photos}));for(const p of activePlayers(this.state.game!))if(p.id!=='host')void this.distribute(p.id);
      } else if(['submit','caption'].includes(game.phase))this.showReveal(true);
    }catch(e){this.fail(e);}
  };
  chooseRounds = (limit:RoundLimit) => {
    if(this.state.role!=='HOST'||!this.state.game||this.state.countdown)return;
    try{this.publish(setRoundLimit(this.state.game,limit));}catch(e){this.fail(e);}
  };
  rematch = () => {
    if(this.state.role!=='HOST'||!this.state.game)return;
    try{this.used=[];this.clearPhotos();this.publish(rematch(this.state.game));this.patch({status:'Neue Partie, neue Ausreden.',error:'',autoReveal:this.state.game!.autoReveal});}catch(e){this.fail(e);}
  };
  begin = (packs:string[]) => {
    const game=this.state.game;if(!game||this.state.role!=='HOST'||this.state.countdown)return;
    try{nextRound(game,packs,this.used);}catch(e){this.fail(e);return;}
    this.selectedPacks=packs;
    const epoch=this.epoch;this.gate.clear();let value=3;
    const tick=()=>{
      if(epoch!==this.epoch)return;
      this.patch({countdown:value,status:'',error:''});
      for(const p of this.state.game!.players)if(p.id!=='host')void this.send(p.id,{type:'countdown',value}).catch(()=>{});
      for(const [id,d] of this.displays)if(d.connected)void this.send(id,{type:'countdown',value}).catch(()=>{});
      if(value){this.deps.sound('countdown');value--;this.countdownTimer=setTimeout(tick,1000);}
      else {try{const next=nextRound(this.state.game!,packs,this.used);this.used.push(next.prompt);this.publish(next);if(next.phase==='prompt')this.introducePrompt();}catch(e){this.fail(e);}}
    };tick();
  };
  remove = (id:string) => {
    if(this.state.role!=='HOST'||id==='host'||!this.state.game)return;
    const display=this.displays.has(id);this.displays.delete(id);this.updateDisplays();
    this.allowed.delete(id);this.delivered.delete(id);this.session?.room.getPeers()[id]?.close();
    if(display)return;
    let next=disconnectPlayer(this.state.game,id);
    if(next.phase==='lobby')next={...next,players:next.players.filter(p=>p.id!==id)};else next={...next,players:next.players.map(p=>p.id===id?{...p,removed:true}:p)};
    this.publish(next);
    this.settleRound();
  };
}
