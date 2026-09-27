import { afterEach, expect, it, vi } from 'vitest';
import { parsePhotoMetadata, receivePhoto, transferPhoto, withDeadline, type PhotoAction } from '../src/transfer';
const meta={version:2 as const,id:'photo',roundId:'round',bytes:7,mime:'image/jpeg' as const};
const bytes=new Uint8Array([255,216,255,1,2,3,4]);
afterEach(()=>vi.useRealTimers());
it('akzeptiert Uint8Array und ArrayBuffer aus Trystero, erhält Bytes und MIME',async()=>{
  for(const data of [bytes,bytes.buffer,new DataView(bytes.buffer)]) {
    const decode=vi.fn(async()=>{});const blob=await receivePhoto(data,meta,decode);
    expect(blob.type).toBe('image/jpeg');expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);expect(decode).toHaveBeenCalledOnce();
  }
});
it('verwirft falsche Länge, Bildsignatur und zu große Metadaten',async()=>{
  expect(parsePhotoMetadata({...meta,bytes:450001})).toBeNull();
  await expect(receivePhoto(new Uint8Array(7),meta,async()=>{})).rejects.toThrow();
  await expect(receivePhoto(bytes.subarray(1),meta,async()=>{})).rejects.toThrow();
  await expect(receivePhoto('text',meta,async()=>{})).rejects.toThrow();
});
it('meldet eine Übertragung erst nach passender Bestätigung als erfolgreich',async()=>{
  const request=vi.fn(async()=>({ok:true,id:'different',roundId:'round'}));const progress=vi.fn();
  await expect(transferPhoto({request} as unknown as PhotoAction,'host',new Blob([bytes],{type:'image/jpeg'}),meta,new AbortController().signal,progress)).rejects.toThrow('bestätigt');
  expect(progress).not.toHaveBeenCalledWith(100);expect(request).toHaveBeenCalledTimes(2);
});
it('begrenzt auch einen hängenden Send-Vorgang und unterstützt Cleanup per Abort',async()=>{
  vi.useFakeTimers();const aborted=vi.fn();
  const task=withDeadline(s=>{s.addEventListener('abort',aborted);return new Promise(()=>{});},500).catch(e=>e);
  await vi.advanceTimersByTimeAsync(500);expect(await task).toBeInstanceOf(Error);expect(aborted).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
