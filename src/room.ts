import { joinRoom, getRelaySockets, selfId } from '@trystero-p2p/mqtt';
import type { RequestAction, Room } from '@trystero-p2p/core';
import { APPROVAL_MS } from './admission';
import type { PhotoAction, PhotoAck } from './transfer';
export { parsePhotoMetadata } from './transfer';
export const BUILD = '3.0 · Freigabe + Empfangsbestätigung';
export const CONNECTION_ERROR = 'Lobby nicht gefunden. Beide Geräte müssen Version 3 verwenden und dieselbe neue Einladung öffnen.';
export const NETWORK_ERROR = 'Direkte Verbindung konnte in diesem Netzwerk leider nicht hergestellt werden. Ein TURN-Relay könnte nötig sein; es ist nicht eingerichtet.';
export const APP_ID = 'at.delete-this.party.v3';
export const JOIN_TIMEOUT_MS = 30_000;
export const STUN_SERVERS: RTCIceServer[] = [{urls:'stun:stun.l.google.com:19302'}, {urls:'stun:stun.cloudflare.com:3478'}];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export type LobbyRole = 'host' | 'guest';
export type LobbyHandshake = {version: 3; role: LobbyRole; name?: string};
export type LobbySession = {room: Room; selfId: string; control: RequestAction<string, {ok:true}>; photo: PhotoAction; relayCount: () => number};
export type LobbyOptions = {code: string; role: LobbyRole; name?: string; authorize?: (id: string, remote: LobbyHandshake) => void | Promise<void>; onStage?: (stage: 'approval', id: string) => void; onJoinError?: (id: string, error: string) => void};
export function makeRoomCode(bytes = crypto.getRandomValues(new Uint8Array(10))): string {
  if (bytes.length !== 10) throw new Error('Zehn Zufallsbytes erwartet.');
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
}
export function normalizeRoomCode(input: string): string {
  let code = input.trim();
  if (/^https?:\/\//.test(code)) {
    try { code = new URLSearchParams(new URL(code).hash.split('?')[1] ?? '').get('code') ?? ''; }
    catch { throw new Error('Ungültiger Einladungslink.'); }
  }
  code = code.toUpperCase().replace(/[\s-]/g,'');
  if (!/^[A-HJ-NP-Z2-9]{10}$/.test(code)) throw new Error('Bitte den neuen zehnstelligen Code oder Einladungslink verwenden. Alte Lobbys sind nicht kompatibel.');
  return code;
}
export const roomLink = (code: string, location: Pick<Location,'origin'|'pathname'>) => `${location.origin}${location.pathname}#/spiel?code=${normalizeRoomCode(code)}`;
export function parseHandshake(value: unknown): LobbyHandshake | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string,unknown>;
  if (v.version !== 3 || !['host','guest'].includes(v.role as string) || (v.role === 'guest' && (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 24))) return null;
  return v as LobbyHandshake;
}
export function lobbyConfig(code: string) {
  return {appId:APP_ID, password:`delete-this:${normalizeRoomCode(code)}`, relayConfig:{redundancy:5, warnOnRelayFailure:false}, rtcConfig:{iceServers:STUN_SERVERS}, trickleIce:true};
}
export function createLobbySession(options: LobbyOptions): LobbySession {
  if (!globalThis.isSecureContext || typeof RTCPeerConnection === 'undefined') throw new Error('WebRTC ist hier nicht verfügbar. Bitte die HTTPS-Seite in Safari oder Chrome öffnen.');
  const mine: LobbyHandshake = {version:3, role:options.role, ...(options.role==='guest' ? {name:options.name?.trim()} : {})};
  if (!parseHandshake(mine)) throw new Error('Bitte einen Namen eingeben.');
  const room = joinRoom(lobbyConfig(options.code), normalizeRoomCode(options.code), {
    handshakeTimeoutMs: APPROVAL_MS + 15_000,
    onJoinError: ({peerId,error}) => options.onJoinError?.(peerId,error),
    onPeerHandshake: async (id, send, receive, initiator) => {
      let remote: LobbyHandshake | null;
      if (initiator) { await send(mine); remote = parseHandshake((await receive()).data); }
      else { remote = parseHandshake((await receive()).data); await send(mine); }
      if (!remote || remote.role === mine.role) throw new Error('Unpassende Rolle oder Spielversion.');
      if (mine.role === 'host') {
        await send({status:'approval'});
        try { await options.authorize?.(id,remote); await send({status:'accepted'}); }
        catch (e) { await send({status:'denied'}); throw e; }
      } else {
        await options.authorize?.(id,remote);
        const waiting = (await receive()).data as {status?:string};
        if (waiting?.status !== 'approval') throw new Error('Ungültige Lobby-Antwort.');
        options.onStage?.('approval', id);
        const decision = (await receive()).data as {status?:string};
        if (decision?.status !== 'accepted') throw new Error('Der Host hat die Anfrage abgelehnt oder die Lobby geschlossen.');
      }
    }
  });
  return {room, selfId, relayCount:() => Object.values(getRelaySockets()).filter(s => (s as WebSocket).readyState===1).length,
    control:room.makeAction<string,{ok:true}>('control-v3',{kind:'request'}),
    photo:room.makeAction<Uint8Array,PhotoAck>('photo-v3',{kind:'request'})};
}
