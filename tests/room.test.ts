import { describe,expect,it } from 'vitest';
import { makeRoomCode,normalizeRoomCode,peerIdFor,peerOptions,roomLink } from '../src/room';
describe('Lobbycodes',()=>{
  it('erzeugt kurze, eindeutige und gut lesbare Codes',()=>{
    const code=makeRoomCode(new Uint8Array([0,1,2,3,4,5]));
    expect(code).toHaveLength(6); expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(peerIdFor(code)).toBe(`delete-this-${code}`);
  });
  it('nimmt Code oder teilbaren Link an und verwirft ungültige Codes',()=>{
    expect(normalizeRoomCode('ab-cd-ef')).toBe('ABCDEF');
    expect(normalizeRoomCode('https://example.org/#/spiel?code=ABCDEF')).toBe('ABCDEF');
    expect(roomLink('ABCDEF',{origin:'https://example.org',pathname:'/'})).toBe('https://example.org/#/spiel?code=ABCDEF');
    expect(()=>normalizeRoomCode('111111')).toThrow();
  });
  it('konfiguriert ausschließlich STUN ohne TURN',()=>{
    const options=peerOptions(); expect(options.host).toBe('0.peerjs.com');
    expect(options.config?.iceServers).toEqual([{urls:'stun:stun.l.google.com:19302'}]);
    expect(()=>peerOptions('turn:example.org')).toThrow();
  });
});
