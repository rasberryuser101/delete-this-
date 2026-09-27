import { expect,it,vi,afterEach } from 'vitest';
import { PhotoChannel,parseTransfer,waitForBuffer,CHUNK_BYTES } from '../src/photoChannel';
import { channelPair,FakeChannel } from './fakeChannel';
const meta={version:2 as const,id:'photo',roundId:'round',bytes:7,mime:'image/jpeg' as const};
const start=(transferId=crypto.randomUUID())=>({type:'TRANSFER_START',transferId,totalBytes:7,totalChunks:1,mimeType:'image/jpeg',visibility:'PRIVATE',metadata:meta});
afterEach(()=>vi.useRealTimers());
it('verwirft oversized, falsche MIME, ungültige IDs und unplausible Chunkzahl',()=>{
 const valid=start();expect(parseTransfer(JSON.stringify(valid))).not.toBeNull();
 for(const changed of [{totalBytes:1000001,metadata:{...meta,bytes:1000001}},{mimeType:'image/png'},{transferId:'x'},{totalChunks:2}])expect(parseTransfer(JSON.stringify({...valid,...changed}))).toBeNull();
});
it('wartet auf bufferedamountlow und entfernt Listener bei Abbruch',async()=>{
 const c=new FakeChannel();c.bufferedAmount=300000;const signal=new AbortController(),done=vi.fn();const task=waitForBuffer(c.asRTC(),signal.signal).then(done);await Promise.resolve();expect(done).not.toHaveBeenCalled();c.bufferedAmount=0;c.dispatchEvent(new Event('bufferedamountlow'));await task;expect(done).toHaveBeenCalledOnce();
 c.bufferedAmount=300000;const cancel=waitForBuffer(c.asRTC(),signal.signal);signal.abort();await expect(cancel).rejects.toThrow();
});
it('weist Unbekannte vor dem Anlegen eines Bildbuffers ab',async()=>{
 const {a,b}=channelPair(),receive=vi.fn();const p=new PhotoChannel(a.asRTC(),'unknown',()=>false,receive,'PUBLIC');b.send(JSON.stringify(start()));await Promise.resolve();expect(p.active).toBe(0);expect(receive).not.toHaveBeenCalled();expect(a.sent.some(v=>typeof v==='string'&&v.includes('TRANSFER_CANCEL'))).toBe(true);p.close();
});
it('begrenzt parallele Uploads, verwirft fehlerhafte Chunks und räumt auf',async()=>{
 const {a,b}=channelPair(),receive=vi.fn();const p=new PhotoChannel(a.asRTC(),'guest',()=>true,receive,'PUBLIC');
 b.send(JSON.stringify(start()));b.send(JSON.stringify(start()));await Promise.resolve();expect(p.active).toBe(1);p.clear();expect(p.active).toBe(0);
 b.send(new ArrayBuffer(CHUNK_BYTES+41));await vi.waitFor(()=>expect(a.readyState).toBe('closed'));expect(receive).not.toHaveBeenCalled();
});
it('schließt abgebrochene Transfers ohne zurückbleibende Bildreferenzen',async()=>{
 const {a,b}=channelPair();const p=new PhotoChannel(a.asRTC(),'guest',()=>true,async()=>{throw new Error();},'PUBLIC');const id=crypto.randomUUID();b.send(JSON.stringify(start(id)));await Promise.resolve();expect(p.active).toBe(1);b.send(JSON.stringify({type:'TRANSFER_CANCEL',transferId:id}));await Promise.resolve();expect(p.active).toBe(0);p.close();
});
it('beendet hängende eingehende Transfers nach 30 Sekunden',async()=>{
 vi.useFakeTimers();const {a,b}=channelPair();const p=new PhotoChannel(a.asRTC(),'guest',()=>true,async()=>{throw new Error();},'PUBLIC');b.send(JSON.stringify(start()));await Promise.resolve();expect(p.active).toBe(1);await vi.advanceTimersByTimeAsync(30000);expect(p.active).toBe(0);p.close();expect(vi.getTimerCount()).toBe(0);
});
