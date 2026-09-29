import { makeIdentity, storedIdentity, verifyIdentity, type DeviceIdentity, type Role } from './identity';
import { parseNetwork, type NetworkControl } from './networkProtocol';
import { decodeMessage, encodeMessage } from './protocol';
import { PhotoChannel } from './photoChannel';
import { withDeadline, type PhotoAction, type PhotoMetadata } from './transfer';
import type { RequestAction } from './actions';
export { parsePhotoMetadata } from './transfer';

export const BUILD = '6.3';
export const CONNECTION_ERROR = 'Lobby nicht gefunden oder Verbindung fehlgeschlagen. Link prüfen und erneut versuchen.';
export const NETWORK_ERROR = 'Verbindung fehlgeschlagen. Internet prüfen und erneut versuchen.';
export const JOIN_TIMEOUT_MS = 90_000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const STUN: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];
export type LobbyRole = Role;
export type LobbyHandshake = { version: 5; role: Role; name?: string; publicKey?: string; check?: string };
export type LobbyOptions = { code: string; role: Role; name?: string; identity?: DeviceIdentity; expectedHostKey?: string; signal?: AbortSignal;
  authorize?: (id: string, remote: LobbyHandshake) => void | Promise<void>;
  onStage?: (stage: 'approval' | 'connecting', id: string) => void; onJoinError?: (id: string, error: string) => void;
  onStatus?: (status: string) => void;
  canPhoto?: (id: string, direction: 'send' | 'receive', meta: PhotoMetadata, visibility: 'PRIVATE' | 'PUBLIC') => boolean };
export type LobbySession = { selfId: string; publicKey?: string; control: RequestAction<string, { ok: true }>; photo: PhotoAction;
  room: { onPeerJoin: ((id: string) => void) | null; onPeerLeave: ((id: string) => void) | null; leave: () => Promise<void>; getPeers: () => Record<string, { close: () => void }> };
  relayCount: () => number; diagnostics?: () => Promise<string>; connectionError?: () => string; recover?: () => Promise<void>; clearTransfers?: () => void };

export function makeRoomCode(bytes?: Uint8Array): string {
  if (bytes) { if (bytes.length !== 10) throw new Error('Zehn Zufallsbytes erwartet.'); return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join(''); }
  let result = '';
  while (result.length < 10) for (const b of crypto.getRandomValues(new Uint8Array(16))) {
    if (b < Math.floor(256 / ALPHABET.length) * ALPHABET.length) result += ALPHABET[b % ALPHABET.length];
    if (result.length === 10) break;
  }
  return result;
}
export function normalizeRoomCode(input: string): string {
  let code = input.trim();
  if (/^https?:\/\//.test(code)) { try { code = new URLSearchParams(new URL(code).hash.split('?')[1] ?? '').get('code') ?? ''; } catch { throw new Error('Ungültiger Einladungslink.'); } }
  code = code.toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-HJ-NP-Z2-9]{10}$/.test(code)) throw new Error('Bitte den zehnstelligen Lobbycode eingeben.');
  return code;
}
export const roomLink = (code: string, location: Pick<Location, 'origin' | 'pathname'>, display = false, hostKey = '') => `${location.origin}${location.pathname}#/spiel?code=${normalizeRoomCode(code)}${display ? '&display=1' : ''}${/^04[\da-f]{128}$/.test(hostKey) ? `&host=${hostKey}` : ''}`;
export function parseHandshake(value: unknown): LobbyHandshake | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as LobbyHandshake;
  return v.version === 5 && ['HOST', 'PLAYER', 'DISPLAY'].includes(v.role) && (v.role === 'HOST' || (typeof v.name === 'string' && v.name.trim().length > 0 && v.name.length <= 30)) ? v : null;
}
type Signal = { type: 'OFFER' | 'ANSWER'; sdp: string; signature:string } | { type: 'ICE'; candidate: RTCIceCandidateInit } | { type: 'RESTART' | 'CHANNEL_READY' };
type Incoming = { type: 'welcome'; id: string; hostToken?: string } | { type: 'peer-joined' | 'peer-left'; id: string } | { type: 'route'; from: string; data: unknown } | { type: 'turn'; iceServers: RTCIceServer[] } | { type: 'error'; message: string };
type Binding = { id: string; key: string; role: Role; remoteId: string; online: boolean };
const signalData = (raw: unknown): Signal | null => {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if ((v.type === 'OFFER' || v.type === 'ANSWER') && typeof v.sdp === 'string' && v.sdp.length < 20000 && typeof v.signature === 'string' && /^[\da-f]{128}$/.test(v.signature)) return { type: v.type, sdp: v.sdp, signature:v.signature };
  if (v.type === 'RESTART' || v.type === 'CHANNEL_READY') return { type: v.type };
  if (v.type === 'ICE' && v.candidate && typeof v.candidate === 'object') {
    const c = v.candidate as RTCIceCandidateInit;
    if (typeof c.candidate === 'string' && c.candidate.length < 2000) return { type: 'ICE', candidate: c };
  }
  return null;
};
function validIce(value: unknown): value is RTCIceServer[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 4 && value.every(s => s && (typeof s.urls === 'string' || Array.isArray(s.urls)) && (!s.username || typeof s.username === 'string') && (!s.credential || typeof s.credential === 'string'));
}

export async function createLobbySession(options: LobbyOptions): Promise<LobbySession> {
  if (!globalThis.isSecureContext || typeof RTCPeerConnection === 'undefined' || typeof WebSocket === 'undefined') throw new Error('Bitte die HTTPS-Seite in Safari oder Chrome öffnen.');
  const identity = options.identity ?? await makeIdentity(options.role === 'HOST' ? 'host' : storedIdentity(options.role));
  const lobby = new CloudflareLobby(options, identity);
  try { await withDeadline(() => lobby.start(), 20_000, options.signal); return lobby.session; }
  catch (e) { await lobby.session.room.leave(); throw e instanceof Error ? e : new Error(NETWORK_ERROR); }
}

/** Cloudflare sees short text/signalling messages. Photos only use the RTCDataChannel. */
export class CloudflareLobby {
  readonly session: LobbySession;
  private ws: WebSocket | null = null;
  private selfRemote = '';
  private hostRemote = '';
  private hostKey = '';
  private hostToken = '';
  private ice: RTCIceServer[] = STUN;
  private turnReady: Promise<void> = Promise.resolve();
  private turnResolve: (() => void) | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | undefined;
  private turnStatus = 'wird geprüft';
  private remoteReady = new Set<string>();
  private localReady = new Set<string>();
  private peerStarted = new Map<string, number>();
  private bindings = new Map<string, Binding>();
  private remoteIds = new Map<string, string>();
  private pcs = new Map<string, RTCPeerConnection>();
  private candidates = new Map<string, RTCIceCandidateInit[]>();
  private transports = new Map<string, PhotoChannel>();
  private pending = new Map<string, { remote: string; resolve: () => void; reject: () => void; timer: ReturnType<typeof setTimeout> }>();
  private admitting = new Set<string>();
  private blocked = new Set<string>();
  private closed = false;
  private health: ReturnType<typeof setInterval> | undefined;
  private lastRestart = new Map<string, number>();
  private lastTurnRequest = 0;
  private readonly abort = new AbortController();
  private connecting: Promise<void> | null = null;
  constructor(private options: LobbyOptions, private identity: DeviceIdentity) {
    this.session = { selfId: identity.id, publicKey: identity.publicKey,
      control: { onRequest: null, request: async (data, opts) => {
        const message = decodeMessage(data), binding = this.bindings.get(opts.target);
        if (!message || !binding?.online) throw new Error('Nicht freigegeben oder getrennt.');
        const requestId = crypto.randomUUID();
        await new Promise<void>((resolve, reject) => {
          const done = (ok: boolean) => { clearTimeout(timer); opts.signal?.removeEventListener('abort', cancel); this.pending.delete(requestId); if (ok) resolve(); else reject(new Error('Keine Antwort. Bitte erneut versuchen.')); };
          const cancel = () => done(false);
          const timer = setTimeout(cancel, opts.timeoutMs ?? 10_000);
          this.pending.set(requestId, { remote: binding.remoteId, resolve: () => done(true), reject: cancel, timer });
          opts.signal?.addEventListener('abort', cancel, { once: true });
          if (opts.signal?.aborted) cancel(); else try { this.route(binding.remoteId, { type: 'CONTROL', requestId, message }); } catch { cancel(); }
        });
        return { ok: true };
      } },
      photo: { onRequest: null, request: (data, opts) => {
        const binding = this.bindings.get(opts.target), transport = binding && this.transports.get(binding.remoteId);
        if (!binding?.online || !transport) throw new Error('Fotoverbindung wird wiederhergestellt …');
        return transport.request(data, opts);
      } },
      room: { onPeerJoin: null, onPeerLeave: null, leave: () => this.close(), getPeers: () => Object.fromEntries([...this.bindings].map(([id]) => [id, { close: () => this.revoke(id) }])) },
      relayCount: () => this.ws?.readyState === WebSocket.OPEN ? 1 : 0,
      diagnostics: async () => `Cloudflare · Lobby: ${this.ws?.readyState === WebSocket.OPEN ? 'verbunden' : 'getrennt'} · TURN: ${this.turnStatus} · Fotoverbindungen: ${[...this.transports.values()].filter(t => t.channel.readyState === 'open').length}\n${[...this.pcs.values()].map(pc => `WebRTC: ${pc.connectionState} · ICE: ${pc.iceConnectionState}`).join('\n')}`,
      connectionError: () => this.turnStatus === 'Zugang erhalten' ? 'Fotoverbindung fehlgeschlagen. Beide Geräte geöffnet lassen und erneut versuchen.' : 'Die Fotoverbindung ist momentan nicht verfügbar. Bitte später erneut versuchen oder den Betreiber informieren.',
      recover: () => this.recover(), clearTransfers: () => { for (const t of this.transports.values()) t.clear(); } };
  }
  private proof(id: string, role: Role, remoteId: string) { return `game-${normalizeRoomCode(this.options.code)}|${id}|${role}|${remoteId}`; }
  private route(to: string, data: NetworkControl | Signal) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error(NETWORK_ERROR);
    this.ws.send(JSON.stringify({ type: 'route', to, data }));
  }
  async start() { await this.connect(); this.health = setInterval(() => void this.checkHealth(), 15_000); window.addEventListener('online', this.wake); window.addEventListener('pageshow', this.wake); document.addEventListener('visibilitychange', this.visible); }
  private async connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    this.connecting = this.openSocket().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  private openSocket() {
    return new Promise<void>((resolve, reject) => {
      const url = new URL(`/api/lobby/${normalizeRoomCode(this.options.code)}`, location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('role', this.options.role === 'HOST' ? 'HOST' : 'GUEST');
      if (this.hostToken) url.searchParams.set('ticket', this.hostToken);
      const ws = new WebSocket(url); this.ws = ws;
      let welcomed = false;
      const timer = setTimeout(() => { ws.close(); reject(new Error(NETWORK_ERROR)); }, 15_000);
      ws.onmessage = event => {
        if (this.ws !== ws || this.closed || typeof event.data !== 'string' || event.data.length > 32_768) return;
        let msg: Incoming; try { msg = JSON.parse(event.data) as Incoming; } catch { return; }
        if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
        if (msg.type === 'welcome' && typeof msg.id === 'string') {
          welcomed = true; clearTimeout(timer); this.selfRemote = msg.id;
          if (msg.hostToken) this.hostToken = msg.hostToken;
          this.turnReady = new Promise<void>(done => { this.turnResolve = done; });
          if (this.options.role === 'HOST') this.requestTurn();
          resolve();
        } else if (msg.type === 'error') { if (!welcomed) { clearTimeout(timer); reject(new Error(msg.message || CONNECTION_ERROR)); } else this.options.onStatus?.(msg.message || NETWORK_ERROR); }
        else if (welcomed && msg.type === 'turn') {
          clearTimeout(this.turnTimer);
          if (validIce(msg.iceServers)) {
            this.ice = msg.iceServers;
            this.turnStatus = this.ice.some(s => /turns?:/.test(String(s.urls))) ? 'Zugang erhalten' : 'kein Relay-Zugang';
            for (const pc of this.pcs.values()) if (pc.connectionState !== 'closed') try { pc.setConfiguration({ iceServers: this.ice }); } catch { this.options.onStatus?.('Verbindung konnte nicht aktualisiert werden.'); }
          }
          this.turnResolve?.(); this.turnResolve = null;
        }
        else if (welcomed && msg.type === 'peer-joined' && typeof msg.id === 'string') { if (this.options.role === 'HOST') void this.announce(msg.id); }
        else if (welcomed && msg.type === 'peer-left' && typeof msg.id === 'string') this.left(msg.id);
        else if (welcomed && msg.type === 'route' && typeof msg.from === 'string') void this.handle(msg.from, msg.data).catch(() => {
          this.options.onJoinError?.(this.remoteIds.get(msg.from) || msg.from, 'WebRTC-Aufbau fehlgeschlagen. Beide Seiten neu laden und erneut beitreten.');
        });
      };
      ws.onerror = () => { if (!welcomed) { clearTimeout(timer); reject(new Error(CONNECTION_ERROR)); } };
      ws.onclose = () => { if (this.ws !== ws || this.closed) return; clearTimeout(timer); if (!welcomed) reject(new Error(CONNECTION_ERROR)); this.turnResolve?.(); this.turnResolve = null; for (const remote of this.pcs.keys()) this.left(remote); this.options.onStatus?.('Verbindung unterbrochen. Wiederverbinden …'); };
    });
  }
  private async announce(remote: string) {
    if (this.closed || this.options.role !== 'HOST' || !this.selfRemote) return;
    this.route(remote, { type: 'HOST', id: 'host', publicKey: this.identity.publicKey, signature: await this.identity.sign(this.proof('host', 'HOST', this.selfRemote)) });
  }
  private async join(remote: string) {
    if (this.options.role === 'HOST' || this.admitting.has(remote)) return;
    this.admitting.add(remote);
    try { this.route(remote, { type: 'JOIN', id: this.identity.id, role: this.options.role, name: this.options.name?.trim().slice(0, 30) || 'Display', publicKey: this.identity.publicKey, signature: await this.identity.sign(this.proof(this.identity.id, this.options.role, this.selfRemote)) }); }
    catch { this.admitting.delete(remote); }
  }
  private async handle(remote: string, data: unknown) {
    const msg = parseNetwork(data);
    if (msg?.type === 'HOST' && this.options.role !== 'HOST') {
      if ((this.options.expectedHostKey && msg.publicKey !== this.options.expectedHostKey) || (this.hostKey && msg.publicKey !== this.hostKey) || msg.id !== 'host' || !await verifyIdentity(msg.publicKey, msg.signature, this.proof('host', 'HOST', remote))) return;
      if (this.hostRemote && this.hostRemote !== remote && this.bindings.get('host')?.online) return;
      this.hostKey = msg.publicKey; this.hostRemote = remote;
      await this.options.authorize?.('host', { version: 5, role: 'HOST', publicKey: msg.publicKey });
      this.options.onStage?.('approval', 'host'); await this.join(remote); return;
    }
    if (msg?.type === 'JOIN' && this.options.role === 'HOST') {
      if (this.admitting.has(remote) || this.blocked.has(remote) || this.blocked.has(msg.id) || msg.id === 'host' || !await verifyIdentity(msg.publicKey, msg.signature, this.proof(msg.id, msg.role, remote))) return;
      this.admitting.add(remote);
      try {
        const old = this.bindings.get(msg.id);
        if (old?.online && old.remoteId !== remote || old && old.role !== msg.role) throw new Error('Bereits verbunden.');
        if (!old || old.key !== msg.publicKey) await this.options.authorize?.(msg.id, { version: 5, role: msg.role, name: msg.name, check: msg.publicKey.slice(-12).toUpperCase() });
        if (this.closed || this.ws?.readyState !== WebSocket.OPEN) return;
        if (old && old.remoteId !== remote) this.left(old.remoteId);
        this.bindings.set(msg.id, { id: msg.id, key: msg.publicKey, role: msg.role, remoteId: remote, online: false }); this.remoteIds.set(remote, msg.id);
        this.route(remote, { type: 'APPROVED', id: msg.id, role: msg.role });
        await this.openPeer(remote);
      } catch { try { this.route(remote, { type: 'DENIED' }); } catch { /* guest disconnected */ } this.blocked.add(remote); }
      finally { this.admitting.delete(remote); }
      return;
    }
    if (msg?.type === 'APPROVED' && this.options.role !== 'HOST' && remote === this.hostRemote && msg.id === this.identity.id && msg.role === this.options.role) {
      this.admitting.delete(remote); this.options.onStage?.('connecting', 'host');
      this.bindings.set('host', { id: 'host', key: this.hostKey, role: 'HOST', remoteId: remote, online: false }); this.remoteIds.set(remote, 'host');
      this.requestTurn(); return;
    }
    if (msg?.type === 'DENIED' && remote === this.hostRemote) { this.options.onJoinError?.('host', 'Der Host hat die Anfrage abgelehnt.'); return; }
    const id = this.remoteIds.get(remote), binding = id && this.bindings.get(id);
    if (!binding || binding.remoteId !== remote) return;
    if (msg?.type === 'ACK') { const pending = this.pending.get(msg.requestId); if (pending?.remote === remote) { if (msg.ok) pending.resolve(); else pending.reject(); } return; }
    if (msg?.type === 'CONTROL') {
      if (!binding.online) return;
      let ok = false;
      try { await this.session.control.onRequest?.(encodeMessage(msg.message), { peerId: id, signal: this.abort.signal }); ok = true; } catch { /* Invalid game control is never acknowledged as valid. */ }
      this.route(remote, { type: 'ACK', requestId: msg.requestId, ok }); return;
    }
    const signal = signalData(data);
    if (!signal) return;
    if ((signal.type==='OFFER'||signal.type==='ANSWER') && !await verifyIdentity(binding.key,signal.signature,this.signalProof(signal.type,signal.sdp,remote,this.selfRemote))) return;
    if (signal.type === 'CHANNEL_READY') { this.remoteReady.add(remote); this.confirmPeer(remote); return; }
    if (signal.type === 'RESTART' && this.options.role === 'HOST') { await this.restart(remote); return; }
    if (signal.type === 'OFFER' && this.options.role !== 'HOST') {
      await this.turnReady;
      if (this.closed || !this.remoteIds.has(remote)) return;
      const pc = this.newPeer(remote);
      await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      await this.flushCandidates(remote, pc);
      await pc.setLocalDescription(await pc.createAnswer());
      await this.sendDescription(remote,'ANSWER',pc);
    } else if (signal.type === 'ANSWER' && this.options.role === 'HOST') {
      const pc = this.pcs.get(remote); if (pc?.signalingState === 'have-local-offer') { await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp }); await this.flushCandidates(remote, pc); }
    } else if (signal.type === 'ICE') {
      const pc = this.pcs.get(remote);
      if (!pc?.remoteDescription) { const queue = this.candidates.get(remote) ?? []; if (queue.length < 80) queue.push(signal.candidate); this.candidates.set(remote, queue); return; }
      try { await pc.addIceCandidate(signal.candidate); } catch { /* stale candidate after an ICE restart */ }
    }
  }
  private signalProof(type:'OFFER'|'ANSWER',sdp:string,from:string,to:string) {
    return JSON.stringify(['delete-this-sdp-v1',this.options.code,from,to,type,sdp]);
  }
  private async sendDescription(remote:string,type:'OFFER'|'ANSWER',pc:RTCPeerConnection) {
    const sdp=pc.localDescription!.sdp!,from=this.selfRemote;
    const signature=await this.identity.sign(this.signalProof(type,sdp,from,remote));
    if(!this.closed&&this.selfRemote===from&&this.pcs.get(remote)===pc)this.route(remote,{type,sdp,signature});
  }
  private newPeer(remote: string) {
    this.dropPeer(remote);
    const pc = new RTCPeerConnection({ iceServers: this.ice }); this.pcs.set(remote, pc); this.peerStarted.set(remote, Date.now());
    this.options.onStatus?.('Freigegeben! Verbinde eure Geräte …');
    pc.onicecandidate = e => { if (e.candidate) try { this.route(remote, { type: 'ICE', candidate: e.candidate.toJSON() }); } catch { /* reconnect will retry */ } };
    pc.ondatachannel = e => this.bindChannel(remote, e.channel);
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') void this.checkHealth(); };
    return pc;
  }
  private async flushCandidates(remote: string, pc: RTCPeerConnection) {
    const queue = this.candidates.get(remote) ?? []; this.candidates.delete(remote);
    for (const candidate of queue) try { await pc.addIceCandidate(candidate); } catch { /* stale */ }
  }
  private async openPeer(remote: string) {
    if (this.options.role !== 'HOST') return;
    await this.turnReady;
    if (this.closed || !this.remoteIds.has(remote)) return;
    const pc = this.newPeer(remote);
    this.bindChannel(remote, pc.createDataChannel('photo-transfer', { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    await this.sendDescription(remote,'OFFER',pc);
  }
  private bindChannel(remote: string, channel: RTCDataChannel) {
    const id = this.remoteIds.get(remote), binding = id && this.bindings.get(id);
    if (!binding || channel.label !== 'photo-transfer' || channel.ordered !== true || channel.maxRetransmits !== null || channel.maxPacketLifeTime !== null || this.transports.has(remote)) { channel.close(); return; }
    const transport: PhotoChannel = new PhotoChannel(channel, id, (direction, meta, visibility) => {
      const b = this.bindings.get(id);
      return !!b?.online && b.remoteId === remote && this.transports.get(remote) === transport && this.options.canPhoto?.(id, direction, meta, visibility) === true;
    }, async (data, ctx) => { if (!this.session.photo.onRequest) throw new Error('Kein Empfänger.'); return this.session.photo.onRequest(data, ctx); }, this.options.role === 'HOST' ? 'PUBLIC' : 'PRIVATE');
    this.transports.set(remote, transport);
    const open = () => {
      if (this.transports.get(remote) !== transport || this.closed || binding.online) return;
      this.localReady.add(remote); this.route(remote, { type: 'CHANNEL_READY' }); this.confirmPeer(remote);
    };
    channel.addEventListener('open', open);
    channel.addEventListener('close', () => { if (this.transports.get(remote) === transport) { this.setOffline(remote); transport.close(); this.transports.delete(remote); } });
    if (channel.readyState === 'open') open();
  }
  private confirmPeer(remote: string) {
    const id = this.remoteIds.get(remote), binding = id && this.bindings.get(id);
    if (!binding || binding.online || this.closed || !this.localReady.has(remote) || !this.remoteReady.has(remote) || this.transports.get(remote)?.channel.readyState !== 'open') return;
    binding.online = true; this.options.onStatus?.('Verbunden'); this.session.room.onPeerJoin?.(id);
  }
  private setOffline(remote: string) {
    const id = this.remoteIds.get(remote), b = id ? this.bindings.get(id) : undefined;
    if (b?.online && id) { b.online = false; this.session.room.onPeerLeave?.(id); }
    for (const p of [...this.pending.values()]) if (p.remote === remote) p.reject();
  }
  private dropPeer(remote: string) { this.setOffline(remote); this.localReady.delete(remote); this.remoteReady.delete(remote); this.peerStarted.delete(remote); const t = this.transports.get(remote); this.transports.delete(remote); t?.close(); const pc = this.pcs.get(remote); this.pcs.delete(remote); pc?.close(); }
  private left(remote: string) {
    this.dropPeer(remote);
    const id = this.remoteIds.get(remote); this.remoteIds.delete(remote); this.candidates.delete(remote);
    if (id && this.bindings.get(id)?.remoteId === remote) this.bindings.delete(id);
    if (remote === this.hostRemote) { this.hostRemote = ''; this.admitting.delete(remote); }
  }
  private revoke(id: string) { const b = this.bindings.get(id); if (!b) return; this.blocked.add(id); try { this.route(b.remoteId, { type: 'DENIED' }); } catch { /* disconnected */ } this.left(b.remoteId); }
  private async restart(remote: string) {
    const now = Date.now(); if (now - (this.lastRestart.get(remote) ?? 0) < 10_000) return;
    this.lastRestart.set(remote, now);
    if (this.options.role === 'HOST') try { await this.openPeer(remote); } catch { /* next health check retries */ }
    else try { this.route(remote, { type: 'RESTART' }); } catch { /* reconnect will retry */ }
  }
  private requestTurn() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.lastTurnRequest = Date.now();
    this.ws.send(JSON.stringify({ type: 'turn' }));
    clearTimeout(this.turnTimer);
    this.turnTimer = setTimeout(() => { this.turnStatus = 'keine Antwort'; this.turnResolve?.(); this.turnResolve = null; this.options.onStatus?.('Verbindung dauert länger. Ein anderer Weg wird versucht …'); }, 12_000);
  }
  private async checkHealth() {
    if (this.closed || navigator.onLine === false) return;
    if (this.ws?.readyState !== WebSocket.OPEN) { await this.recover(); return; }
    if (this.lastTurnRequest && Date.now() - this.lastTurnRequest > 20 * 60_000) this.requestTurn();
    for (const [remote, b] of this.bindings) {
      const pc = this.pcs.get(b.remoteId), dc = this.transports.get(b.remoteId)?.channel;
      if (pc?.connectionState === 'failed' || pc?.connectionState === 'closed' || dc?.readyState === 'closed') await this.restart(b.remoteId);
      else if (!b.online && pc && Date.now() - (this.peerStarted.get(b.remoteId) ?? Date.now()) > 30_000) await this.restart(b.remoteId);
      if (this.options.role !== 'HOST' && remote === 'host' && !pc) await this.restart(b.remoteId);
    }
  }
  private wake = () => { void this.checkHealth(); };
  private visible = () => { if (document.visibilityState === 'visible') this.wake(); };
  async recover() { if (this.closed || this.ws?.readyState === WebSocket.OPEN) { await this.checkPeers(); return; } try { await this.connect(); } catch { this.options.onStatus?.(NETWORK_ERROR); } }
  private async checkPeers() { for (const b of this.bindings.values()) if (this.pcs.get(b.remoteId)?.connectionState === 'failed') await this.restart(b.remoteId); }
  async close() { if (this.closed) return; this.closed = true; this.abort.abort(); clearInterval(this.health); clearTimeout(this.turnTimer); this.turnResolve?.(); this.turnResolve = null; window.removeEventListener('online', this.wake); window.removeEventListener('pageshow', this.wake); document.removeEventListener('visibilitychange', this.visible); this.ws?.close(); this.ws = null; for (const r of this.pcs.keys()) this.dropPeer(r); for (const p of this.pending.values()) p.reject(); this.pending.clear(); }
}
