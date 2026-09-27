import { describe,expect,it } from 'vitest';
import { JOIN_TIMEOUT_MS,lobbyConfig,makeRoomCode,normalizeRoomCode,parseHandshake,parsePhotoMetadata,roomLink,STUN_SERVERS } from '../src/room';
describe('Lobbycodes',()=>{
  it('erzeugt kurze, eindeutige und gut lesbare Codes',()=>{
    const code=makeRoomCode(new Uint8Array([0,1,2,3,4,5]));
    expect(code).toHaveLength(6); expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
  it('nimmt Code oder teilbaren Link an und verwirft ungültige Codes',()=>{
    expect(normalizeRoomCode('ab-cd-ef')).toBe('ABCDEF');
    expect(normalizeRoomCode('https://example.org/#/spiel?code=ABCDEF')).toBe('ABCDEF');
    expect(roomLink('ABCDEF',{origin:'https://example.org',pathname:'/'})).toBe('https://example.org/#/spiel?code=ABCDEF');
    expect(()=>normalizeRoomCode('111111')).toThrow();
  });
  it('prüft Rollen und Bild-Metadaten vor der WebRTC-Verarbeitung',()=>{
    expect(parseHandshake({version:1,role:'guest',name:'Chris'})).toEqual({version:1,role:'guest',name:'Chris'});
    expect(parseHandshake({version:1,role:'guest',name:''})).toBeNull();
    expect(parseHandshake({version:1,role:'admin',name:'Chris'})).toBeNull();
    expect(parsePhotoMetadata({version:1,id:'foto',roundId:'runde',bytes:400_000,mime:'image/jpeg'})).not.toBeNull();
    expect(parsePhotoMetadata({version:1,id:'foto',roundId:'runde',bytes:500_000,mime:'image/jpeg'})).toBeNull();
    expect(parsePhotoMetadata({version:1,id:'<script>',roundId:'runde',bytes:10,mime:'image/jpeg'})).toBeNull();
  });
  it('nutzt redundante, direkte WebRTC-Erkennung ohne TURN',()=>{
    const config=lobbyConfig('ABCDEF');
    expect(config.relayConfig.redundancy).toBeGreaterThanOrEqual(5);
    expect(config.rtcConfig.iceServers).toEqual(STUN_SERVERS);
    expect(JSON.stringify(config.rtcConfig.iceServers)).not.toContain('turn:');
    expect(config.password).toContain('ABCDEF');
    expect(JOIN_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
  });
});
