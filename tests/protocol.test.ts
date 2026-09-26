import { describe, expect, it } from 'vitest';
import { ImageReceiver, decodeMessage, validateMessage, MAX_WIRE_BYTES } from '../src/protocol';
import { isSafeImage, MAX_EDGE, MAX_IMAGE_BYTES } from '../src/image';
import { decodeSignal, encodeSignal } from '../src/webrtc';
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
  it('räumt unvollständige Bildpakete auf',()=>{
    const receiver=new ImageReceiver(); const begin={type:'photo-begin' as const,id:'x',roundId:'r',bytes:4,mime:'image/jpeg' as const};
    expect(receiver.begin(begin)).toBe(true); expect(receiver.push(new Uint8Array([0xff,0xd8]).buffer)).toBe(true);
    expect(receiver.finish({type:'photo-end',id:'x'})).toBeNull();
    expect(receiver.begin(begin)).toBe(true);
    expect(receiver.push(new Uint8Array([1,2,3,4,5]).buffer)).toBe(false);
    expect(receiver.begin(begin)).toBe(true); receiver.clear(); expect(receiver.begin(begin)).toBe(true);
  });
  it('kodiert Signaling-Daten ohne Server und prüft Sitzungen',()=>{
    const signal={v:1 as const,kind:'offer' as const,session:'abcdefgh123',sdp:'v=0\r\n',stun:'stun:stun.l.google.com:19302'};
    expect(decodeSignal(encodeSignal(signal))).toEqual(signal);
    expect(()=>decodeSignal('DT1.keine')).toThrow();
  });
});
