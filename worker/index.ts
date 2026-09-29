import { DurableObject } from 'cloudflare:workers';

type Env = {
  ROOMS: DurableObjectNamespace<Lobby>;
  RATE: DurableObjectNamespace<RateGate>;
  ASSETS: Fetcher;
  TURN_KEY_ID?: string;
  TURN_KEY_TOKEN?: string;
};
type Role = 'HOST' | 'GUEST';
type Member = { id: string; role: Role; approved: boolean; ip: string; window: number; count: number };
const IDENT = /^[\w-]{1,100}$/;
const json = (data: unknown) => JSON.stringify(data);
const send = (socket: WebSocket, data: unknown) => { try { socket.send(json(data)); } catch { /* disconnected */ } };
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
const deny = () => new Response('Nicht verfügbar.', { status: 404 });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/status') return new Response(json({ turn: !!env.TURN_KEY_ID && !!env.TURN_KEY_TOKEN }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    const code = url.pathname.match(/^\/api\/lobby\/([A-HJ-NP-Z2-9]{10})$/)?.[1];
    if (!code || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' || request.headers.get('Origin') !== url.origin) return url.pathname.startsWith('/api/') ? deny() : env.ASSETS.fetch(request);
    const role = url.searchParams.get('role');
    if (role !== 'HOST' && role !== 'GUEST') return deny();
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipKey = await hash(`${env.TURN_KEY_TOKEN || 'local-dev'}|${ip}`);
    const allowed = await env.RATE.get(env.RATE.idFromName(ipKey)).fetch('https://rate/attempt', { method: 'POST', body: role });
    if (!allowed.ok) return new Response('Zu viele Verbindungsversuche. Später erneut probieren.', { status: 429 });
    const room = env.ROOMS.get(env.ROOMS.idFromName(code));
    return room.fetch(new Request(`https://room.internal/join?role=${role}&ticket=${encodeURIComponent(url.searchParams.get('ticket') || '')}&ip=${ipKey}`, request));
  }
};

/** No IP addresses are stored; counters have rolling windows. */
export class RateGate extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const role = await request.text();
    const now = Date.now();
    const key = role === 'HOST' ? 'host' : role === 'TURN' ? 'turn' : 'guest';
    const max = key === 'host' ? 10 : key === 'turn' ? 90 : 40;
    const value = await this.ctx.storage.get<{ start: number; count: number }>(key);
    const current = !value || now - value.start > 3_600_000 ? { start: now, count: 0 } : value;
    if (current.count >= max) return new Response(null, { status: 429 });
    await this.ctx.storage.put(key, { ...current, count: current.count + 1 });
    if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(now + 2 * 3_600_000);
    return new Response(null, { status: 204 });
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}

/** One live room. Text only: SDP/ICE, approval and game controls; no photo bytes. */
export class Lobby extends DurableObject<Env> {
  private sockets = new Map<string, WebSocket>();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    for (const ws of ctx.getWebSockets()) {
      const member = ws.deserializeAttachment() as Member | null;
      if (member?.id) this.sockets.set(member.id, ws);
    }
  }
  private member(ws: WebSocket): Member { return ws.deserializeAttachment() as Member; }
  private host(): WebSocket | undefined { return [...this.sockets.values()].find(ws => this.member(ws).role === 'HOST'); }
  private guests(): WebSocket[] { return [...this.sockets.values()].filter(ws => this.member(ws).role === 'GUEST'); }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url), role = url.searchParams.get('role'), ticket = url.searchParams.get('ticket') || '';
    if ((role !== 'HOST' && role !== 'GUEST') || this.sockets.size >= 14) return deny();
    let hostToken = '';
    if (role === 'HOST') {
      if (this.host()) return new Response('Lobby bereits geöffnet.', { status: 409 });
      const saved = await this.ctx.storage.get<{ hash: string; created: number }>('host');
      if (saved && Date.now() - saved.created < 8 * 3_600_000 && (!ticket || await hash(ticket) !== saved.hash)) return new Response('Lobby bereits vergeben.', { status: 409 });
      if (saved && ticket && await hash(ticket) === saved.hash) hostToken = ticket;
      else { hostToken = `${crypto.randomUUID()}${crypto.randomUUID()}`; await this.ctx.storage.put('host', { hash: await hash(hostToken), created: Date.now() }); await this.ctx.storage.setAlarm(Date.now() + 8 * 3_600_000); }
    } else if (!this.host()) return deny();
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const member: Member = { id: crypto.randomUUID(), role, approved: role === 'HOST', ip: url.searchParams.get('ip') || '', window: Date.now(), count: 0 };
    server.serializeAttachment(member); this.sockets.set(member.id, server);
    send(server, { type: 'welcome', id: member.id, ...(role === 'HOST' ? { hostToken } : {}) });
    if (role === 'GUEST') { const host = this.host()!; send(host, { type: 'peer-joined', id: member.id }); send(server, { type: 'peer-joined', id: this.member(host).id }); }
    else for (const guest of this.guests()) { const m = this.member(guest); guest.serializeAttachment({ ...m, approved: false }); send(server, { type: 'peer-joined', id: m.id }); send(guest, { type: 'peer-joined', id: member.id }); }
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > 32_768) { ws.close(1009, 'Zu groß'); return; }
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(message) as Record<string, unknown>; } catch { return; }
    let self = this.member(ws);
    const now = Date.now();
    self = now - self.window >= 60_000 ? { ...self, window: now, count: 1 } : { ...self, count: self.count + 1 };
    if (self.count > (self.role === 'HOST' ? 400 : 160)) { ws.close(1008, 'Zu viele Nachrichten'); return; }
    ws.serializeAttachment(self);
    if (raw.type === 'turn') {
      if (!self.approved) return;
      const allowed = await this.env.RATE.get(this.env.RATE.idFromName(self.ip)).fetch('https://rate/turn', { method: 'POST', body: 'TURN' });
      if (!allowed.ok) { send(ws, { type: 'error', message: 'TURN-Limit erreicht. Später erneut versuchen.' }); send(ws, { type: 'turn', iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }); return; }
      if (!this.env.TURN_KEY_ID || !this.env.TURN_KEY_TOKEN) { send(ws, { type: 'turn', iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }); return; }
      try {
        const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(this.env.TURN_KEY_ID)}/credentials/generate-ice-servers`, { method: 'POST', headers: { Authorization: `Bearer ${this.env.TURN_KEY_TOKEN}`, 'Content-Type': 'application/json' }, body: json({ ttl: 7200 }), signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error('TURN credentials failed');
        const payload = await response.json() as { iceServers?: unknown };
        if (!Array.isArray(payload.iceServers) || !payload.iceServers.length) throw new Error('TURN response invalid');
        send(ws, { type: 'turn', iceServers: payload.iceServers });
      } catch { send(ws, { type: 'error', message: 'TURN-Zugang derzeit nicht verfügbar.' }); send(ws, { type: 'turn', iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }); }
      return;
    }
    if (raw.type !== 'route' || !IDENT.test(String(raw.to)) || !raw.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) return;
    const data = raw.data as Record<string, unknown>, kind = data.type;
    if (typeof kind !== 'string' || !['HOST', 'JOIN', 'APPROVED', 'DENIED', 'OFFER', 'ANSWER', 'ICE', 'RESTART', 'CHANNEL_READY', 'CONTROL', 'ACK'].includes(kind)) return;
    const target = this.sockets.get(String(raw.to)); if (!target) return;
    const dest = this.member(target);
    if (self.role === dest.role || (self.role === 'GUEST' && this.host() !== target)) return;
    if (!self.approved && !['JOIN'].includes(kind)) return;
    if (!dest.approved && !['HOST', 'APPROVED', 'DENIED'].includes(kind)) return;
    if (kind === 'HOST' && self.role !== 'HOST' || kind === 'JOIN' && self.role !== 'GUEST' || kind === 'APPROVED' && self.role !== 'HOST' || kind === 'DENIED' && self.role !== 'HOST') return;
    if (kind === 'APPROVED') target.serializeAttachment({ ...dest, approved: true });
    send(target, { type: 'route', from: self.id, data });
  }
  webSocketClose(ws: WebSocket) { this.remove(ws); }
  webSocketError(ws: WebSocket) { this.remove(ws); }
  private remove(ws: WebSocket) {
    const self = this.member(ws); if (!self || this.sockets.get(self.id) !== ws) return;
    this.sockets.delete(self.id);
    for (const other of this.sockets.values()) send(other, { type: 'peer-left', id: self.id });
    if (self.role === 'HOST') for (const guest of this.guests()) { const member = this.member(guest); guest.serializeAttachment({ ...member, approved: false }); }
  }
  async alarm() { await this.ctx.storage.delete('host'); }
}
