import { afterEach, expect, it, vi } from 'vitest';
import { ControlChannel } from '../src/controlChannel';
class Channel extends EventTarget {
  readyState='open';bufferedAmount=0;bufferedAmountLowThreshold=0;
  sent:string[]=[];remote?:Channel;
  send(data:string){this.sent.push(data);queueMicrotask(()=>this.remote?.dispatchEvent(new MessageEvent('message',{data})));}
  close(){if(this.readyState==='closed')return;this.readyState='closed';this.dispatchEvent(new Event('close'));}
  incoming(data:unknown){this.dispatchEvent(new MessageEvent('message',{data}));}
}
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
const channels:ControlChannel[]=[];
afterEach(()=>{channels.splice(0).forEach(c=>c.close());vi.useRealTimers();});
function create(channel=new Channel(),receive=vi.fn().mockResolvedValue({ok:true}),permitted=()=>true,limit=240){
  const control=new ControlChannel(channel as unknown as RTCDataChannel,'peer',permitted,receive,limit);channels.push(control);return {channel,control,receive};
}
it('bestätigt Spielaktionen, verarbeitet doppelte IDs nur einmal und verwirft ungültige Pakete',async()=>{
  const a=create(),b=create();a.channel.remote=b.channel;b.channel.remote=a.channel;
  await a.control.request('{"type":"ready"}',{target:'peer'});
  const packet=a.channel.sent[0];b.channel.incoming(packet);await flush();expect(b.receive).toHaveBeenCalledTimes(1);
  b.channel.incoming('{"type":"CONTROL","requestId":"bad","message":{"type":"vote"},"ack":false}');
  b.channel.incoming('{"type":"OFFER","sdp":"tampered"}');await flush();expect(b.receive).toHaveBeenCalledTimes(1);
  expect(a.control.active).toBe(0);
});
it('sendet Reactions ohne App-Bestätigung, andere Aktionen benötigen weiter ACKs',async()=>{
  const a=create(),b=create();a.channel.remote=b.channel;b.channel.remote=a.channel;
  await a.control.request('{"type":"reaction","emoji":"😂","roundId":""}',{target:'peer',acknowledge:false});await flush();
  expect(b.receive).toHaveBeenCalledTimes(1);expect(b.channel.sent).toEqual([]);
  await expect(a.control.request('{"type":"ready"}',{target:'peer',acknowledge:false})).rejects.toThrow('Bestätigung');
});
it('bestätigt abgelehnte Aktionen nicht als erfolgreich',async()=>{
  const a=create(),b=create(new Channel(),vi.fn().mockRejectedValue(new Error('unauthorized')));a.channel.remote=b.channel;b.channel.remote=a.channel;
  await expect(a.control.request('{"type":"ready"}',{target:'peer'})).rejects.toThrow('abgelehnt');expect(a.control.active).toBe(0);
});
it('sperrt nicht freigegebene Geräte, Binärdaten, zu große Pakete und Spam',async()=>{
  const denied=create(new Channel(),vi.fn(),()=>false);denied.channel.incoming('{"type":"CONTROL","requestId":"x","message":{"type":"ready"}}');await flush();
  expect(denied.receive).not.toHaveBeenCalled();await expect(denied.control.request('{"type":"ready"}',{target:'peer'})).rejects.toThrow();
  for(const data of [new ArrayBuffer(10),'x'.repeat(32769)]){const c=create();c.channel.incoming(data);await flush();expect(c.channel.readyState).toBe('closed');}
  const spam=create(new Channel(),vi.fn(),()=>true,2);for(let i=0;i<3;i++)spam.channel.incoming('invalid');await flush();expect(spam.channel.readyState).toBe('closed');
});
it('begrenzt auch gleichzeitig wartende Sender und räumt Backpressure sowie ACK-Timer auf',async()=>{
  vi.useFakeTimers();const c=create();c.channel.bufferedAmount=400000;
  const pending=Array.from({length:64},()=>c.control.request('{"type":"ready"}',{target:'peer'}).catch(e=>e));
  await expect(c.control.request('{"type":"ready"}',{target:'peer'})).rejects.toThrow('nicht bereit');
  c.control.close();await Promise.all(pending);expect(c.control.active).toBe(0);expect(vi.getTimerCount()).toBe(0);
  const d=create();const action=d.control.request('{"type":"ready"}',{target:'peer'}).catch(e=>e);await flush();d.control.close();await action;expect(vi.getTimerCount()).toBe(0);
});
it('bricht eine unbeantwortete Aktion bei Ablauf ab und ignoriert ein verspätetes ACK',async()=>{
  vi.useFakeTimers();const c=create();const pending=c.control.request('{"type":"ready"}',{target:'peer',timeoutMs:100}).catch(e=>e);await flush();
  await vi.advanceTimersByTimeAsync(101);expect(await pending).toBeInstanceOf(Error);expect(c.control.active).toBe(0);
  const {requestId}=JSON.parse(c.channel.sent[0]);c.channel.incoming(JSON.stringify({type:'ACK',requestId,ok:true}));await flush();expect(c.control.active).toBe(0);
});
