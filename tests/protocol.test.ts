import { describe, expect, it } from 'vitest';
import { ImageReceiver, decodeMessage, sendImage, validateMessage, MAX_WIRE_BYTES } from '../src/protocol';
import { isSafeImage, MAX_EDGE, MAX_IMAGE_BYTES } from '../src/image';
describe('Bildgrenzen und Nachrichten',()=>{
  it('begrenzt die Kante und die zu übertragenden Bytes',()=>{
    expect(MAX_EDGE).toBe(1280); expect(MAX_IMAGE_BYTES).toBeLessThanOrEqual(450_000);
    expect(isSafeImage(new Uint8Array([0xff,0xd8,0xff]),'image/jpeg')).toBe(true);
    expect(isSafeImage(new Uint8Array(MAX_IMAGE_BYTES+1),'image/jpeg')).toBe(false);
  });
  it('verwirft ungültige WebRTC-Nachrichten und zu große Bilder',()=>{
    expect(decodeMessage('{kaputt')).toBeNull(); expect(decodeMessage('x'.repeat(32_001))).toBeNull();
    expect(validateMessage({type:'vote',photoId:'a',roundId:'b'})).not.toBeNull();
    expect(validateMessage({type:'vote',photoId:'<script>',roundId:'b'})).toBeNull();
    expect(validateMessage({type:'photo-begin',id:'a',roundId:'b',bytes:MAX_WIRE_BYTES+1,mime:'image/jpeg'})).toBeNull();
    expect(validateMessage({type:'photo-begin',id:'a',roundId:'b',bytes:15,mime:'image/svg+xml'})).toBeNull();
  });
  it('sendet ein Foto stückweise über den RTCDataChannel und setzt es wieder zusammen',async()=>{
    const sent:(string|ArrayBuffer)[]=[];
    const channel={readyState:'open',bufferedAmount:0,send:(data:string|Uint8Array)=>sent.push(typeof data==='string'?data:Uint8Array.from(data).buffer as ArrayBuffer)} as unknown as RTCDataChannel;
    const bytes=new Uint8Array(70_000); bytes.set([0xff,0xd8,0xff]);
    await sendImage(channel,'foto','runde',new Blob([bytes],{type:'image/jpeg'}));
    expect(sent.length).toBeGreaterThan(5);
    const receiver=new ImageReceiver();
    const start=decodeMessage(sent[0] as string); expect(start?.type).toBe('photo-begin');
    if(start?.type!=='photo-begin') throw new Error('Startnachricht fehlt');
    expect(receiver.begin(start)).toBe(true);
    for(const chunk of sent.slice(1,-1)) expect(receiver.push(chunk as ArrayBuffer)).toBe(true);
    const end=decodeMessage(sent.at(-1) as string); if(end?.type!=='photo-end') throw new Error('Endnachricht fehlt');
    const result=receiver.finish(end); expect(result?.blob.size).toBe(70_000);
    expect(new Uint8Array(await result!.blob.arrayBuffer())).toEqual(bytes);
  });
  it('räumt unvollständige Bildpakete auf',()=>{
    const receiver=new ImageReceiver(); const begin={type:'photo-begin' as const,id:'x',roundId:'r',bytes:4,mime:'image/jpeg' as const};
    expect(receiver.begin(begin)).toBe(true); expect(receiver.push(new Uint8Array([0xff,0xd8]).buffer)).toBe(true);
    expect(receiver.finish({type:'photo-end',id:'x'})).toBeNull();
    expect(receiver.begin(begin)).toBe(true);
    expect(receiver.push(new Uint8Array([1,2,3,4,5]).buffer)).toBe(false);
    expect(receiver.begin(begin)).toBe(true); receiver.clear(); expect(receiver.begin(begin)).toBe(true);
  });

});
