import { AdmissionGate, APPROVAL_MS, peerCheck, type JoinRequest } from './admission';
import { allSubmitted, castVote, createGame, disconnectPlayer, joinPlayer, nextRound, reveal, submitPhoto, viewFor, type Game, type Mode } from './game';
import { processImage } from './image';
import { PhotoStore } from './photoStore';
import { decodeMessage, encodeMessage, type WireMessage } from './protocol';
import { CONNECTION_ERROR, JOIN_TIMEOUT_MS, NETWORK_ERROR, createLobbySession, makeRoomCode, normalizeRoomCode, type LobbySession, type LobbyOptions } from './room';
import { parsePhotoMetadata, receivePhoto, transferPhoto, withDeadline, type PhotoMetadata } from './transfer';
import { play, type Sound } from './sound';
import type { Category } from './prompts';

type Stage = 'idle'|'search'|'approval'|'connected'|'error';
export type PlayState = {game:Game|null; role:'host'|'guest'|null; you:string; roomCode:string; busy:boolean; status:string; error:string; countdown:number; progress:number; images:Record<string,string>; requests:JoinRequest[]; stage:Stage; diagnostic:string; check:string; online:boolean};
const initial = (): PlayState => ({game:null,role:null,you:'host',roomCode:'',busy:false,status:'',error:'',countdown:0,progress:0,images:{},requests:[],stage:'idle',diagnostic:'',check:'',online:true});
const message = (e:unknown) => e instanceof Error ? e.message : 'Das hat leider nicht geklappt.';
type Dependencies = {session:(options:LobbyOptions)=>LobbySession; process:typeof processImage; receive:typeof receivePhoto; sound:(s:Sound)=>void};

/** Authoritative state independent of React renders; all asynchronous work is session-bound. */
export class GameController {
  private state = initial();
  private listeners = new Set<()=>void>();
  private session:LobbySession|null = null;
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
  private distributing = new Set<string>();
  private deps:Dependencies;
  constructor(deps:Partial<Dependencies>={}) { this.deps={session:createLobbySession,process:processImage,receive:receivePhoto,sound:play,...deps}; }
  subscribe = (fn:()=>void) => {this.listeners.add(fn); return ()=>{this.listeners.delete(fn);};};
  snapshot = () => this.state;
  private patch(values:Partial<PlayState>) {this.state={...this.state,...values}; this.listeners.forEach(fn=>fn());}
  setStatus = (status:string) => this.patch({status});
  clearError = () => this.patch({error:''});
  fail = (e:unknown) => {this.patch({error:message(e),status:'',busy:false});this.deps.sound('error');};
  private checkName(name:string) { if(!name.trim()) throw new Error('Bitte zuerst einen Namen eingeben.'); return name.trim().slice(0,24); }
  private clearPhotos() {this.round.abort(); this.round=new AbortController(); this.photos.clear();this.receiving.clear();this.distributing.clear();this.patch({images:{},progress:0});}
  private put(id:string,blob:Blob) {this.photos.put(id,blob);this.patch({images:this.photos.urls()});}
  leave = () => {
    this.epoch++; this.lifetime.abort();this.lifetime=new AbortController();
    this.cancelJoin?.();this.cancelJoin=undefined;clearTimeout(this.timer);clearTimeout(this.countdownTimer);clearInterval(this.poll);
    this.gate.clear();this.allowed.clear();this.used=[];this.host='';
    const session=this.session;this.session=null; if(session) void session.room.leave().catch(()=>{});
    this.clearPhotos();this.state=initial();this.listeners.forEach(fn=>fn());
  };
  private async send(id:string,msg:WireMessage) {
    const session=this.session; if(!session) throw new Error('Verbindung beendet.');
    return withDeadline(signal=>session.control.request(encodeMessage(msg),{target:id,signal,timeoutMs:5_000}),7_000,this.lifetime.signal);
  }
  private async sync(id:string) {
    const game=this.state.game;if(!game || !this.allowed.has(id)) return;
    await this.send(id,{type:'sync',game:viewFor(game,id),you:id});
  }
  private publish(game:Game) {
    const previous=this.state.game;
    if(game.roundId!==previous?.roundId || game.phase==='result') this.clearPhotos();
    this.patch({game,countdown:0});
    for(const player of game.players) if(player.id!=='host'&&player.connected) void this.sync(player.id).catch(()=>{});
    if(game.phase==='result'&&previous?.phase!=='result') this.deps.sound('winner');
  }
  create = (name:string, mode:Mode) => {
    try {
      const clean=this.checkName(name); this.leave();const epoch=this.epoch;
      const code=makeRoomCode();this.patch({game:createGame(clean,mode),role:'host',roomCode:code,status:'Lobby offen. Gäste müssen von dir freigegeben werden.',stage:'connected'});
      const session=this.deps.session({code,role:'host',authorize:async(id,remote)=>{
        if(this.allowed.has(id)) return;
        const game=this.state.game;
        if(epoch!==this.epoch||game?.phase!=='lobby'||this.state.countdown||this.allowed.size>=7) throw new Error('Lobby geschlossen oder voll.');
        await this.gate.request(id,remote.name!);
        if(epoch!==this.epoch||this.state.game?.phase!=='lobby'||this.state.countdown||this.allowed.size>=7) throw new Error('Lobby geschlossen oder voll.');
        this.allowed.set(id,remote.name!);
      },onJoinError:(id)=>{this.gate.decide(id,false,'Verbindungsversuch beendet.');if(!this.state.game?.players.some(p=>p.id===id)) this.allowed.delete(id);}});
      this.session=session;this.attach(session,epoch);
      session.room.onPeerJoin=id=>{
        if(epoch!==this.epoch) return;
        const name=this.allowed.get(id), game=this.state.game;if(!name||!game)return;
        const existing=game.players.find(p=>p.id===id);
        if(existing) this.publish({...game,players:game.players.map(p=>p.id===id?{...p,connected:true}:p)});
        else {try{this.publish(joinPlayer(game,{id,name,score:0,connected:true}));}catch{return;}}
        this.deps.sound('connected');this.patch({status:`${name} ist dabei!`});
      };
      this.startPolling(epoch);
    } catch(e) {this.leave();this.fail(e);}
  };
  approve = (id:string,yes:boolean) => this.gate.decide(id,yes);
  join = async (name:string,input:string) => {
    let epoch=this.epoch;
    try {
      const clean=this.checkName(name), code=normalizeRoomCode(input);this.leave();epoch=this.epoch;
      this.patch({role:'guest',roomCode:code,busy:true,stage:'search',status:'Suche Lobby …'});
      let rejectJoin!:(e:Error)=>void, resolveJoin!:()=>void;
      const joined=new Promise<void>((resolve,reject)=>{resolveJoin=resolve;rejectJoin=reject;});
      void joined.catch(()=>{}); // also handled when session creation throws synchronously
      const arm=(ms:number,text:()=>string)=>{clearTimeout(this.timer);this.timer=setTimeout(()=>rejectJoin(new Error(text())),ms);};
      this.cancelJoin=()=>rejectJoin(new Error('Beitritt abgebrochen.'));
      let transportFailed=false;
      const session=this.deps.session({code,role:'guest',name:clean,
        authorize:id=>{if(this.host&&this.host!==id)throw new Error('Anderer Host.');this.host=id;},
        onStage:()=>{if(epoch!==this.epoch)return;this.patch({stage:'approval',status:'Anfrage angekommen. Der Host muss dich freigeben.'});arm(APPROVAL_MS+10_000,()=> 'Keine Freigabe erhalten. Bitte den Host fragen und erneut beitreten.');},
        onJoinError:(id,error)=>{if(epoch!==this.epoch)return;transportFailed=true;if(id===this.host)rejectJoin(new Error(error.includes('abgelehnt')?error:NETWORK_ERROR));}
      });
      this.session=session;this.patch({check:peerCheck(session.selfId)});this.attach(session,epoch);
      session.room.onPeerJoin=id=>{if(epoch===this.epoch&&id===this.host)resolveJoin();};
      arm(JOIN_TIMEOUT_MS,()=>transportFailed?NETWORK_ERROR:session.relayCount()===0?'Kein Lobby-Dienst erreichbar. Internet, VPN oder Inhaltsblocker prüfen.':CONNECTION_ERROR);
      this.startPolling(epoch);
      try {await joined;} finally {clearTimeout(this.timer);this.cancelJoin=undefined;}
      if(epoch!==this.epoch)return;
      this.patch({busy:false,stage:'connected',online:true,status:'Freigegeben! Spielstand wird geladen …'});
      await this.send(this.host,{type:'ready'});this.deps.sound('connected');
    } catch(e) {if(epoch!==this.epoch)return;const diagnostic=this.state.diagnostic;this.leave();this.patch({stage:'error',diagnostic});this.fail(e);}
  };
  private attach(session:LobbySession,epoch:number) {
    session.control.onRequest=async(data,{peerId})=>{if(epoch!==this.epoch)throw new Error('Sitzung beendet.');await this.control(data,peerId);return {ok:true};};
    session.photo.onRequest=(data,{peerId,metadata})=>this.acceptPhoto(data,peerId,metadata,epoch);
    session.room.onPeerLeave=id=>{
      if(epoch!==this.epoch)return;
      if(this.state.role==='host') {
        this.gate.decide(id,false,'Gerät hat die Verbindung verloren.');
        const game=this.state.game;
        if(game?.players.some(p=>p.id===id)) {
          // Keep identity/scores for same-tab reconnection; host can remove it explicitly.
          this.publish({...game,players:game.players.map(p=>p.id===id?{...p,connected:false}:p)});
          this.patch({status:'Ein Gerät ist offline. Tab dort geöffnet lassen oder Spieler entfernen.'});
        }
      } else if(id===this.host) this.patch({online:false,status:'Host-Verbindung unterbrochen. Warte auf Wiederverbindung …'});
    };
  }
  private startPolling(epoch:number) {
    let checking=false;
    const poll=async()=>{
      if(epoch!==this.epoch||!this.session)return;
      this.patch({diagnostic:`v3 · Vermittlung: ${this.session.relayCount()}/5 erreichbar · ${this.state.stage==='approval'?'WebRTC verbunden, Freigabe offen':this.state.stage==='connected'?'Sitzung geöffnet': 'WebRTC wird gesucht'} · kein TURN`});
      if(checking||this.state.role!=='guest'||this.state.stage!=='connected')return;
      checking=true;
      try{await this.send(this.host,{type:'ready'});if(epoch===this.epoch)this.patch({online:true});}
      catch{if(epoch===this.epoch)this.patch({online:false,status:'Keine Antwort vom Host. Tab und Verbindung dort prüfen.'});}
      finally{checking=false;}
    };
    this.poll=setInterval(()=>void poll(),8_000);void poll();
  }
  private async control(data:unknown,id:string) {
    const msg=decodeMessage(data);if(!msg)throw new Error('Ungültige Nachricht.');
    if(this.state.role==='host') {
      if(!this.allowed.has(id)||!this.state.game?.players.some(p=>p.id===id&&p.connected))throw new Error('Nicht freigegeben.');
      if(msg.type==='ready') { await this.sync(id); if(this.state.game.mode==='remote'&&this.state.game.phase==='vote')void this.distribute(id); }
      else if(msg.type==='vote') {
        const g=this.state.game;
        if(msg.roundId!==g.roundId)throw new Error('Runde beendet.');
        if(g.votes[id]===msg.photoId)return; // retry after a lost ACK is harmless
        this.publish(castVote(g,id,msg.photoId));
      } else throw new Error('Nachricht hier nicht erlaubt.');
    } else {
      if(id!==this.host)throw new Error('Nicht der Host.');
      if(msg.type==='sync') {
        if(msg.you!==this.session?.selfId)throw new Error('Spielerzuordnung ungültig.');
        const previous=this.state.game;
        if(previous?.roundId!==msg.game.roundId||msg.game.phase==='result')this.clearPhotos();
        this.patch({game:msg.game,you:msg.you,online:true,status:'',...(previous?.roundId!==msg.game.roundId?{countdown:0}:{})});
        if(previous?.phase!==msg.game.phase) {if(msg.game.phase==='submit')this.deps.sound('prompt');if(msg.game.phase==='vote')this.deps.sound('reveal');if(msg.game.phase==='result')this.deps.sound('winner');}
      } else if(msg.type==='countdown') {this.patch({countdown:msg.value});if(msg.value)this.deps.sound('countdown');}
      else if(msg.type==='error')throw new Error(msg.message);
      else throw new Error('Nachricht hier nicht erlaubt.');
    }
  }
  private async acceptPhoto(data:unknown,id:string,metadata:unknown,epoch:number) {
    const meta=parsePhotoMetadata(metadata);const game=this.state.game;
    if(!meta||!game||game.roundId!==meta.roundId||epoch!==this.epoch)throw new Error('Foto gehört nicht zur aktuellen Runde.');
    const host=this.state.role==='host';
    if(host?!this.allowed.has(id)||!game.players.some(p=>p.id===id&&p.connected):id!==this.host)throw new Error('Nicht freigegeben.');
    const ack={ok:true as const,id:meta.id,roundId:meta.roundId};
    if(host&&game.photos.some(p=>p.ownerId===id&&p.id===meta.id))return ack;
    if(!host&&game.mode==='remote'&&game.phase==='vote'&&this.photos.getBlob(meta.id))return ack;
    if(host?game.phase!=='submit'||game.photos.some(p=>p.ownerId===id||p.id===meta.id):game.phase!=='vote'||game.mode!=='remote'||!game.photos.some(p=>p.id===meta.id))throw new Error('Foto wird gerade nicht erwartet.');
    if(this.receiving.has(id))throw new Error('Bitte eine Übertragung nach der anderen.');
    this.receiving.add(id);const roundSignal=this.round.signal;
    try {
      const blob=await this.deps.receive(data,meta);
      if(epoch!==this.epoch||roundSignal.aborted||this.state.game?.roundId!==meta.roundId)throw new Error('Runde beendet.');
      if(host) {
        const next=submitPhoto(this.state.game,id,meta.id);this.put(meta.id,blob);this.publish(next);this.deps.sound('submit');
        if(allSubmitted(next)&&next.players.every(p=>p.connected))this.showReveal();
      } else this.put(meta.id,blob);
      return ack;
    } finally {if(epoch===this.epoch&&!roundSignal.aborted)this.receiving.delete(id);}
  }
  submit = async(file:File) => {
    const game=this.state.game, epoch=this.epoch;
    if(!game||game.phase!=='submit'||this.state.busy||!this.state.online)return;
    const roundId=game.roundId,signal=this.round.signal;this.patch({busy:true,error:'',progress:0,status:'Foto wird lokal verkleinert …'});
    try {
      const blob=await this.deps.process(file);
      if(epoch!==this.epoch||signal.aborted||this.state.game?.roundId!==roundId)return;
      const id=crypto.randomUUID();
      if(this.state.role==='host') {const next=submitPhoto(this.state.game,'host',id);this.put(id,blob);this.publish(next);if(allSubmitted(next)&&next.players.every(p=>p.connected))this.showReveal();}
      else {
        const meta:PhotoMetadata={version:2,id,roundId,bytes:blob.size,mime:blob.type as PhotoMetadata['mime']};
        this.patch({status:'Foto wird direkt zum Host gesendet …'});
        await transferPhoto(this.session!.photo,this.host,blob,meta,signal,n=>{if(epoch===this.epoch&&!signal.aborted)this.patch({progress:n});});
      }
      if(epoch===this.epoch&&!signal.aborted){this.patch({status:'Foto bestätigt! ✅',progress:100});this.deps.sound('submit');}
    } catch(e){if(epoch===this.epoch&&!signal.aborted)this.fail(e);}
    finally{if(epoch===this.epoch)this.patch({busy:false});}
  };
  private showReveal() {
    const game=this.state.game;if(!game||game.phase!=='submit')return;
    this.publish(reveal(game));this.deps.sound('reveal');
    if(game.mode==='remote')for(const p of game.players)if(p.id!=='host'&&p.connected)void this.distribute(p.id);
  }
  private async distribute(id:string) {
    if(this.distributing.has(id))return;
    const game=this.state.game,epoch=this.epoch,signal=this.round.signal;
    if(!game||game.phase!=='vote'||game.mode!=='remote'||!this.session)return;
    this.distributing.add(id);
    try {
      await this.sync(id); // game/round must be acknowledged before images arrive
      for(const p of game.photos) {
        if(signal.aborted||epoch!==this.epoch)return;
        const blob=this.photos.getBlob(p.id);if(!blob)continue;
        await transferPhoto(this.session.photo,id,blob,{version:2,id:p.id,roundId:game.roundId,bytes:blob.size,mime:blob.type as PhotoMetadata['mime']},signal,()=>{});
      }
    } catch {if(epoch===this.epoch&&!signal.aborted)this.patch({status:'Fotoübertragung wird beim nächsten Kontakt erneut versucht.'});}
    finally {if(epoch===this.epoch&&!signal.aborted)this.distributing.delete(id);}
  }
  vote = async(id:string) => {
    const game=this.state.game,epoch=this.epoch;if(!game||this.state.busy||!this.state.online)return;
    this.patch({busy:true});
    try {if(this.state.role==='host')this.publish(castVote(game,'host',id));else await this.send(this.host,{type:'vote',photoId:id,roundId:game.roundId});this.deps.sound('vote');}
    catch(e){if(epoch===this.epoch)this.fail(e);}finally{if(epoch===this.epoch)this.patch({busy:false});}
  };
  begin = (categories:Category[]) => {
    const game=this.state.game;if(!game||this.state.role!=='host'||this.state.countdown)return;
    try{nextRound(game,categories,this.used);}catch(e){this.fail(e);return;}
    if(game.players.some(p=>!p.connected)){this.fail(new Error('Bitte auf getrennte Spieler warten oder sie entfernen.'));return;}
    const epoch=this.epoch;this.gate.clear();let value=3;
    const tick=()=>{
      if(epoch!==this.epoch)return;
      this.patch({countdown:value,status:'',error:''});
      for(const p of this.state.game!.players)if(p.id!=='host')void this.send(p.id,{type:'countdown',value}).catch(()=>{});
      if(value){this.deps.sound('countdown');value--;this.countdownTimer=setTimeout(tick,1000);}
      else {try{const next=nextRound(this.state.game!,categories,this.used);this.used.push(next.prompt);this.publish(next);this.deps.sound('prompt');}catch(e){this.fail(e);}}
    };tick();
  };
  remove = (id:string) => {
    if(this.state.role!=='host'||id==='host'||!this.state.game)return;
    this.allowed.delete(id);this.session?.room.getPeers()[id]?.close();
    let next=disconnectPlayer(this.state.game,id);
    if(next.phase==='lobby')next={...next,players:next.players.filter(p=>p.id!==id)};
    if(next.players.filter(p=>p.connected).length<2){this.clearPhotos();next={...next,phase:'lobby',roundId:'',photos:[],votes:{},winnerId:null};}
    this.publish(next);
    if(next.phase==='submit'&&allSubmitted(next))this.showReveal();
  };
}
