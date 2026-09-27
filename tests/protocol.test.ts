import { describe, expect, it } from 'vitest';
import { decodeMessage, encodeMessage, validateMessage } from '../src/protocol';
import { isSafeImage, MAX_EDGE, MAX_IMAGE_BYTES } from '../src/image';
import { createGame } from '../src/game';
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
    expect(validateMessage({type:'photo-begin',id:'a',roundId:'b',bytes:15,mime:'image/jpeg'})).toBeNull();
    expect(validateMessage({type:'vote',photoId:'a',roundId:''})).toBeNull();
  });
  it('serialisiert nur validierte Kontrollnachrichten',()=>{
    const encoded=encodeMessage({type:'vote',photoId:'foto',roundId:'runde'});
    expect(decodeMessage(encoded)).toEqual({type:'vote',photoId:'foto',roundId:'runde'});
  });
  it('verwirft manipulierte Reveal-Indizes und fremde Reaktionswerte',()=>{
    const game=createGame('Host','party');
    expect(validateMessage({type:'sync',you:'host',game})).not.toBeNull();
    expect(validateMessage({type:'sync',you:'host',game:{...game,revealIndex:8}})).toBeNull();
    expect(validateMessage({type:'sync',you:'host',game:{...game,revealIndex:-2}})).toBeNull();
    expect(validateMessage({type:'reaction',emoji:'😂',roundId:'round'})).not.toBeNull();
    expect(validateMessage({type:'reaction',emoji:'<script>alert(1)</script>',roundId:'round'})).toBeNull();
  });
});
