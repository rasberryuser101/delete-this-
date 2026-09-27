import { describe,expect,it } from 'vitest';
import { JOIN_TIMEOUT_MS,lobbyConfig,makeRoomCode,normalizeRoomCode,parseHandshake,parsePhotoMetadata,parseTurnConfig,roomLink,STUN_SERVERS } from '../src/room';
describe('Lobbycodes',()=>{
  it('erzeugt kurze, eindeutige und gut lesbare Codes',()=>{
    const code=makeRoomCode(new Uint8Array([0,1,2,3,4,5,6,7,8,9]));
    expect(code).toHaveLength(10); expect(code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
  });
  it('nimmt Code oder teilbaren Link an und verwirft ungültige Codes',()=>{
    expect(normalizeRoomCode('abcde-fgh23')).toBe('ABCDEFGH23');
    expect(normalizeRoomCode('https://example.org/#/spiel?code=ABCDEFGH23')).toBe('ABCDEFGH23');
    expect(roomLink('ABCDEFGH23',{origin:'https://example.org',pathname:'/'})).toBe('https://example.org/#/spiel?code=ABCDEFGH23');
    expect(()=>normalizeRoomCode('ABCDEF')).toThrow();
    expect(()=>normalizeRoomCode('111111')).toThrow();
  });
  it('prüft Rollen und Bild-Metadaten vor der WebRTC-Verarbeitung',()=>{
    expect(parseHandshake({version:4,role:'guest',name:'Chris'})).toEqual({version:4,role:'guest',name:'Chris'});
    expect(parseHandshake({version:4,role:'guest',name:''})).toBeNull();
    expect(parseHandshake({version:4,role:'admin',name:'Chris'})).toBeNull();
    expect(parsePhotoMetadata({version:2,id:'foto',roundId:'runde',bytes:400_000,mime:'image/jpeg'})).not.toBeNull();
    expect(parsePhotoMetadata({version:2,id:'foto',roundId:'runde',bytes:500_000,mime:'image/jpeg'})).toBeNull();
    expect(parsePhotoMetadata({version:2,id:'<script>',roundId:'runde',bytes:10,mime:'image/jpeg'})).toBeNull();
  });
  it('nutzt redundante Vermittlung und optionale, validierte TURN-Daten',()=>{
    const turn=parseTurnConfig('{"urls":["turns:relay.example:443?transport=tcp"],"username":"temporary","credential":"short-lived"}');
    const config=lobbyConfig('ABCDEFGH23',turn);
    expect(config.relayConfig.redundancy).toBe(2);
    expect(config.rtcConfig.iceServers).toEqual([...STUN_SERVERS,...turn]);
    expect(lobbyConfig('ABCDEFGH23').rtcConfig.iceServers).toEqual(STUN_SERVERS);
    expect(parseTurnConfig('')).toEqual([]);
    expect(()=>parseTurnConfig('{"urls":"https://api.example/upload","username":"x","credential":"y"}')).toThrow();
    expect(()=>parseTurnConfig('{"urls":"turn:relay.example","username":"","credential":"y"}')).toThrow();
    expect(config.password).toContain('ABCDEF');
    expect(JOIN_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});
