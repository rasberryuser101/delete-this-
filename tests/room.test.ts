import { describe,expect,it } from 'vitest';
import { JOIN_TIMEOUT_MS,makeRoomCode,normalizeRoomCode,parseHandshake,parsePhotoMetadata,roomLink } from '../src/room';
describe('Lobbycodes und Cloudflare-Verbindungen',()=>{
 it('erzeugt zehn zufällige, gut lesbare Zeichen',()=>{expect(makeRoomCode()).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);expect(new Set(Array.from({length:100},()=>makeRoomCode())).size).toBe(100);});
 it('nimmt Code oder teilbaren Link an',()=>{expect(normalizeRoomCode('abcde-fgh23')).toBe('ABCDEFGH23');expect(normalizeRoomCode('https://example.org/#/spiel?code=ABCDEFGH23')).toBe('ABCDEFGH23');expect(roomLink('ABCDEFGH23',{origin:'https://example.org',pathname:'/'})).toBe('https://example.org/#/spiel?code=ABCDEFGH23');expect(()=>normalizeRoomCode('ABCDEF')).toThrow();expect(()=>normalizeRoomCode('111111')).toThrow();});
 it('prüft Rollen, Namen und Bild-Metadaten',()=>{expect(parseHandshake({version:5,role:'PLAYER',name:'Chris'})).not.toBeNull();expect(parseHandshake({version:5,role:'DISPLAY',name:'TV'})).not.toBeNull();expect(parseHandshake({version:5,role:'PLAYER',name:''})).toBeNull();expect(parseHandshake({version:5,role:'admin',name:'Chris'})).toBeNull();expect(parsePhotoMetadata({version:2,id:'foto',roundId:'runde',bytes:400_000,mime:'image/jpeg'})).not.toBeNull();expect(parsePhotoMetadata({version:2,id:'foto',roundId:'runde',bytes:1_000_001,mime:'image/jpeg'})).toBeNull();});
 it('erlaubt langsamen Verbindungsaufbau für Mobilgeräte',()=>{expect(JOIN_TIMEOUT_MS).toBe(90_000);});
});
