import { afterEach, expect, it, vi } from 'vitest';
import { CloudflareLobby } from '../src/room';
import { makeIdentity } from '../src/identity';
import { channelPair, type FakeChannel } from './fakeChannel';

type Msg = { type: string; id?: string; to?: string; from?: string; data?: { type: string } };
const webSockets = new Map<string, FakeSocket>();
let nextSocket = 0;
class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  id = `ws-${++nextSocket}`;
  role: string;
  sent: Msg[] = [];
  constructor(url: URL) {
    this.role = url.searchParams.get('role') || '';
    webSockets.set(this.id, this);
    queueMicrotask(() => {
      this.readyState = FakeSocket.OPEN;
      this.inbound({ type: 'welcome', id: this.id, ...(this.role === 'HOST' ? { hostToken: 'private-ticket' } : {}) });
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
    if (msg.type === 'route') webSockets.get(msg.to!)?.inbound({ type: 'route', from: this.id, data: msg.data });
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
  channels?: { a: FakeChannel; b: FakeChannel };
  partner?: FakePC;
  constructor() { connections.set(this.id, this); }
  createDataChannel() {
    this.channels = channelPair(); this.channels.a.readyState = this.channels.b.readyState = 'connecting';
    return this.channels.a.asRTC();
  }
  async createOffer() { return { type: 'offer' as const, sdp: `offer:${this.id}` }; }
  async createAnswer() { return { type: 'answer' as const, sdp: `answer:${this.partner?.id}` }; }
  async setLocalDescription(desc: { type: string; sdp?: string }) { this.localDescription = { sdp: desc.sdp || '' }; this.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable'; }
  async setRemoteDescription(desc: { type: string; sdp?: string }) {
    this.remoteDescription = { sdp: desc.sdp || '' }; this.signalingState = 'stable';
    if (desc.type === 'offer') {
      this.partner = connections.get(desc.sdp!.split(':')[1]);
      this.ondatachannel?.({ channel: this.partner!.channels!.b.asRTC() });
    } else {
      const guest = [...connections.values()].find(pc => pc.partner === this);
      if (guest && this.channels) queueMicrotask(() => {
        this.connectionState = guest.connectionState = 'connected';
        this.channels!.a.readyState = this.channels!.b.readyState = 'open';
        this.channels!.a.dispatchEvent(new Event('open')); this.channels!.b.dispatchEvent(new Event('open'));
      });
    }
  }
  async addIceCandidate() { /* No candidates in this deterministic test. */ }
  close() { this.connectionState = 'closed'; this.channels?.a.close(); this.channels?.b.close(); connections.delete(this.id); }
}
const sessions: CloudflareLobby[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map(s => s.close())); webSockets.clear(); connections.clear(); vi.unstubAllGlobals(); });

it('verbindet genehmigten Gast, bestätigt Steuerdaten und überträgt Fotobytes nur per RTCDataChannel', async () => {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('location', { origin: 'https://example.org' });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('RTCPeerConnection', FakePC);
  const host = new CloudflareLobby({ code: 'ABCDEFGH23', role: 'HOST', authorize: async () => {}, canPhoto: () => true }, await makeIdentity('host'));
  sessions.push(host); await host.start();
  const joined = vi.fn(); host.session.room.onPeerJoin = joined;
  const guest = new CloudflareLobby({ code: 'ABCDEFGH23', role: 'PLAYER', name: 'Gast', expectedHostKey: host.session.publicKey, authorize: () => {}, canPhoto: () => true }, await makeIdentity('guest'));
  sessions.push(guest); await guest.start();
  await vi.waitFor(() => expect(joined).toHaveBeenCalledWith('guest'));
  const receiveControl = vi.fn(async () => ({ ok: true as const })); host.session.control.onRequest = receiveControl;
  await guest.session.control.request('{"type":"ready"}', { target: 'host' });
  expect(receiveControl).toHaveBeenCalledWith('{"type":"ready"}', expect.objectContaining({ peerId: 'guest' }));
  const bytes = new Uint8Array([255, 216, 255, 1]);
  const receivePhoto = vi.fn(async (data: unknown) => { expect(data).toEqual(bytes); return { ok: true as const, id: 'photo', roundId: 'round' }; });
  host.session.photo.onRequest = receivePhoto;
  await guest.session.photo.request(bytes, { target: 'host', metadata: { version: 2, id: 'photo', roundId: 'round', bytes: 4, mime: 'image/jpeg' } });
  expect(receivePhoto).toHaveBeenCalledOnce();
  expect([...webSockets.values()].flatMap(ws => ws.sent).some(m => JSON.stringify(m).includes('255,216,255'))).toBe(false);
});
