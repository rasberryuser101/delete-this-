import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LobbyOptions, LobbySession } from '../src/room';
import { GameController } from '../src/controller';
import { receivePhoto } from '../src/transfer';

const jpeg = new Blob([new Uint8Array([255,216,255,1,2,3,4])],{type:'image/jpeg'});
const flush = async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
/** Models separate devices, including Trystero's actual Uint8Array receive type. */
function network() {
  const nodes:{options:LobbyOptions;session:LobbySession;active:Set<string>}[]=[];
  let dropPhotoAck=false;
  const session=(options:LobbyOptions):LobbySession=>{
    const id=`device-${nodes.length}`;const active=new Set<string>();
    const control={onRequest:null,onReceiveProgress:null,request:async(data:string,{target}: {target:string})=>{
      const peer=nodes.find(n=>n.session.selfId===target);
      if(!peer||!active.has(target))throw new Error('disconnected');
      return await peer.session.control.onRequest!(data,{peerId:id,signal:new AbortController().signal});
    }};
    const photo={onRequest:null,onReceiveProgress:null,request:async(data:Uint8Array,opts:{target:string;metadata:unknown;onProgress?:(n:number)=>void})=>{
      const peer=nodes.find(n=>n.session.selfId===opts.target);
      if(!peer||!active.has(opts.target))throw new Error('disconnected');
      opts.onProgress?.(.5);
      const ack=await peer.session.photo.onRequest!(Uint8Array.from(data),{peerId:id,metadata:opts.metadata as never,signal:new AbortController().signal});
      if(dropPhotoAck){dropPhotoAck=false;throw new Error('response lost');}
      return ack;
    }};
    const room={onPeerJoin:null,onPeerLeave:null,getPeers:()=>Object.fromEntries([...active].map(peer=>[peer,{close:()=>disconnect(id,peer)}])),leave:async()=>{for(const peer of [...active])disconnect(id,peer);}};
    const result={selfId:id,control,photo,room,relayCount:()=>2} as unknown as LobbySession;
    nodes.push({options,session:result,active});
    if(options.role==='guest')queueMicrotask(()=>{
      const host=nodes.find(n=>n.options.role==='host'&&n.options.code===options.code);if(!host)return;
      void (async()=>{
        await options.authorize?.(host.session.selfId,{version:3,role:'host'});
        options.onStage?.('approval',host.session.selfId);
        await host.options.authorize?.(id,{version:3,role:'guest',name:options.name});
        active.add(host.session.selfId);host.active.add(id);
        host.session.room.onPeerJoin?.(id);result.room.onPeerJoin?.(host.session.selfId);
      })().catch(()=>options.onJoinError?.(host.session.selfId,'Der Host hat die Anfrage abgelehnt.'));
    });
    return result;
  };
  const disconnect=(a:string,b:string)=>{
    const left=nodes.find(n=>n.session.selfId===a)!,right=nodes.find(n=>n.session.selfId===b)!;
    left.active.delete(b);right.active.delete(a);left.session.room.onPeerLeave?.(b);right.session.room.onPeerLeave?.(a);
  };
  return {session,nodes,loseAck:()=>{dropPhotoAck=true;},disconnect};
}
const controllers:GameController[]=[];
function create(net:ReturnType<typeof network>, process:()=>Promise<Blob>=async()=>jpeg){const c=new GameController({session:net.session,process,receive:(data,meta)=>receivePhoto(data,meta,async()=>{}),sound:()=>{}});controllers.push(c);return c;}
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{controllers.splice(0).forEach(c=>c.leave());vi.useRealTimers();});
async function pair(mode:'party'|'remote'='remote') {
  const net=network(),host=create(net),guest=create(net);await host.create('Host',mode);
  const join=guest.join('Gast',host.snapshot().roomCode);await flush();
  expect(guest.snapshot().stage).toBe('approval');expect(host.snapshot().game?.players).toHaveLength(1);expect(guest.snapshot().game).toBeNull();
  host.approve(host.snapshot().requests[0].id,true);await join;await flush();
  return {host,guest,net};
}
describe('Mehrgeräte-Spielablauf mit Empfangsbestätigungen',()=>{
  it.each(['party','remote'] as const)('spielt eine vollständige %s-Runde, Countdown, Punkte und Cleanup',async mode=>{
    const {host,guest}=await pair(mode);
    host.begin(['Roast']);await flush();expect(guest.snapshot().countdown).toBe(3);
    await vi.advanceTimersByTimeAsync(3000);await flush();
    expect(guest.snapshot().game?.phase).toBe('submit');
    await guest.submit(new File(['original'],'photo.jpg',{type:'image/jpeg'}));await flush();
    expect(host.snapshot().game?.photos).toHaveLength(1);expect(guest.snapshot().progress).toBe(100);
    await host.submit(new File(['original'],'photo.jpg',{type:'image/jpeg'}));await flush();
    expect(guest.snapshot().game?.phase).toBe('vote');
    expect(Object.keys(guest.snapshot().images)).toHaveLength(mode==='remote'?2:0);
    const photos=host.snapshot().game!.photos;
    await host.vote(photos.find(p=>p.ownerId!=='host')!.id);
    await guest.vote(photos.find(p=>p.ownerId==='host')!.id);await flush();
    expect(host.snapshot().game?.phase).toBe('result');expect(guest.snapshot().game?.phase).toBe('result');
    expect(host.snapshot().game!.players.reduce((s,p)=>s+p.score,0)).toBe(1);
    expect(host.snapshot().images).toEqual({});expect(guest.snapshot().images).toEqual({});
    host.begin(['Normal']);await vi.advanceTimersByTimeAsync(3000);expect(guest.snapshot().game?.round).toBe(2);
  });
  it('wiederholt bei verlorener Foto-Bestätigung ohne doppelte Einreichung',async()=>{
    const {host,guest,net}=await pair();host.begin(['Normal']);await vi.advanceTimersByTimeAsync(3000);
    net.loseAck();await guest.submit(new File(['x'],'test.jpg',{type:'image/jpeg'}));await flush();
    expect(host.snapshot().game?.photos).toHaveLength(1);expect(guest.snapshot().progress).toBe(100);expect(guest.snapshot().error).toBe('');
  });
  it('lehnt Fremde ab, bevor sie einen Spielstand oder Fotos erhalten',async()=>{
    const net=network(),host=create(net),guest=create(net);await host.create('Host','remote');
    const joining=guest.join('Fremder',host.snapshot().roomCode);await flush();
    const id=host.snapshot().requests[0].id;host.approve(id,false);await joining;
    expect(guest.snapshot().game).toBeNull();expect(guest.snapshot().error).toContain('abgelehnt');expect(host.snapshot().game?.players).toHaveLength(1);
    await expect(net.nodes[0].session.control.onRequest!('{"type":"ready"}',{peerId:id,signal:new AbortController().signal})).rejects.toThrow('Nicht freigegeben');
  });
  it('räumt abgebrochene Beitritte auf und entfernt die Suchmeldung',async()=>{
    const net=network(),guest=create(net);const pending=guest.join('Gast','ABCDEFGH23');await flush();
    guest.leave();await pending;expect(guest.snapshot().busy).toBe(false);expect(guest.snapshot().status).toBe('');expect(guest.snapshot().role).toBeNull();
  });
  it('beendet nicht gefundene Lobbys nach einem messbaren Timeout',async()=>{
    const guest=create(network());const pending=guest.join('Gast','ABCDEFGH23');await vi.advanceTimersByTimeAsync(30000);await pending;
    expect(guest.snapshot().stage).toBe('error');expect(guest.snapshot().status).toBe('');expect(guest.snapshot().error).toContain('Lobby nicht gefunden');
  });
  it('speichert keine nach dem Verlassen fertig verarbeiteten Fotos',async()=>{
    const net=network();let done!:(blob:Blob)=>void;
    const host=create(net,()=>new Promise(resolve=>{done=resolve;})),guest=create(net);await host.create('Host','remote');
    const pending=guest.join('Gast',host.snapshot().roomCode);await flush();host.approve(host.snapshot().requests[0].id,true);await pending;
    host.begin(['Normal']);await vi.advanceTimersByTimeAsync(3000);
    const submit=host.submit(new File(['x'],'x.jpg',{type:'image/jpeg'}));host.leave();done(jpeg);await submit;
    expect(host.snapshot().images).toEqual({});expect(host.snapshot().game).toBeNull();
  });
});
