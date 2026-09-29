import { afterEach, expect, it, vi } from 'vitest';
import { AdmissionGate, APPROVAL_MS } from '../src/admission';
afterEach(()=>vi.useRealTimers());
it('verlangt Freigabe, begrenzt die Warteschlange und räumt Timer auf',async()=>{
  vi.useFakeTimers();const changes=vi.fn();const gate=new AdmissionGate(changes);
  const pending=Array.from({length:12},(_,i)=>gate.request(`id${i}`,'Chris').catch(e=>e));
  await expect(gate.request('extra','Fremder')).rejects.toThrow();
  gate.decide('id0',true);expect(await pending[0]).toBeUndefined();
  gate.clear();await Promise.all(pending);expect(vi.getTimerCount()).toBe(0);expect(changes).toHaveBeenLastCalledWith([]);
});
it('lässt dasselbe Gerät nach Ablauf und Ablehnung erneut anfragen',async()=>{
  vi.useFakeTimers();const gate=new AdmissionGate(()=>{});const pending=gate.request('id','Gast').catch(e=>e);
  await vi.advanceTimersByTimeAsync(APPROVAL_MS);expect(await pending).toBeInstanceOf(Error);
  const retry=gate.request('id','Gast').catch(e=>e);gate.decide('id',false);expect(await retry).toBeInstanceOf(Error);
  const accepted=gate.request('id','Gast');gate.decide('id',true);await expect(accepted).resolves.toBeUndefined();gate.clear();
});
it('limitiert auch schnell wechselnde Peer-IDs auf zwölf Anfragen pro Minute',async()=>{
  const gate=new AdmissionGate(()=>{});
  for(let i=0;i<12;i++){const p=gate.request(`${i}`,'Gast').catch(e=>e);gate.decide(`${i}`,false);await p;}
  await expect(gate.request('new','Gast')).rejects.toThrow();gate.clear();
});
