import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LobbyOptions, LobbySession } from '../src/room';
import { GameController } from '../src/controller';
import { receivePhoto } from '../src/transfer';

const jpeg = new Blob([new Uint8Array([255,216,255,1,2,3,4])],{type:'image/jpeg'});
const flush = async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
/** Models separate devices, including the RTC channel's Uint8Array receive type. */
function network() {
  const nodes:{options:LobbyOptions;session:LobbySession;active:Set<string>}[]=[];
  let dropPhotoAck=false;let blockHostPhotos=false;
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
      if(blockHostPhotos&&id==='device-0')throw new Error('blocked image route');
      opts.onProgress?.(.5);
      const ack=await peer.session.photo.onRequest!(Uint8Array.from(data),{peerId:id,metadata:opts.metadata as never,signal:new AbortController().signal});
      if(dropPhotoAck){dropPhotoAck=false;throw new Error('response lost');}
      return ack;
    }};
    const room={onPeerJoin:null,onPeerLeave:null,getPeers:()=>Object.fromEntries([...active].map(peer=>[peer,{close:()=>disconnect(id,peer)}])),leave:async()=>{for(const peer of [...active])disconnect(id,peer);}};
    const result={selfId:id,control,photo,room,relayCount:()=>2} as unknown as LobbySession;
    nodes.push({options,session:result,active});
    if(options.role!=='HOST')queueMicrotask(()=>{
      const host=nodes.find(n=>n.options.role==='HOST'&&n.options.code===options.code);if(!host)return;
      void (async()=>{
        await options.authorize?.(host.session.selfId,{version:5,role:'HOST'});
        options.onStage?.('approval',host.session.selfId);
        await host.options.authorize?.(id,{version:5,role:options.role,name:options.name});
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
  const reconnect=(a:string,b:string)=>{const left=nodes.find(n=>n.session.selfId===a)!,right=nodes.find(n=>n.session.selfId===b)!;left.active.add(b);right.active.add(a);left.session.room.onPeerJoin?.(b);right.session.room.onPeerJoin?.(a);};
  return {session,nodes,reconnect,blockHostPhotos:(v:boolean)=>{blockHostPhotos=v;},loseAck:()=>{dropPhotoAck=true;},disconnect};
}
const controllers:GameController[]=[];
function create(net:ReturnType<typeof network>, process:()=>Promise<Blob>=async()=>jpeg){const c=new GameController({session:net.session,process,receive:(data,meta)=>receivePhoto(data,meta,async()=>{}),sound:()=>{}});controllers.push(c);return c;}
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{controllers.splice(0).forEach(c=>c.leave());vi.useRealTimers();});
async function pair(mode:'PARTY'|'REMOTE'='REMOTE') {
  const net=network(),host=create(net),guest=create(net);await host.create('Host',mode);
  const join=guest.join('Gast',host.snapshot().roomCode);await flush();
  expect(guest.snapshot().stage).toBe('approval');expect(host.snapshot().game?.players).toHaveLength(1);expect(guest.snapshot().game).toBeNull();
  host.approve(host.snapshot().requests[0].id,true);await join;await flush();
  return {host,guest,net};
}
describe('Mehrgeräte-Spielablauf mit Empfangsbestätigungen',()=>{
  it('wartet bei blockierten Remote-Fotos und öffnet Voting erst nach bestätigtem Empfang',async()=>{
    const {host,guest,net}=await pair();host.begin(['Normal']);await vi.advanceTimersByTimeAsync(3000);
    await guest.submit(new File(['x'],'guest.jpg',{type:'image/jpeg'}));await host.submit(new File(['x'],'host.jpg',{type:'image/jpeg'}));
    net.blockHostPhotos(true);await host.advanceReveal();await flush();
    expect(host.snapshot().game?.revealIndex).toBe(0);expect(guest.snapshot().images).toEqual({});
    await host.advanceReveal();expect(host.snapshot().game?.revealIndex).toBe(0);expect(host.snapshot().game?.phase).toBe('reveal');
    await guest.vote(host.snapshot().game!.photos[0].id);expect(host.snapshot().game?.votes).toEqual({});
    net.blockHostPhotos(false);await host.advanceReveal();await flush();expect(host.snapshot().game?.revealIndex).toBe(1);
    expect(Object.keys(guest.snapshot().images)).toHaveLength(2);
    await host.advanceReveal();expect(host.snapshot().game?.phase).toBe('vote');
  });
  it('verweigert fremde Fotos und Reaktionen und sendet Entfernten keine späteren Bilder',async()=>{
    const {host,guest,net}=await pair();host.begin(['Normal']);await vi.advanceTimersByTimeAsync(3000);
    const roundId=host.snapshot().game!.roundId;
    await expect(net.nodes[0].session.photo.onRequest!(new Uint8Array([255,216,255,1,2,3,4]),{peerId:'stranger',metadata:{version:2,id:'foreign',roundId,bytes:7,mime:'image/jpeg'},signal:new AbortController().signal})).rejects.toThrow('Nicht freigegeben');
    await guest.submit(new File(['x'],'guest.jpg',{type:'image/jpeg'}));await host.submit(new File(['x'],'host.jpg',{type:'image/jpeg'}));
    await expect(net.nodes[0].session.control.onRequest!(JSON.stringify({type:'reaction',emoji:'😂',roundId}),{peerId:'stranger',signal:new AbortController().signal})).rejects.toThrow('Nicht freigegeben');
    await expect(net.nodes[1].session.photo.onRequest!(new Uint8Array([255,216,255,1,2,3,4]),{peerId:'device-0',metadata:{version:2,id:host.snapshot().game!.photos[0].id,roundId,bytes:7,mime:'image/jpeg'},signal:new AbortController().signal})).rejects.toThrow('nicht erwartet');
    host.remove('device-1');await host.advanceReveal();expect(guest.snapshot().images).toEqual({});
    await expect(net.nodes[0].session.control.onRequest!('{"type":"ready"}',{peerId:'device-1',signal:new AbortController().signal})).rejects.toThrow('Nicht freigegeben');
  });
  it('teilt Reaktionen in der Lobby-Show, limitiert Spam und entfernt sie beim Verlassen',async()=>{
    const {host,guest,net}=await pair();host.begin(['Normal']);await vi.advanceTimersByTimeAsync(3000);
    await guest.react('😂');expect(host.snapshot().reaction).toBeNull();
    await guest.submit(new File(['x'],'guest.jpg',{type:'image/jpeg'}));await host.submit(new File(['x'],'host.jpg',{type:'image/jpeg'}));
    await guest.react('😂');await flush();expect(host.snapshot().reaction?.emoji).toBe('😂');expect(guest.snapshot().reaction?.emoji).toBe('😂');
    await guest.react('💀');expect(host.snapshot().reaction?.emoji).toBe('😂');
    await expect(net.nodes[0].session.control.onRequest!(JSON.stringify({type:'reaction',emoji:'😂',roundId:'another-round'}),{peerId:'device-1',signal:new AbortController().signal})).rejects.toThrow('aktuellen Show');
    host.leave();guest.leave();await vi.advanceTimersByTimeAsync(2000);expect(host.snapshot().reaction).toBeNull();expect(guest.snapshot().reaction).toBeNull();
  });
  it('gibt einer anderen Lobby auch nach dem Timeout keinen Spielstand',async()=>{
    const net=network(),host=create(net),guest=create(net);await host.create('Host','PARTY');
    const other=host.snapshot().roomCode==='ABCDEFGH23'?'ABCDEFGH24':'ABCDEFGH23';
    const joining=guest.join('Fremder',other);await vi.advanceTimersByTimeAsync(90000);await joining;
    expect(host.snapshot().requests).toEqual([]);expect(guest.snapshot().game).toBeNull();expect(guest.snapshot().images).toEqual({});
  });
  it.each(['PARTY','REMOTE'] as const)('spielt eine vollständige %s-Runde, Countdown, Punkte und Cleanup',async mode=>{
    const {host,guest}=await pair(mode);
    host.begin(['Roast']);await flush();expect(guest.snapshot().countdown).toBe(3);
    await vi.advanceTimersByTimeAsync(3000);await flush();
    expect(guest.snapshot().game?.phase).toBe('submit');
    await guest.submit(new File(['original'],'photo.jpg',{type:'image/jpeg'}));await flush();
    expect(host.snapshot().game?.photos).toHaveLength(1);expect(guest.snapshot().progress).toBe(100);
    await host.submit(new File(['original'],'photo.jpg',{type:'image/jpeg'}));await flush();
    expect(guest.snapshot().game?.phase).toBe('reveal');
    expect(guest.snapshot().images).toEqual({});expect(host.snapshot().game?.revealIndex).toBe(-1);
    await host.advanceReveal();await flush();expect(guest.snapshot().game?.revealIndex).toBe(0);
    expect(Object.keys(guest.snapshot().images)).toHaveLength(mode==='REMOTE'?1:0);
    await host.advanceReveal();await flush();expect(guest.snapshot().game?.revealIndex).toBe(1);
    await host.advanceReveal();await flush();expect(guest.snapshot().game?.phase).toBe('vote');
    expect(Object.keys(guest.snapshot().images)).toHaveLength(mode==='REMOTE'?2:0);
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
    const net=network(),host=create(net),guest=create(net);await host.create('Host','REMOTE');
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
    const guest=create(network());const pending=guest.join('Gast','ABCDEFGH23');await vi.advanceTimersByTimeAsync(90000);await pending;
    expect(guest.snapshot().stage).toBe('error');expect(guest.snapshot().status).toBe('');expect(guest.snapshot().error).toContain('Lobby nicht gefunden');
  });
  it('speichert keine nach dem Verlassen fertig verarbeiteten Fotos',async()=>{
    const net=network();let done!:(blob:Blob)=>void;
    const host=create(net,()=>new Promise(resolve=>{done=resolve;})),guest=create(net);await host.create('Host','REMOTE');
    const pending=guest.join('Gast',host.snapshot().roomCode);await flush();host.approve(host.snapshot().requests[0].id,true);await pending;
    host.begin(['Normal']);await vi.advanceTimersByTimeAsync(3000);
    const submit=host.submit(new File(['x'],'x.jpg',{type:'image/jpeg'}));host.leave();done(jpeg);await submit;
    expect(host.snapshot().images).toEqual({});expect(host.snapshot().game).toBeNull();
  });
});

it('Display wird separat bestätigt, erhält vor Reveal keine Fotos und kann weder voten noch einreichen',async()=>{
 const {host,guest,net}=await pair('PARTY');const display=create(net);
 const joining=display.join('Fernseher',host.snapshot().roomCode,'DISPLAY');await flush();
 expect(host.snapshot().requests[0].role).toBe('DISPLAY');expect(display.snapshot().game).toBeNull();
 host.approve(host.snapshot().requests[0].id,true);await joining;await flush();expect(host.snapshot().game?.players).toHaveLength(2);expect(display.snapshot().game?.players).toHaveLength(2);
 host.begin(['Normal']);await vi.advanceTimersByTimeAsync(3000);
 await display.submit(new File(['x'],'display.jpg',{type:'image/jpeg'}));expect(host.snapshot().game?.photos).toHaveLength(0);
 const roundId=host.snapshot().game!.roundId;
 await expect(net.nodes[0].session.photo.onRequest!(new Uint8Array([255,216,255,1,2,3,4]),{peerId:'device-2',metadata:{version:2,id:'x',roundId,bytes:7,mime:'image/jpeg'},signal:new AbortController().signal})).rejects.toThrow('Nicht freigegeben');
 await guest.submit(new File(['x'],'guest.jpg',{type:'image/jpeg'}));expect(display.snapshot().game?.photos).toEqual([]);expect(display.snapshot().images).toEqual({});
 await host.submit(new File(['x'],'host.jpg',{type:'image/jpeg'}));expect(display.snapshot().images).toEqual({});
 await host.advanceReveal();await flush();expect(Object.keys(display.snapshot().images)).toHaveLength(1);expect(display.snapshot().game?.photos).toHaveLength(1);expect(guest.snapshot().images).toEqual({});
 await host.advanceReveal();await host.advanceReveal();await flush();expect(display.snapshot().game?.phase).toBe('vote');
 const photoId=host.snapshot().game!.photos[0].id;
 await expect(net.nodes[0].session.control.onRequest!(JSON.stringify({type:'vote',roundId,photoId}),{peerId:'device-2',signal:new AbortController().signal})).rejects.toThrow('Display');
 await host.vote(host.snapshot().game!.photos.find(p=>p.ownerId!=='host')!.id);await guest.vote(host.snapshot().game!.photos.find(p=>p.ownerId==='host')!.id);await flush();
 expect(display.snapshot().game?.phase).toBe('result');expect(display.snapshot().game?.votes).toEqual({});expect(display.snapshot().images).toEqual({});
});
it('abgelehntes Display bekommt weder Snapshot noch Fotokanalzugriff',async()=>{
 const {host,net}=await pair('PARTY'),display=create(net);const joining=display.join('TV',host.snapshot().roomCode,'DISPLAY');await flush();host.approve(host.snapshot().requests[0].id,false);await joining;expect(display.snapshot().game).toBeNull();expect(display.snapshot().images).toEqual({});expect(host.snapshot().game?.players).toHaveLength(2);
});
it('hält getrennte Spieler länger als fünf Minuten und stellt Punkte sowie Submission wieder her',async()=>{
 const {host,guest,net}=await pair('REMOTE');host.begin(['Normal']);await vi.advanceTimersByTimeAsync(3000);await guest.submit(new File(['x'],'guest.jpg',{type:'image/jpeg'}));await host.submit(new File(['x'],'host.jpg',{type:'image/jpeg'}));await host.advanceReveal();await host.advanceReveal();await host.advanceReveal();
 await host.vote(host.snapshot().game!.photos.find(p=>p.ownerId!=='host')!.id);await guest.vote(host.snapshot().game!.photos.find(p=>p.ownerId==='host')!.id);await flush();
 const scores=host.snapshot().game!.players.map(p=>p.score);host.begin(['Normal']);await vi.advanceTimersByTimeAsync(3000);await guest.submit(new File(['x'],'guest.jpg',{type:'image/jpeg'}));
 net.disconnect('device-0','device-1');await vi.advanceTimersByTimeAsync(301000);expect(host.snapshot().game?.players).toHaveLength(2);expect(host.snapshot().game?.players[1].connected).toBe(false);
 net.reconnect('device-0','device-1');await flush();expect(host.snapshot().game?.players).toHaveLength(2);expect(host.snapshot().game?.players.map(p=>p.score)).toEqual(scores);expect(guest.snapshot().game?.photos.some(p=>p.ownerId==='device-1')).toBe(true);
});
it('verweigert Displays im Remote-Modus',async()=>{
 const {host,net}=await pair('REMOTE'),display=create(net);await display.join('TV',host.snapshot().roomCode,'DISPLAY');expect(display.snapshot().game).toBeNull();expect(host.snapshot().requests).toEqual([]);
});
