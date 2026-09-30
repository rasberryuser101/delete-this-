import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CloudflareLobby } from '../src/room';
import { makeIdentity } from '../src/identity';
import { channelPair, type FakeChannel } from './fakeChannel';

type Msg = { type: string; id?: string; to?: string; from?: string; data?: { type: string } };
const webSockets = new Map<string, FakeSocket>();
let nextSocket = 0;
let guestOpenDelay = 0;
let tamperSignal = '';
class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  id = `ws-${++nextSocket}`;
  role: string;
  protocol: string;
  sent: Msg[] = [];
  constructor(url: URL) {
    this.role = url.searchParams.get('role') || '';
    this.protocol = url.searchParams.get('protocol') || '';
    webSockets.set(this.id, this);
    queueMicrotask(() => {
      this.readyState = FakeSocket.OPEN;
      this.inbound({ type: 'welcome', id: this.id, accessToken: crypto.randomUUID(), ...(this.role === 'HOST' ? { hostToken: 'private-ticket' } : {}) });
      if (this.role === 'GUEST') {
        const host = [...webSockets.values()].find(ws => ws.role === 'HOST' && ws.readyState === FakeSocket.OPEN)!;
        host.inbound({ type: 'peer-joined', id: this.id });
        this.inbound({ type: 'peer-joined', id: host.id });
      }
    });
  }
  inbound(data: object) { queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(data) })); }
  send(text: string) {
    const msg = JSON.parse(text) as Msg; this.sent.push(msg);
    if (msg.type === 'turn') this.inbound({ type: 'turn', iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] });
    if (msg.type === 'route') webSockets.get(msg.to!)?.inbound({ type: 'route', from: this.id, data: msg.data?.type===tamperSignal ? {...msg.data,sdp:'changed-after-signing'} : msg.data });
  }
  close() { if (this.readyState !== FakeSocket.OPEN) return; this.readyState = 3; webSockets.delete(this.id); for (const other of webSockets.values()) other.inbound({ type: 'peer-left', id: this.id }); this.onclose?.(); }
}
const connections = new Map<string, FakePC>();
class FakePC {
  connectionState: RTCPeerConnectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  localDescription: { sdp: string } | null = null;
  remoteDescription: { sdp: string } | null = null;
  onicecandidate: ((event: { candidate: null }) => void) | null = null;
  ondatachannel: ((event: { channel: RTCDataChannel }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  id = crypto.randomUUID();
  channels: { a: FakeChannel; b: FakeChannel }[] = [];
  partner?: FakePC;
  configuration: RTCConfiguration;
  constructor(configuration: RTCConfiguration) { this.configuration = configuration; connections.set(this.id, this); }
  createDataChannel(label: string) {
    const pair = channelPair(); pair.a.label = pair.b.label = label; pair.a.readyState = pair.b.readyState = 'connecting';
    this.channels.push(pair); return pair.a.asRTC();
  }
  setConfiguration(configuration: RTCConfiguration) { this.configuration = configuration; }
  async createOffer() { return { type: 'offer' as const, sdp: `offer:${this.id}` }; }
  async createAnswer() { return { type: 'answer' as const, sdp: `answer:${this.partner?.id}` }; }
  async setLocalDescription(desc: { type: string; sdp?: string }) { this.localDescription = { sdp: desc.sdp || '' }; this.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable'; }
  async setRemoteDescription(desc: { type: string; sdp?: string }) {
    this.remoteDescription = { sdp: desc.sdp || '' }; this.signalingState = 'stable';
    if (desc.type === 'offer') {
      this.partner = connections.get(desc.sdp!.split(':')[1]);
      for (const pair of this.partner!.channels) this.ondatachannel?.({ channel: pair.b.asRTC() });
    } else {
      const guest = [...connections.values()].find(pc => pc.partner === this);
      if (guest && this.channels) queueMicrotask(() => {
        this.connectionState = guest.connectionState = 'connected';
        for (const pair of this.channels) { pair.a.readyState = 'open'; pair.a.dispatchEvent(new Event('open')); }
        setTimeout(() => { for (const pair of this.channels) { if (pair.b.readyState === 'closed') continue; pair.b.readyState = 'open'; pair.b.dispatchEvent(new Event('open')); } }, guestOpenDelay);
      });
    }
  }
  async addIceCandidate() { /* No candidates in this deterministic test. */ }
  close() { this.connectionState = 'closed'; for (const pair of this.channels) { pair.a.close(); pair.b.close(); } connections.delete(this.id); }
}
const sessions: CloudflareLobby[] = [];
const credentials = vi.fn(async () => new Response(JSON.stringify({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], expiresIn: 60 }), { headers: { 'Content-Type': 'application/json' } }));
beforeEach(() => {
  credentials.mockReset();
  credentials.mockImplementation(async () => new Response(JSON.stringify({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], expiresIn: 60 }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', credentials);
});
afterEach(async () => { await Promise.all(sessions.splice(0).map(s => s.close())); webSockets.clear(); connections.clear(); guestOpenDelay = 0; tamperSignal = ''; vi.unstubAllGlobals(); });

it.each([0, 150])('wartet auf beide Datenkanäle (Gast %i ms später) und überträgt freigegebene Fotos', async (delay) => {
  guestOpenDelay = delay;
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('location', { origin: 'https://example.org' });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('RTCPeerConnection', FakePC);
  const host = new CloudflareLobby({ code: 'ABCDEFGH23', role: 'HOST', authorize: async () => {}, canPhoto: () => true }, await makeIdentity('host'));
  sessions.push(host); await host.start();
  expect(credentials).not.toHaveBeenCalled(); // An empty lobby needs no TURN credentials.
  const joined = vi.fn(); host.session.room.onPeerJoin = joined;
  const guest = new CloudflareLobby({ code: 'ABCDEFGH23', role: 'PLAYER', name: 'Gast', expectedHostKey: host.session.publicKey, authorize: () => {}, canPhoto: () => true }, await makeIdentity('guest'));
  sessions.push(guest); await guest.start();
  await vi.waitFor(() => expect(joined).toHaveBeenCalledWith('guest'));
  expect([...webSockets.values()].every(ws => ws.protocol === '2')).toBe(true);
  for (const ws of webSockets.values()) expect(ws.sent.some(m=>m.data?.type==='CHANNEL_READY')).toBe(true);
  const receiveControl = vi.fn(async () => ({ ok: true as const })); host.session.control.onRequest = receiveControl;
  await guest.session.control.request('{"type":"ready"}', { target: 'host' });
  expect(receiveControl).toHaveBeenCalledWith('{"type":"ready"}', expect.objectContaining({ peerId: 'guest' }));
  expect([...webSockets.values()].flatMap(ws => ws.sent).some(m => ['CONTROL','ACK'].includes(m.data?.type || ''))).toBe(false);
  expect(credentials).toHaveBeenCalledTimes(2);
  await host.recover();await guest.recover();expect(credentials).toHaveBeenCalledTimes(2);
  const bytes = new Uint8Array([255, 216, 255, 1]);
  const receivePhoto = vi.fn(async (data: unknown) => { expect(data).toEqual(bytes); return { ok: true as const, id: 'photo', roundId: 'round' }; });
  host.session.photo.onRequest = receivePhoto;
  await guest.session.photo.request(bytes, { target: 'host', metadata: { version: 2, id: 'photo', roundId: 'round', bytes: 4, mime: 'image/jpeg' } });
  expect(receivePhoto).toHaveBeenCalledOnce();
  expect([...webSockets.values()].flatMap(ws => ws.sent).some(m => JSON.stringify(m).includes('255,216,255'))).toBe(false);
});

it.each([
  [403, 'Zugang abgelehnt (403)'],
  [429, 'Schutzpause (429)'],
  [503, 'Dienst nicht verfügbar (503)'],
])('zeigt bei fehlgeschlagenem Relay-Abruf HTTP %i statt einer irreführenden leeren Diagnose', async (status, diagnosis) => {
  credentials.mockImplementation(async () => new Response('private-provider-response-must-not-appear', { status }));
  vi.stubGlobal('location', { origin: 'https://example.org' });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('WebSocket', FakeSocket); vi.stubGlobal('RTCPeerConnection', FakePC);
  const host = new CloudflareLobby({ code: 'ABCDEFGH23', role: 'HOST', authorize: () => {} }, await makeIdentity('host'));
  sessions.push(host); await host.start();
  const guest = new CloudflareLobby({ code: 'ABCDEFGH23', role: 'PLAYER', name: 'Gast', authorize: () => {} }, await makeIdentity('guest'));
  sessions.push(guest); await guest.start();
  await vi.waitFor(async () => {
    for (const lobby of [host, guest]) {
      const text = await lobby.session.diagnostics!();
      expect(text).toContain(diagnosis);
      expect(text).not.toContain('private-provider-response');
    }
  });
  await host.recover(); await guest.recover();
  expect(credentials).toHaveBeenCalledTimes(2); // No immediate credential retry loop.
});

it('konfiguriert beide Geräte mit erhaltenen Relay-Zugängen und sendet das Ticket nur an den eigenen Worker', async () => {
  const iceServers = [{ urls: 'turns:turn.cloudflare.com:5349?transport=tcp', username: 'temporary-user', credential: 'temporary-secret' }];
  credentials.mockImplementation(async () => new Response(JSON.stringify({ iceServers, expiresIn: 1800 })));
  vi.stubGlobal('location', { origin: 'https://example.org' });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('WebSocket', FakeSocket); vi.stubGlobal('RTCPeerConnection', FakePC);
  const host = new CloudflareLobby({ code: 'ABCDEFGH23', role: 'HOST', authorize: () => {} }, await makeIdentity('host'));
  sessions.push(host); await host.start(); const joined = vi.fn(); host.session.room.onPeerJoin = joined;
  const guest = new CloudflareLobby({ code: 'ABCDEFGH23', role: 'PLAYER', name: 'Gast', authorize: () => {} }, await makeIdentity('guest'));
  sessions.push(guest); await guest.start();
  await vi.waitFor(() => expect(joined).toHaveBeenCalledWith('guest'));
  for (const pc of connections.values()) expect(pc.configuration.iceServers).toEqual(iceServers);
  const calls = credentials.mock.calls as unknown as [URL, RequestInit][];
  for (const [url, request] of calls) {
    expect(url.href).toBe('https://example.org/api/turn');
    expect(request).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'omit' });
    expect(JSON.parse(request.body as string)).toEqual({ code: 'ABCDEFGH23', id: expect.stringMatching(/^ws-/), token: expect.stringMatching(/^[\da-f-]{36}$/) });
  }
  for (const lobby of [host, guest]) {
    const text = await lobby.session.diagnostics!();
    expect(text).toContain('Zugang erhalten'); expect(text).not.toContain('temporary-secret');
  }
});

it.each(['OFFER','ANSWER'])('verwirft manipulierte %s-Verbindungsangebote trotz gültiger Gerätefreigabe',async kind=>{
 tamperSignal=kind;
 vi.stubGlobal('isSecureContext',true);vi.stubGlobal('location',{origin:'https://example.org'});
 vi.stubGlobal('window',{addEventListener(){},removeEventListener(){}});vi.stubGlobal('document',{addEventListener(){},removeEventListener(){}});
 vi.stubGlobal('WebSocket',FakeSocket);vi.stubGlobal('RTCPeerConnection',FakePC);
 const host=new CloudflareLobby({code:'ABCDEFGH23',role:'HOST',authorize:()=>{},canPhoto:()=>true},await makeIdentity('host'));
 sessions.push(host);await host.start();const joined=vi.fn();host.session.room.onPeerJoin=joined;
 const guest=new CloudflareLobby({code:'ABCDEFGH23',role:'PLAYER',name:'Gast',expectedHostKey:host.session.publicKey,authorize:()=>{},canPhoto:()=>true},await makeIdentity('guest'));
 sessions.push(guest);await guest.start();
 await vi.waitFor(()=>expect([...webSockets.values()].flatMap(ws=>ws.sent).some(m=>m.data?.type===kind)).toBe(true));
 await new Promise(resolve=>setTimeout(resolve,50));
 expect(joined).not.toHaveBeenCalled();
 expect([...connections.values()].some(pc=>pc.remoteDescription?.sdp==='changed-after-signing')).toBe(false);
});
it('verbindet denselben Tab nach Socket-Verlust ohne erneute Freigabe und erhält den Fotokanal',async()=>{
 vi.stubGlobal('isSecureContext',true);vi.stubGlobal('location',{origin:'https://example.org'});vi.stubGlobal('window',{addEventListener(){},removeEventListener(){}});vi.stubGlobal('document',{addEventListener(){},removeEventListener(){}});vi.stubGlobal('WebSocket',FakeSocket);vi.stubGlobal('RTCPeerConnection',FakePC);
 const authorize=vi.fn(async()=>{}),host=new CloudflareLobby({code:'ABCDEFGH23',role:'HOST',authorize,canPhoto:()=>true},await makeIdentity('host'));sessions.push(host);await host.start();const joined=vi.fn(),left=vi.fn();host.session.room.onPeerJoin=joined;host.session.room.onPeerLeave=left;
 const guest=new CloudflareLobby({code:'ABCDEFGH23',role:'PLAYER',name:'Gast',expectedHostKey:host.session.publicKey,authorize:()=>{},canPhoto:()=>true},await makeIdentity('guest'));sessions.push(guest);await guest.start();await vi.waitFor(()=>expect(joined).toHaveBeenCalledTimes(1));expect(authorize).toHaveBeenCalledTimes(1);
 [...webSockets.values()].find(ws=>ws.role==='GUEST')!.close();await vi.waitFor(()=>expect(left).toHaveBeenCalledWith('guest'));await guest.recover();await vi.waitFor(()=>expect(joined).toHaveBeenCalledTimes(2));expect(authorize).toHaveBeenCalledTimes(1);
 host.session.control.onRequest=async()=>({ok:true});await expect(guest.session.control.request('{"type":"ready"}',{target:'host'})).resolves.toEqual({ok:true});
 const hostPC=[...connections.values()].find(pc=>pc.channels.length>0)!;
 hostPC.channels.find(p=>p.b.label==='game-control')!.b.close();
 await guest.recover();await vi.waitFor(()=>expect(joined).toHaveBeenCalledTimes(3));expect(authorize).toHaveBeenCalledTimes(1);
 await expect(guest.session.control.request('{"type":"ready"}',{target:'host'})).resolves.toEqual({ok:true});
 expect(credentials).toHaveBeenCalledTimes(2); // Same credentials survive reconnect and channel repair.
});
