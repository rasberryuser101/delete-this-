import { DurableObject } from 'cloudflare:workers';
import { consume, rateRule, TURN_TTL, TURN_COOLDOWN_MS, type Counter } from './limits';

type Env = {
  ROOMS: DurableObjectNamespace<Lobby>;
  RATE: DurableObjectNamespace<RateGate>;
  ASSETS: Fetcher;
  /** Optional: older Cloudflare projects may not have created this binding yet. */
  ENTRY_LIMIT?: RateLimit;
  TURN_KEY_ID?: string;
  TURN_KEY_TOKEN?: string;
};
type Role = 'HOST' | 'GUEST';
type Member = { id: string; role: Role; approved: boolean; ip: string; window: number; count: number; lastTurn?: number };
const IDENT = /^[\w-]{1,100}$/;
const json = (data: unknown) => JSON.stringify(data);
const send = (socket: WebSocket, data: unknown) => { try { socket.send(json(data)); } catch { /* disconnected */ } };
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
const deny = () => new Response('Nicht verfügbar.', { status: 404 });
// A failed HTTP upgrade is opaque in browser WebSocket APIs. Send an error
// frame and immediately close; never register a denied socket in a lobby.
function rejectSocket(message: string): Response {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  send(server, { type: 'error', message });
  server.close(1008, 'Verbindung abgelehnt');
  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/status') return new Response(json({ turn: !!env.TURN_KEY_ID && !!env.TURN_KEY_TOKEN }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    const code = url.pathname.match(/^\/api\/lobby\/([A-HJ-NP-Z2-9]{10})$/)?.[1];
    if (!code || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' || request.headers.get('Origin') !== url.origin) return url.pathname.startsWith('/api/') ? deny() : env.ASSETS.fetch(request);
    const role = url.searchParams.get('role');
    if (role !== 'HOST' && role !== 'GUEST') return deny();
    if ((url.searchParams.get('ticket') || '').length > 80) return deny();
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    // The Durable Object limiter below is the authoritative fallback. This
    // binding is an extra edge limiter and must never make lobby creation fail
    // just because a project was deployed before the binding existed.
    if (env.ENTRY_LIMIT) {
      try {
        if (!(await env.ENTRY_LIMIT.limit({ key: ip })).success) return rejectSocket('Zu viele Versuche in kurzer Zeit. Bitte eine Minute warten und dann erneut versuchen.');
      } catch {
        // Continue with the persistent RateGate limiter below.
      }
    }
    const ipKey = await hash(`${env.TURN_KEY_TOKEN || 'local-dev'}|${ip}`);
    try {
      const allowed = await env.RATE.get(env.RATE.idFromName(ipKey)).fetch('https://rate/attempt', { method: 'POST', body: role });
      if (allowed.status === 429) {
        const minutes = Math.max(1, Math.ceil(Number(allowed.headers.get('Retry-After') || 3600) / 60));
        return rejectSocket(`Die Schutzpause für ${role === 'HOST' ? 'neue Lobbys' : 'Beitrittsversuche'} ist aktiv. Bitte in etwa ${minutes} Minute${minutes === 1 ? '' : 'n'} erneut versuchen. Geräte im selben Netzwerk teilen dieses Limit.`);
      }
      if (!allowed.ok) return rejectSocket('Der Lobby-Dienst ist vorübergehend nicht verfügbar. Bitte später erneut versuchen.');
      const room = env.ROOMS.get(env.ROOMS.idFromName(code));
      return await room.fetch(new Request(`https://room.internal/join?role=${role}&ticket=${encodeURIComponent(url.searchParams.get('ticket') || '')}&ip=${ipKey}`, request));
    } catch {
      return rejectSocket('Der Lobby-Dienst konnte nicht gestartet werden. Bitte später erneut versuchen oder den Betreiber informieren.');
    }
  }
};

/** Salted IP hashes only; fixed windows, no photo or game storage. */
export class RateGate extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const role = await request.text();
    const now = Date.now();
    const rule = rateRule(role);
    const value = await this.ctx.storage.get<Counter>(rule.key);
    const next = consume(value, now, rule);
    if (!next) return new Response(null, { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil(((value?.start ?? now) + rule.window - now) / 1000))) } });
    await this.ctx.storage.put(rule.key, next);
    if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(now + rule.window * 2);
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
    if (role !== 'HOST' && role !== 'GUEST') return deny();
    if (this.sockets.size >= 24) return rejectSocket('Diese Lobby ist voll. Bitte den Host kontaktieren.');
    let hostToken = '';
    if (role === 'HOST') {
      if (this.host()) return rejectSocket('Die Lobby ist bereits geöffnet. Bitte zur bestehenden Lobby zurückkehren.');
      const saved = await this.ctx.storage.get<{ hash: string; created: number }>('host');
      if (saved && Date.now() - saved.created < 8 * 3_600_000 && (!ticket || await hash(ticket) !== saved.hash)) return rejectSocket('Dieser Lobbycode ist bereits vergeben. Bitte eine neue Lobby erstellen.');
      if (saved && ticket && await hash(ticket) === saved.hash) hostToken = ticket;
      else { hostToken = `${crypto.randomUUID()}${crypto.randomUUID()}`; await this.ctx.storage.put('host', { hash: await hash(hostToken), created: Date.now() }); await this.ctx.storage.setAlarm(Date.now() + 8 * 3_600_000); }
    } else if (!this.host()) return rejectSocket('Lobby nicht gefunden. Bitte den Link prüfen und den Host bitten, die Lobby geöffnet zu lassen.');
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
    let self = this.member(ws);
    const now = Date.now();
    self = now - self.window >= 60_000 ? { ...self, window: now, count: 1 } : { ...self, count: self.count + 1 };
    if (self.count > (self.role === 'HOST' ? 1200 : 160)) { ws.close(1008, 'Zu viele Nachrichten'); return; }
    ws.serializeAttachment(self);
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(message); } catch { return; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    if (raw.type === 'turn') {
      if (!self.approved || this.sockets.get(self.id) !== ws) return;
      // Reserve before any await: concurrent requests cannot mint extra credentials.
      if (self.lastTurn && now - self.lastTurn < TURN_COOLDOWN_MS) return;
      ws.serializeAttachment({ ...self, lastTurn: now });
      const allowed = await this.env.RATE.get(this.env.RATE.idFromName(self.ip)).fetch('https://rate/turn', { method: 'POST', body: 'TURN' });
      if (!allowed.ok) { send(ws, { type: 'error', message: 'Zu viele Verbindungsversuche. Bitte später erneut versuchen.' }); send(ws, { type: 'turn', iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }); return; }
      if (!this.env.TURN_KEY_ID || !this.env.TURN_KEY_TOKEN) { send(ws, { type: 'turn', iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }); return; }
      const budget = await this.env.RATE.get(this.env.RATE.idFromName('global-turn-budget')).fetch('https://rate/budget', { method: 'POST', body: 'GLOBAL_TURN' });
      if (!budget.ok) { send(ws, { type: 'error', message: 'Verbindungskontingent heute ausgeschöpft. Bitte später versuchen.' }); send(ws, { type: 'turn', iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }); return; }
      try {
        const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(this.env.TURN_KEY_ID)}/credentials/generate-ice-servers`, { method: 'POST', headers: { Authorization: `Bearer ${this.env.TURN_KEY_TOKEN}`, 'Content-Type': 'application/json' }, body: json({ ttl: TURN_TTL }), signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error('TURN credentials failed');
        const payload = await response.json() as { iceServers?: unknown };
        if (!Array.isArray(payload.iceServers) || !payload.iceServers.length) throw new Error('TURN response invalid');
        if (this.sockets.get(self.id) === ws && this.member(ws).approved) send(ws, { type: 'turn', iceServers: payload.iceServers });
      } catch { send(ws, { type: 'error', message: 'Fotoverbindung derzeit nicht verfügbar.' }); send(ws, { type: 'turn', iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }); }
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
    if (kind === 'DENIED') target.serializeAttachment({ ...dest, approved: false });
    send(target, { type: 'route', from: self.id, data });
    if (kind === 'DENIED') { this.remove(target); target.close(1000, 'Anfrage abgelehnt'); }
  }
  webSocketClose(ws: WebSocket) { this.remove(ws); }
  webSocketError(ws: WebSocket) { this.remove(ws); }
  private remove(ws: WebSocket) {
    const self = this.member(ws); if (!self || this.sockets.get(self.id) !== ws) return;
    this.sockets.delete(self.id);
    for (const other of this.sockets.values()) send(other, { type: 'peer-left', id: self.id });
    if (self.role === 'HOST') for (const guest of this.guests()) { const member = this.member(guest); guest.serializeAttachment({ ...member, approved: false }); }
  }
  async alarm() { for (const ws of this.sockets.values()) ws.close(1000, 'Lobby abgelaufen'); this.sockets.clear(); await this.ctx.storage.deleteAll(); }
}
