import { afterEach,expect,it,vi } from 'vitest';
import type { MeteredPeer,RemotePeer } from '@metered-ca/realtime';
import { MeteredLobby,sendControl,type LobbyOptions } from '../src/room';
import { makeIdentity } from '../src/identity';
import { decodeMessage } from '../src/protocol';
import { createGame } from '../src/game';
import { FakeChannel,channelPair } from './fakeChannel';

class Emitter {
 events=new Map<string,Set<(data:never)=>void>>();
 on(name:string,fn:(data:never)=>void){const set=this.events.get(name)??new Set();set.add(fn);this.events.set(name,set);}
 off(name:string,fn:(data:never)=>void){this.events.get(name)?.delete(fn);}
 emit(name:string,data:unknown){this.events.get(name)?.forEach(fn=>fn(data as never));}
}
class Remote extends Emitter {
 pc=this.makePC();other!:Remote;channels:FakeChannel[]=[];generation=0;
 constructor(readonly id:string,readonly polite:boolean){super();}
 private makePC(){return {connectionState:'connected',iceConnectionState:'connected',createDataChannel:(_label:string,opts:RTCDataChannelInit)=>{
  expect(opts.ordered).toBe(true);const {a,b}=channelPair();this.channels.push(a);this.other.channels.push(b);
  a.readyState=b.readyState='connecting';queueMicrotask(()=>{this.other.emit('data-channel',{channel:b.asRTC()});a.readyState=b.readyState='open';a.dispatchEvent(new Event('open'));b.dispatchEvent(new Event('open'));});return a.asRTC();},getStats:async()=>new Map(),restartIce:vi.fn(),close:()=>{for(const c of this.channels)c.close();}};}
 reset(){this.generation++;this.pc=this.makePC();this.emit('connection-reset',{});}
 asSDK(){return this as unknown as RemotePeer;}
}
class Peer extends Emitter {
 state='idle';peerId:string;channel='';remotePeers:Remote[]=[];
 constructor(private bus:Bus){super();this.peerId=`peer-${bus.next++}`;}
 async join(channel:string){this.channel=channel;this.state='joined';this.bus.peers.push(this);this.emit('state-change',{to:'joined',from:'idle'});
  queueMicrotask(()=>{for(const other of this.bus.peers){if(other===this||other.channel!==channel||other.state!=='joined')continue;const a=new Remote(other.peerId,this.peerId>other.peerId),b=new Remote(this.peerId,other.peerId>this.peerId);a.other=b;b.other=a;this.remotePeers.push(a);other.remotePeers.push(b);this.emit('peer-joined',{peer:a.asSDK()});other.emit('peer-joined',{peer:b.asSDK()});}});
 }
 async sendTo(id:string,data:unknown){this.bus.messages.push(data);const dest=this.bus.peers.find(p=>p.peerId===id&&p.state==='joined');if(!dest)throw new Error('offline');queueMicrotask(()=>dest.emit('data',{senderPeerId:this.peerId,data,kind:'direct'}));}
 async close(){if(this.state==='closed')return;this.state='closed';for(const p of this.bus.peers){const r=p.remotePeers.find(r=>r.id===this.peerId);if(r){p.remotePeers=p.remotePeers.filter(x=>x!==r);p.emit('peer-left',{peer:r.asSDK()});}}}
 asSDK(){return this as unknown as MeteredPeer;}
}
class Bus {next=0;peers:Peer[]=[];messages:unknown[]=[];factory=()=>new Peer(this).asSDK();}
const sessions:MeteredLobby[]=[];
afterEach(async()=>{await Promise.all(sessions.splice(0).map(s=>s.session.room.leave()));vi.useRealTimers();});
async function lobby(bus:Bus,options:LobbyOptions){const id=options.role==='HOST'?'host':crypto.randomUUID();const l=new MeteredLobby(options,await makeIdentity(id),bus.factory);sessions.push(l);await l.start();return l;}
const code='ABCDEFGH23';
async function pair(role:'PLAYER'|'DISPLAY'='PLAYER'){
 const bus=new Bus(),authorize=vi.fn(async()=>{});const host=await lobby(bus,{code,role:'HOST',authorize,canPhoto:()=>true});
 const hostJoin=vi.fn();host.session.room.onPeerJoin=hostJoin;
 const guest=await lobby(bus,{code,role,name:'Chris',authorize:async()=>{},canPhoto:()=>true});
 await vi.waitFor(()=>expect(hostJoin).toHaveBeenCalled());
 return {bus,host,guest,authorize,hostJoin};
}
it('erstellt game-Code, bestätigt Spieler und nutzt nur einen Fotokanal pro Paar',async()=>{
 const {bus,host,guest,authorize}=await pair();expect(bus.peers.map(p=>p.channel)).toEqual([`game-${code}`,`game-${code}`]);expect(authorize).toHaveBeenCalledWith(guest.session.selfId,expect.objectContaining({role:'PLAYER'}));
 expect(bus.peers[0].remotePeers[0].channels).toHaveLength(1);expect(bus.peers[1].remotePeers[0].channels).toHaveLength(1);
 const receive=vi.fn(async()=>({ok:true as const}));host.session.control.onRequest=receive;
 await guest.session.control.request('{"type":"ready"}',{target:'host'});expect(receive).toHaveBeenCalledWith('{"type":"ready"}',expect.objectContaining({peerId:guest.session.selfId}));
});
it('lehnt einen Peer vor Foto-Channels und Spielstand ab',async()=>{
 const bus=new Bus(),denied=vi.fn();await lobby(bus,{code,role:'HOST',authorize:async()=>{throw new Error('deny');}});await lobby(bus,{code,role:'PLAYER',name:'Unknown',onJoinError:denied});
 await vi.waitFor(()=>expect(denied).toHaveBeenCalled());expect(bus.peers[0].remotePeers[0].channels).toHaveLength(0);expect(bus.messages.some(v=>(v as {type:string}).type==='CONTROL')).toBe(false);
});
it('erkennt gleiche Spieleridentität mit neuer Metered-Peer-ID ohne erneute Freigabe',async()=>{
 const {guest,authorize,hostJoin,bus}=await pair();const id=guest.session.selfId;await guest.session.recover!();await vi.waitFor(()=>expect(hostJoin).toHaveBeenCalledTimes(2));expect(guest.session.selfId).toBe(id);expect(authorize).toHaveBeenCalledTimes(1);expect(bus.peers.filter(p=>p.state==='joined')[1].peerId).toBe('peer-2');
});
it('ersetzt beim connection-reset das PC-Objekt und räumt alten Fotokanal auf',async()=>{
 const {bus,hostJoin}=await pair();const remote=bus.peers[0].remotePeers[0],other=remote.other,old=remote.channels[0],oldPC=remote.pc;
 // Both SDK peers replace the underlying PC before the queued new datachannel event.
 remote.reset();other.reset();await vi.waitFor(()=>expect(hostJoin).toHaveBeenCalledTimes(2));expect(remote.pc).not.toBe(oldPC);expect(old.readyState).toBe('closed');expect(remote.channels).toHaveLength(2);expect(remote.channels[1].readyState).toBe('open');
});
it('meldet Display-Rolle dem Host zur ausdrücklichen Freigabe',async()=>{const {authorize}=await pair('DISPLAY');expect(authorize).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({role:'DISPLAY'}));});
it('lässt keinen Foto-Payload über Metered Messaging zu, auch nicht versteckt in sync',async()=>{
 const peer={sendTo:vi.fn(async()=>{})};
 const bad=[{type:'PHOTO_CHUNK',bytes:new Uint8Array(16)},{type:'CONTROL',requestId:'x',message:{type:'ready',image:'data:image/jpeg;base64,a'}},{type:'CONTROL',requestId:'x',message:{type:'sync',you:'host',game:{...createGame('H','PARTY'),image:new Uint8Array(4)}}}];
 for(const msg of bad)await expect(sendControl(peer,'peer',msg as never)).rejects.toThrow();expect(peer.sendTo).not.toHaveBeenCalled();
});
it('transportiert Fotobytes nur auf dem RTC-Kanal; Messaging enthält lediglich Kontrolltypen',async()=>{
 const {host,guest,bus}=await pair();const bytes=new Uint8Array([255,216,255,1]);const meta={version:2 as const,id:'photo',roundId:'round',bytes:4,mime:'image/jpeg' as const};
 host.session.photo.onRequest=async(data)=>{expect(data).toEqual(bytes);return {ok:true,id:'photo',roundId:'round'};};
 await guest.session.photo.request(bytes,{target:'host',metadata:meta});expect(bus.messages.every(v=>!JSON.stringify(v).includes('PHOTO')&&!JSON.stringify(v).includes('TRANSFER'))).toBe(true);
});
it('isoliert unterschiedliche Lobbycodes',async()=>{
 const bus=new Bus(),auth=vi.fn();await lobby(bus,{code,role:'HOST',authorize:auth});await lobby(bus,{code:'ABCDEFGH24',role:'PLAYER',name:'Fremd'});await new Promise(r=>setTimeout(r,30));expect(auth).not.toHaveBeenCalled();expect(bus.messages).toEqual([]);
});
it('verwirft zusätzliche Felder auch beim eingehenden Control-Payload',()=>{expect(decodeMessage('{"type":"ready","bytes":[1,2,3]}')).toBeNull();});
it('verbindet einen Einladungslink nur mit dem darin angegebenen Host-Schlüssel',async()=>{
 const bus=new Bus(),rogueAuth=vi.fn(async()=>{}),realAuth=vi.fn(async()=>{});
 await lobby(bus,{code,role:'HOST',authorize:rogueAuth});const host=await lobby(bus,{code,role:'HOST',authorize:realAuth});
 const guest=await lobby(bus,{code,role:'PLAYER',name:'Chris',expectedHostKey:host.session.publicKey});
 await vi.waitFor(()=>expect(realAuth).toHaveBeenCalled());expect(rogueAuth).not.toHaveBeenCalled();expect(guest.session.room.getPeers()).toHaveProperty('host');
});
it('eine gestohlene playerId samt anderer Signatur gibt keinen automatischen Zugriff',async()=>{
 const {bus,host,guest,authorize}=await pair();const spoofed=await makeIdentity(guest.session.selfId),deny=vi.fn();
 const attacker=new MeteredLobby({code,role:'PLAYER',name:'Chris',onJoinError:deny},spoofed,bus.factory);sessions.push(attacker);await attacker.start();
 await vi.waitFor(()=>expect(deny).toHaveBeenCalled());expect(authorize).toHaveBeenCalledTimes(1);expect(Object.keys(host.session.room.getPeers())).toHaveLength(1);
});
it('erholt auch den Host mit neuer Peer-ID und vertauschter polite-Seite',async()=>{
 const {host,guest,hostJoin,authorize,bus}=await pair();await host.session.recover!();await vi.waitFor(()=>expect(hostJoin).toHaveBeenCalledTimes(2));expect(authorize).toHaveBeenCalledTimes(1);
 const receive=vi.fn(async()=>({ok:true as const}));host.session.control.onRequest=receive;await guest.session.control.request('{"type":"ready"}',{target:'host'});expect(receive).toHaveBeenCalled();expect(bus.peers.filter(p=>p.state==='joined')).toHaveLength(2);
});
it('Display-Reload benötigt neue Freigabe, ohne eine andere Identität vorzutäuschen',async()=>{
 const {guest,bus,authorize,hostJoin}=await pair('DISPLAY');const id=guest.session.selfId;await guest.session.room.leave();
 const replacement=new MeteredLobby({code,role:'DISPLAY',name:'TV'},await makeIdentity(id),bus.factory);sessions.push(replacement);await replacement.start();
 await vi.waitFor(()=>expect(hostJoin).toHaveBeenCalledTimes(2));expect(authorize).toHaveBeenCalledTimes(2);expect(replacement.session.selfId).toBe(id);
});

it('ein fehlender Gast startet die gesunden Verbindungen des Hosts nicht neu',async()=>{
 vi.useFakeTimers();const {bus,guest}=await pair();const another=await lobby(bus,{code,role:'PLAYER',name:'Noch jemand'});
 await vi.waitFor(()=>expect(Object.keys(another.session.room.getPeers())).toHaveLength(1));await guest.session.room.leave();
 const peersCreated=bus.next;await vi.advanceTimersByTimeAsync(65000);expect(bus.next).toBe(peersCreated);expect(bus.peers.filter(p=>p.state==='joined')).toHaveLength(2);
});
