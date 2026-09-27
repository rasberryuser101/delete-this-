import { MeteredPeer, type RemotePeer } from '@metered-ca/realtime';
import { makeIdentity, storedIdentity, verifyIdentity, type DeviceIdentity, type Role } from './identity';
import { parseNetwork, type NetworkControl } from './networkProtocol';
import { decodeMessage, encodeMessage } from './protocol';
import { PhotoChannel } from './photoChannel';
import { withDeadline, type PhotoAction, type PhotoMetadata } from './transfer';
import type { RequestAction } from './actions';
export { parsePhotoMetadata } from './transfer';
export const BUILD='5.0 · Metered-Verbindungen';
export const CONNECTION_ERROR='Lobby nicht gefunden oder Verbindung fehlgeschlagen. Code prüfen und erneut versuchen.';
export const NETWORK_ERROR='Verbindung fehlgeschlagen. Bitte Internet prüfen und erneut versuchen.';
export const JOIN_TIMEOUT_MS=90_000;
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export type LobbyRole=Role;
export type LobbyHandshake={version:5;role:Role;name?:string;publicKey?:string;check?:string};
export type LobbyOptions={code:string;role:Role;name?:string;identity?:DeviceIdentity;expectedHostKey?:string;signal?:AbortSignal;
  authorize?:(id:string,remote:LobbyHandshake)=>void|Promise<void>;
  onStage?:(stage:'approval'|'connecting',id:string)=>void;onJoinError?:(id:string,error:string)=>void;
  onStatus?:(status:string)=>void;
  canPhoto?:(id:string,direction:'send'|'receive',meta:PhotoMetadata,visibility:'PRIVATE'|'PUBLIC')=>boolean};
export type LobbySession={selfId:string;publicKey?:string;control:RequestAction<string,{ok:true}>;photo:PhotoAction;
  room:{onPeerJoin:((id:string)=>void)|null;onPeerLeave:((id:string)=>void)|null;leave:()=>Promise<void>;getPeers:()=>Record<string,{close:()=>void}>};
  relayCount:()=>number;diagnostics?:()=>Promise<string>;recover?:()=>Promise<void>;clearTransfers?:()=>void};
export function makeRoomCode(bytes?:Uint8Array):string {
 if(bytes){if(bytes.length!==10)throw new Error('Zehn Zufallsbytes erwartet.');return Array.from(bytes,b=>ALPHABET[b%ALPHABET.length]).join('');}
 // Rejection sampling avoids modulo bias (alphabet has 31 characters).
 let result='';while(result.length<10)for(const b of crypto.getRandomValues(new Uint8Array(16))){if(b<Math.floor(256/ALPHABET.length)*ALPHABET.length)result+=ALPHABET[b%ALPHABET.length];if(result.length===10)break;}return result;
}
export function normalizeRoomCode(input:string):string {
 let code=input.trim();if(/^https?:\/\//.test(code)){try{code=new URLSearchParams(new URL(code).hash.split('?')[1]??'').get('code')??'';}catch{throw new Error('Ungültiger Einladungslink.');}}
 code=code.toUpperCase().replace(/[\s-]/g,'');if(!/^[A-HJ-NP-Z2-9]{10}$/.test(code))throw new Error('Bitte den zehnstelligen Lobbycode eingeben.');return code;
}
export const roomLink=(code:string,location:Pick<Location,'origin'|'pathname'>,display=false,hostKey='')=>`${location.origin}${location.pathname}#/spiel?code=${normalizeRoomCode(code)}${display?'&display=1':''}${/^04[\da-f]{128}$/.test(hostKey)?`&host=${hostKey}`:''}`;
export function parseHandshake(value:unknown):LobbyHandshake|null {
 if(!value||typeof value!=='object')return null;const v=value as LobbyHandshake;
 return v.version===5&&['HOST','PLAYER','DISPLAY'].includes(v.role)&&(v.role==='HOST'||(typeof v.name==='string'&&v.name.trim().length>0&&v.name.length<=30))?v:null;
}
export function meteredKey():string {
 const key=import.meta.env.VITE_METERED_API_KEY;
 if(!key||key==='pk_live_REPLACE_ME'||!key.startsWith('pk_'))throw new Error(import.meta.env.DEV?'Entwicklerhinweis: VITE_METERED_API_KEY in .env.local setzen und Vite neu starten.':'Der Multiplayer ist noch nicht eingerichtet. Der Betreiber muss die Metered-Variable in Vercel setzen und neu deployen.');
 return key;
}
type Binding={id:string;key:string;role:Role;remoteId:string;online:boolean};
/** Only Metered control envelopes cross this function. Binary/photo fields are rejected. */
export async function sendControl(peer:Pick<MeteredPeer,'sendTo'>,id:string,message:NetworkControl){const checked=parseNetwork(message);if(!checked)throw new Error('Ungültige Steuernachricht.');await peer.sendTo(id,checked);}
export async function createLobbySession(options:LobbyOptions):Promise<LobbySession>{
 const apiKey=meteredKey();
 if(!globalThis.isSecureContext||typeof RTCPeerConnection==='undefined')throw new Error('Bitte die HTTPS-Seite in Safari oder Chrome öffnen.');
 const identity=options.identity??await makeIdentity(options.role==='HOST'?'host':storedIdentity(options.role));
 const lobby=new MeteredLobby(options,identity,()=>new MeteredPeer({apiKey}));
 try{await withDeadline(()=>lobby.start(),45_000,options.signal);return lobby.session;}catch{await lobby.session.room.leave();throw new Error(NETWORK_ERROR);}
}
/** Exported for deterministic SDK-event tests; runtime still uses the official MeteredPeer. */
export class MeteredLobby {
 readonly session:LobbySession;
 private peer:MeteredPeer;
 private records=new Map<string,Binding>();
 private remoteToId=new Map<string,string>();
 private remotes=new Map<string,RemotePeer>();
 private transports=new Map<string,PhotoChannel>();
 private channelDetach=new Map<string,()=>void>();
 private detach=new Map<string,()=>void>();
 private pending=new Map<string,{remoteId:string;resolve:()=>void;reject:()=>void}>();
 private admitting=new Set<string>();
 private blocked=new Set<string>();
 private hostKey='';
 private hostRemote='';
 private closed=false;
 private generation=0;
 private resets=0;
 private lastReset='';
 private recovering:Promise<void>|null=null;
 private health:ReturnType<typeof setInterval>|undefined;
 private lastTraffic=Date.now();
 private badSince=0;
 private lastRestart=0;
 private announced=new Set<string>();
 private inboundRate=new Map<string,{at:number;count:number}>();
 private joinAttempts:number[]=[];
 private lifetime=new AbortController();
 private readonly channel:string;
 constructor(private options:LobbyOptions,private identity:DeviceIdentity,private factory:()=>MeteredPeer){
  this.channel=`game-${normalizeRoomCode(options.code)}`;this.peer=factory();
  this.session={selfId:identity.id,publicKey:identity.publicKey,control:{onRequest:null,request:async(data,opts)=>{
   const msg=decodeMessage(data);const binding=this.records.get(opts.target);if(!msg||!binding||!binding.online)throw new Error('Nicht freigegeben oder getrennt.');
   const requestId=crypto.randomUUID();
   await new Promise<void>((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);opts.signal?.removeEventListener('abort',cancel);this.pending.delete(requestId);};
    const cancel=()=>{cleanup();reject(new Error('Keine Antwort. Bitte erneut versuchen.'));};
    const timer=setTimeout(cancel,opts.timeoutMs??10_000);opts.signal?.addEventListener('abort',cancel,{once:true});
    this.pending.set(requestId,{remoteId:binding.remoteId,resolve:()=>{cleanup();resolve();},reject:cancel});
    if(opts.signal?.aborted){cancel();return;}
    void sendControl(this.peer,binding.remoteId,{type:'CONTROL',requestId,message:msg}).catch(cancel);
   });return {ok:true};
  }},photo:{onRequest:null,request:async(data,opts)=>{const binding=this.records.get(opts.target),transport=binding&&this.transports.get(binding.remoteId);if(!binding?.online||!transport)throw new Error('Fotoverbindung wird wiederhergestellt …');return transport.request(data,opts);}},
   room:{onPeerJoin:null,onPeerLeave:null,leave:()=>this.close(),getPeers:()=>Object.fromEntries([...this.records].map(([id])=>[id,{close:()=>this.revoke(id)}]))},
   relayCount:()=>this.peer.state==='joined'?1:0,diagnostics:()=>this.diagnostics(),recover:()=>this.recover(),clearTransfers:()=>{for(const t of this.transports.values())t.clear();}};
 }
 private proof(id:string,role:Role,remoteId:string){return `${this.channel}|${id}|${role}|${remoteId}`;}
 private async announce(remoteId:string){
  if(this.closed||this.peer.state!=='joined')return;
  if(this.options.role==='HOST')await sendControl(this.peer,remoteId,{type:'HOST',id:this.identity.id,publicKey:this.identity.publicKey,signature:await this.identity.sign(this.proof(this.identity.id,'HOST',this.peer.peerId!))});
 }
 private async requestJoin(remoteId:string){
  if(this.options.role==='HOST'||this.admitting.has(remoteId))return;
  this.admitting.add(remoteId);
  try{await sendControl(this.peer,remoteId,{type:'JOIN',id:this.identity.id,role:this.options.role,name:this.options.name?.trim().slice(0,30)||'Display',publicKey:this.identity.publicKey,signature:await this.identity.sign(this.proof(this.identity.id,this.options.role,this.peer.peerId!))});}
  catch{this.admitting.delete(remoteId);}
 }
 async start(){this.attach();await this.peer.join(this.channel);if(this.closed)return;this.health=setInterval(()=>void this.checkHealth(),5000);
  if(typeof window!=='undefined'){window.addEventListener('online',this.wake);window.addEventListener('offline',this.offline);window.addEventListener('pageshow',this.wake);document.addEventListener('visibilitychange',this.visible);}
 }
 private attach(){
  const peer=this.peer,generation=this.generation;
  peer.on('peer-joined',({peer:remote})=>{if(this.closed||generation!==this.generation)return;
   // Cap resource use in the application; service-level quotas remain necessary.
   if(this.remotes.size>=24){remote.pc.close();return;}
   this.remotes.set(remote.id,remote);
   const data=({channel}:{channel:RTCDataChannel})=>this.bindChannel(remote,channel);
   const reset=()=>{this.resets++;this.lastReset=new Date().toISOString();this.dropTransport(remote.id);this.setOffline(remote.id);this.openChannel(remote);};
   remote.on('data-channel',data);remote.on('connection-reset',reset);
   this.detach.set(remote.id,()=>{remote.off('data-channel',data);remote.off('connection-reset',reset);});
   void this.announce(remote.id).catch(()=>{});
  });
  peer.on('peer-left',({peer:remote})=>{if(generation!==this.generation)return;this.dropTransport(remote.id);this.setOffline(remote.id);this.detach.get(remote.id)?.();this.detach.delete(remote.id);this.remotes.delete(remote.id);this.admitting.delete(remote.id);this.announced.delete(remote.id);this.inboundRate.delete(remote.id);});
  peer.on('data',({senderPeerId,data,kind})=>{if(this.closed||generation!==this.generation||kind!=='direct'||!this.remotes.has(senderPeerId))return;
   const now=Date.now(),rate=this.inboundRate.get(senderPeerId);if(!rate||now-rate.at>1000)this.inboundRate.set(senderPeerId,{at:now,count:1});else if(++rate.count>40)return;
   const msg=parseNetwork(data);if(msg){this.lastTraffic=now;void this.handle(senderPeerId,msg,generation).catch(()=>{});}
  });
  peer.on('state-change',({to})=>{if(generation!==this.generation||this.closed)return;
   if(to==='reconnecting'||to==='closed'){optionsStatus(this.options,'Verbindung wird wiederhergestellt …');for(const id of this.remotes.keys())this.setOffline(id);}
   if(to==='joined'){this.lastTraffic=Date.now();for(const r of this.remotes.values()){void this.announce(r.id).catch(()=>{});this.openChannel(r);}}
  });
  peer.on('error',()=>{if(generation===this.generation&&!this.closed)optionsStatus(this.options,'Verbindung fehlgeschlagen. Erneut versuchen.');});
 }
 private async handle(remoteId:string,msg:NetworkControl,generation:number){
  if(msg.type==='HOST'&&this.options.role!=='HOST'){
   if((this.options.expectedHostKey&&msg.publicKey!==this.options.expectedHostKey)||(this.hostKey&&msg.publicKey!==this.hostKey)||msg.id!=='host'||!await verifyIdentity(msg.publicKey,msg.signature,this.proof(msg.id,'HOST',remoteId)))return;
   if(generation!==this.generation||this.closed)return;
   if(this.hostRemote&&this.hostRemote!==remoteId&&this.remotes.has(this.hostRemote))return;
   if(this.records.get('host')?.remoteId===remoteId&&this.records.get('host')?.online)return;
   this.hostKey=msg.publicKey;this.hostRemote=remoteId;
   await this.options.authorize?.('host',{version:5,role:'HOST',publicKey:msg.publicKey});if(!this.records.has('host'))this.options.onStage?.('approval','host');await this.requestJoin(remoteId);return;
  }
  if(msg.type==='JOIN'&&this.options.role==='HOST'){
   if(this.remoteToId.has(remoteId)&&this.remoteToId.get(remoteId)!==msg.id)return;
   if(this.admitting.has(remoteId)||this.blocked.has(msg.id)||this.blocked.has(remoteId))return;
   const now=Date.now();this.joinAttempts=this.joinAttempts.filter(t=>now-t<60_000);if(this.joinAttempts.length>=24)return;this.joinAttempts.push(now);
   this.admitting.add(remoteId);
   try {
    if(msg.id==='host'||!await verifyIdentity(msg.publicKey,msg.signature,this.proof(msg.id,msg.role,remoteId)))return;
    if(generation!==this.generation||this.closed)return;
    const existing=this.records.get(msg.id);
    if(existing&&existing.role!==msg.role){await sendControl(this.peer,remoteId,{type:'DENIED'});return;}
    // A copied playerId is not a credential. Different keys need explicit reapproval.
    if(existing&&(existing.key!==msg.publicKey||existing.role!==msg.role)){
     if(existing.online){await sendControl(this.peer,remoteId,{type:'DENIED'});return;}
     await this.options.authorize?.(msg.id,{version:5,role:msg.role,name:msg.name,check:msg.publicKey.slice(-12).toUpperCase()});
    } else if(!existing)await this.options.authorize?.(msg.id,{version:5,role:msg.role,name:msg.name,check:msg.publicKey.slice(-12).toUpperCase()});
    if(generation!==this.generation||this.closed||!this.remotes.has(remoteId)||this.blocked.has(msg.id))return;
    this.setBinding(msg.id,msg.publicKey,msg.role,remoteId);
    await sendControl(this.peer,remoteId,{type:'APPROVED',id:msg.id,role:msg.role});this.openChannel(this.remotes.get(remoteId)!);
   }catch{if(generation!==this.generation||this.closed)return;await sendControl(this.peer,remoteId,{type:'DENIED'}).catch(()=>{});this.blocked.add(remoteId);}
   finally{this.admitting.delete(remoteId);}return;
  }
  if(msg.type==='APPROVED'&&this.options.role!=='HOST'&&remoteId===this.hostRemote&&msg.id===this.identity.id&&msg.role===this.options.role){
   this.admitting.delete(remoteId);if(!this.records.has('host'))this.options.onStage?.('connecting','host');this.setBinding('host',this.hostKey,'HOST',remoteId);this.openChannel(this.remotes.get(remoteId)!);optionsStatus(this.options,'Freigegeben. Verbinde …');return;
  }
  if(msg.type==='DENIED'&&remoteId===this.hostRemote){this.options.onJoinError?.('host','Der Host hat die Anfrage abgelehnt.');return;}
  const id=this.remoteToId.get(remoteId),binding=id&&this.records.get(id);if(!binding||binding.remoteId!==remoteId||!binding.online)return;
  if(msg.type==='ACK'){const p=this.pending.get(msg.requestId);if(p?.remoteId===remoteId){if(msg.ok)p.resolve();else p.reject();}return;}
  if(msg.type==='CONTROL'){
   let ok=false;try{await this.session.control.onRequest?.(encodeMessage(msg.message),{peerId:binding.id,signal:this.lifetime.signal});ok=true;}catch{/* Don't reflect errors or user payloads into messages/logs. */}
   await sendControl(this.peer,remoteId,{type:'ACK',requestId:msg.requestId,ok});
  }
 }
 private setBinding(id:string,key:string,role:Role,remoteId:string){
  const old=this.records.get(id);if(old&&old.remoteId===remoteId&&old.key===key){this.remoteToId.set(remoteId,id);return;}if(old&&old.remoteId!==remoteId){this.dropTransport(old.remoteId);this.remoteToId.delete(old.remoteId);}
  this.records.set(id,{id,key,role,remoteId,online:false});this.remoteToId.set(remoteId,id);
 }
 private openChannel(remote:RemotePeer){
  if(!this.remoteToId.has(remote.id)||this.transports.has(remote.id)||this.closed)return;
  // Creating the channel STARTS negotiation; never wait for PC connected first.
  if(!remote.polite)this.bindChannel(remote,remote.pc.createDataChannel('photo-transfer',{ordered:true}));
 }
 private bindChannel(remote:RemotePeer,channel:RTCDataChannel){
  const id=this.remoteToId.get(remote.id),binding=id&&this.records.get(id);
  if(!binding||binding.remoteId!==remote.id||channel.label!=='photo-transfer'||channel.ordered!==true||channel.maxRetransmits!==null||channel.maxPacketLifeTime!==null||this.transports.has(remote.id)){channel.close();return;}
  const transport:PhotoChannel=new PhotoChannel(channel,binding.id,(direction,meta,visibility)=>{
   const b=this.records.get(binding.id);
   return !!b&&b.online&&b.remoteId===remote.id&&this.transports.get(remote.id)===transport&&this.options.canPhoto?.(binding.id,direction,meta,visibility)===true;
  },async(data,ctx)=>{if(!this.session.photo.onRequest)throw new Error('Kein Empfänger.');return this.session.photo.onRequest(data,ctx);},this.options.role==='HOST'?'PUBLIC':'PRIVATE');
  this.transports.set(remote.id,transport);
  const open=()=>{if(this.closed||this.transports.get(remote.id)!==transport)return;binding.online=true;this.badSince=0;optionsStatus(this.options,this.resets?'Wieder verbunden':'Verbunden');this.session.room.onPeerJoin?.(binding.id);};
  const close=()=>{channel.removeEventListener('open',open);channel.removeEventListener('close',close);this.setOffline(remote.id);this.dropTransport(remote.id);};
  channel.addEventListener('open',open);channel.addEventListener('close',close);
  this.channelDetach.set(remote.id,()=>{channel.removeEventListener('open',open);channel.removeEventListener('close',close);});
  if(channel.readyState==='open')open();
 }
 private setOffline(remoteId:string){const id=this.remoteToId.get(remoteId),b=id?this.records.get(id):undefined;if(b?.online){b.online=false;this.transports.get(remoteId)?.clear();this.session.room.onPeerLeave?.(b.id);}for(const p of this.pending.values())if(p.remoteId===remoteId)p.reject();}
 private dropTransport(remoteId:string){this.channelDetach.get(remoteId)?.();this.channelDetach.delete(remoteId);const t=this.transports.get(remoteId);this.transports.delete(remoteId);t?.close();}
 private revoke(id:string){const b=this.records.get(id);if(!b)return;this.blocked.add(id);this.records.delete(id);this.remoteToId.delete(b.remoteId);this.dropTransport(b.remoteId);void sendControl(this.peer,b.remoteId,{type:'DENIED'}).catch(()=>{});this.session.room.onPeerLeave?.(id);}
 private offline=()=>{optionsStatus(this.options,'Verbindung kurz unterbrochen …');for(const r of this.remotes.keys()){this.setOffline(r);this.dropTransport(r);}};
 private visible=()=>{if(document.visibilityState==='visible')this.wake();};
 private wake=()=>{void this.checkHealth(true);};
 private async checkHealth(wake=false){
  if(this.closed||(typeof navigator!=='undefined'&&navigator.onLine===false))return;
  if(this.peer.state==='closed'||(wake&&Date.now()-this.lastTraffic>20_000)){await this.recover();return;}
  let bad=this.peer.state!=='joined';let stalled=false,healthy=0;
  for(const b of this.records.values()){
   const remote=this.remotes.get(b.remoteId),dc=this.transports.get(b.remoteId)?.channel;
   if(!remote){if(this.options.role!=='HOST')bad=true;continue;}
   if(dc?.readyState!=='open'||['failed','disconnected','closed'].includes(remote.pc.connectionState)){
    stalled=true;this.setOffline(b.remoteId);
    if(remote&&wake)(remote.pc as RTCPeerConnection).restartIce?.();
   }else {healthy++;if(!b.online&&this.peer.state==='joined'){b.online=true;this.session.room.onPeerJoin?.(b.id);}}
  }
  // An absent guest must not force healthy players through repeated global reconnects.
  if(stalled&&(this.options.role!=='HOST'||healthy===0))bad=true;
  // Repeat discovery if first announcement was lost; do not flood open sessions.
  if(this.options.role==='HOST')for(const r of this.remotes.values())if(!this.remoteToId.has(r.id)&&!this.announced.has(r.id)){this.announced.add(r.id);void this.announce(r.id).catch(()=>{});}
  if(bad){this.badSince||=Date.now();if(Date.now()-this.badSince>20_000)await this.recover();}else this.badSince=0;
 }
 async recover(){
  if(this.closed||this.recovering)return this.recovering??Promise.resolve();
  if(Date.now()-this.lastRestart<5000)return;this.lastRestart=Date.now();
  this.recovering=(async()=>{
   optionsStatus(this.options,'Verbindung wird wiederhergestellt …');this.resets++;this.generation++;
   for(const id of this.remotes.keys()){this.setOffline(id);this.dropTransport(id);}for(const fn of this.detach.values())fn();this.detach.clear();this.remotes.clear();this.remoteToId.clear();this.admitting.clear();this.announced.clear();this.inboundRate.clear();
   const old=this.peer;await old.close().catch(()=>{});if(this.closed)return;
   this.peer=this.factory();this.attach();try{await this.peer.join(this.channel);this.lastTraffic=Date.now();this.badSince=0;}catch{optionsStatus(this.options,'Verbindung fehlgeschlagen. Erneut versuchen.');}
  })().finally(()=>{this.recovering=null;});return this.recovering;
 }
 private async diagnostics(){
  if(!import.meta.env.DEV)return '';
  const lines=[`Metered: ${this.peer.state} · Identität: ${this.identity.id} · Peer: ${this.peer.peerId??'–'} · Rolle: ${this.options.role}`,`Reconnects: ${this.resets} · letzter Reset: ${this.lastReset||'–'}`];
  for(const remote of this.remotes.values()){
   let route='unbekannt';try{const stats=await (remote.pc as RTCPeerConnection).getStats();stats.forEach(report=>{if(report.type==='transport'&&report.selectedCandidatePairId){const pair=stats.get(report.selectedCandidatePairId),local=pair&&stats.get(pair.localCandidateId),other=pair&&stats.get(pair.remoteCandidateId);route=`${local?.candidateType??'?'} / ${other?.candidateType??'?'} · ${[local?.candidateType,other?.candidateType].includes('relay')?'relay':'direct'}`;}});}catch{/* Optional browser capability. */}
   const config=(remote.pc as RTCPeerConnection).getConfiguration?.();const turn=config?.iceServers?.some(s=>(typeof s.urls==='string'?[s.urls]:s.urls).some(url=>/^turns?:/.test(url)))??false;
   const t=this.transports.get(remote.id);lines.push(`${this.remoteToId.has(remote.id)?'APPROVED':'PENDING'} · ICE ${remote.pc.iceConnectionState} · PC ${remote.pc.connectionState} · DataChannel ${t?.channel.readyState??'closed'} · ${route} · TURN konfiguriert: ${turn?'ja':'nein'} · Transfers ${t?.active??0}`);
  }return lines.join('\n');
 }
 private async close(){if(this.closed)return;this.closed=true;this.generation++;this.lifetime.abort();clearInterval(this.health);
  if(typeof window!=='undefined'){window.removeEventListener('online',this.wake);window.removeEventListener('offline',this.offline);window.removeEventListener('pageshow',this.wake);document.removeEventListener('visibilitychange',this.visible);}
  for(const id of this.transports.keys())this.dropTransport(id);this.transports.clear();for(const fn of this.detach.values())fn();this.detach.clear();for(const p of this.pending.values())p.reject();this.pending.clear();this.records.clear();this.remotes.clear();this.remoteToId.clear();this.blocked.clear();this.inboundRate.clear();await this.peer.close();
 }
}
function optionsStatus(options:LobbyOptions,status:string){options.onStatus?.(status);}
