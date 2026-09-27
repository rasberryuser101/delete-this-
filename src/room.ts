import { joinRoom, type JsonValue, type MessageAction, type Room } from 'trystero';

export const CONNECTION_ERROR = 'Die Lobby-Verbindung konnte nicht hergestellt werden. Bitte Code prüfen und erneut versuchen.';
export const NETWORK_ERROR = 'Dieses Netzwerk blockiert leider direkte WebRTC-Verbindungen.';
export const APP_ID = 'at.delete-this.party.v2';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const STUN_SERVERS: RTCIceServer[] = [
  {urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']},
  {urls: 'stun:stun.cloudflare.com:3478'},
  {urls: 'stun:global.stun.twilio.com:3478'}
];

export type LobbyRole = 'host' | 'guest';
export type LobbyHandshake = {version: 1; role: LobbyRole; name?: string};
export type PhotoMetadata = {version: 1; id: string; roundId: string; bytes: number; mime: 'image/webp' | 'image/jpeg'};
export type LobbySession = {room: Room; control: MessageAction<string>; photo: MessageAction<Blob>};

export function makeRoomCode(randomBytes: Uint8Array = crypto.getRandomValues(new Uint8Array(6))): string {
  if (randomBytes.length !== 6) throw new Error('Sechs Zufallsbytes erwartet.');
  return Array.from(randomBytes, byte => ALPHABET[byte % ALPHABET.length]).join('');
}
export function normalizeRoomCode(input: string): string {
  const value = input.trim();
  let code = value;
  if (value.startsWith('https://') || value.startsWith('http://')) {
    try { const url = new URL(value); code = new URLSearchParams(url.hash.split('?')[1] ?? '').get('code') ?? value; }
    catch { throw new Error('Der Einladungslink ist ungültig.'); }
  }
  code = code.toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new Error('Bitte einen gültigen sechsstelligen Lobbycode eingeben.');
  return code;
}
export function roomLink(code: string, location: Pick<Location,'origin'|'pathname'>): string {
  return `${location.origin}${location.pathname}#/spiel?code=${normalizeRoomCode(code)}`;
}

const plainObject = (value: unknown): value is Record<string,unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 100 && /^[\w-]+$/.test(value);

export function parseHandshake(value: unknown): LobbyHandshake | null {
  if (!plainObject(value) || value.version !== 1 || !['host','guest'].includes(value.role as string)) return null;
  if (value.role === 'guest' && (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 24)) return null;
  return {version: 1, role: value.role as LobbyRole, ...(value.role === 'guest' ? {name: value.name as string} : {})};
}

export function parsePhotoMetadata(value: JsonValue | undefined): PhotoMetadata | null {
  if (!plainObject(value) || value.version !== 1 || !safeId(value.id) || !safeId(value.roundId) ||
      !Number.isInteger(value.bytes) || (value.bytes as number) < 1 || (value.bytes as number) > 450_000 ||
      !['image/webp','image/jpeg'].includes(value.mime as string)) return null;
  return value as PhotoMetadata;
}

export function lobbyConfig(code: string) {
  const normalized = normalizeRoomCode(code);
  return {
    appId: APP_ID,
    password: `delete-this:${normalized}`,
    relayConfig: {redundancy: 8, warnOnRelayFailure: false},
    rtcConfig: {iceServers: STUN_SERVERS, iceCandidatePoolSize: 4},
    trickleIce: true
  };
}

export function createLobbySession(options: {
  code: string;
  role: LobbyRole;
  name?: string;
  authorize?: (peerId: string, remote: LobbyHandshake) => void | Promise<void>;
  onJoinError?: (peerId: string, error: string) => void;
}): LobbySession {
  const code = normalizeRoomCode(options.code);
  const mine: LobbyHandshake = options.role === 'guest'
    ? {version: 1, role: 'guest', name: options.name?.trim()}
    : {version: 1, role: 'host'};
  if (!parseHandshake(mine)) throw new Error('Ungültige Spielerdaten.');
  const room = joinRoom(lobbyConfig(code), code, {
    handshakeTimeoutMs: 20_000,
    onJoinError: ({peerId,error}) => options.onJoinError?.(peerId,error),
    onPeerHandshake: async (peerId,send,receive) => {
      await send(mine);
      const remote = parseHandshake((await receive()).data);
      if (!remote || remote.role === options.role) throw new Error('Diese Verbindung gehört nicht zur gesuchten Lobby.');
      await options.authorize?.(peerId,remote);
    }
  });
  return {room, control: room.makeAction<string>('control-v1'), photo: room.makeAction<Blob>('photo-v1')};
}
