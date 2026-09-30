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
  /** Optional operator cutoff for credential issues, NOT a GB/cost limit. */
  TURN_DAILY_LIMIT?: string;
};
type Role = 'HOST' | 'GUEST';
type Member = { id: string; role: Role; approved: boolean; ip: string; accessToken: string; window: number; count: number; lastTurn?: number };
const IDENT = /^[\w-]{1,100}$/;
const json = (data: unknown) => JSON.stringify(data);
const send = (socket: WebSocket, data: unknown) => { try { socket.send(json(data)); } catch { /* disconnected */ } };
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
const deny = () => new Response('Nicht verfügbar.', { status: 404 });
const stun = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const reply = (data: unknown, status = 200) => new Response(json(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
/** Bound actual streamed bytes, including requests without Content-Length. */
async function smallBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json') || !request.body) return null;
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1024) { await reader.cancel(); return null; } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; } finally { reader.releaseLock(); }
}

async function turnCredentials(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== 'POST' || request.headers.get('Origin') !== url.origin) return deny();
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (env.ENTRY_LIMIT) try { if (!(await env.ENTRY_LIMIT.limit({ key: `turn:${ip}` })).success) return reply({ error: 'Zu viele Versuche.' }, 429); } catch { /* Durable limit remains authoritative. */ }
  const body = await smallBody(request);
  if (!body || Object.keys(body).some(k => !['code','id','token'].includes(k)) || typeof body.code !== 'string' || !/^[A-HJ-NP-Z2-9]{10}$/.test(body.code) || typeof body.id !== 'string' || !IDENT.test(body.id) || typeof body.token !== 'string' || !/^[\da-f-]{36}$/.test(body.token)) return deny();
  const room = env.ROOMS.get(env.ROOMS.idFromName(body.code));
  const ticket = json({ id: body.id, token: body.token });
  const allowed = await room.fetch('https://room.internal/turn-access', { method: 'POST', body: ticket });
  if (!allowed.ok) return reply({ error: 'Nicht freigegeben oder zu viele Versuche.' }, allowed.status === 429 ? 429 : 403);
  if (!env.TURN_KEY_ID || !env.TURN_KEY_TOKEN) return reply({ iceServers: stun, expiresIn: 60 });
  // HTTP and WebSocket can take different network paths on the same device.
  // Authenticate the active, approved socket ticket; keep its original IP hash
  // for the abuse budget so changing the HTTP address cannot reset that budget.
  const { rateKey } = await allowed.json() as { rateKey: string };
  const gate = env.RATE.get(env.RATE.idFromName(rateKey));
  if (!(await gate.fetch('https://rate/turn', { method: 'POST', body: 'TURN' })).ok) return reply({ error: 'Zu viele Verbindungsversuche.' }, 429);
  const dailyLimit = Number(env.TURN_DAILY_LIMIT);
  if (Number.isInteger(dailyLimit) && dailyLimit > 0) {
    const budget = await env.RATE.get(env.RATE.idFromName('global-turn-budget')).fetch('https://rate/budget', { method: 'POST', body: 'GLOBAL_TURN' });
    if (!budget.ok) return reply({ error: 'Verbindungskontingent ausgeschöpft.' }, 429);
  }
  // External I/O is performed in the Worker, so the room can hibernate while
  // Cloudflare's credential API responds. Approval is checked again afterwards.
  try {
    const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, { method: 'POST', headers: { Authorization: `Bearer ${env.TURN_KEY_TOKEN}`, 'Content-Type': 'application/json' }, body: json({ ttl: TURN_TTL }), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Credential API failed');
    const payload = await response.json() as { iceServers?: unknown };
    if (!Array.isArray(payload.iceServers) || !payload.iceServers.length || payload.iceServers.length > 4) throw new Error('Invalid credential response');
    const stillAllowed = await room.fetch('https://room.internal/turn-check', { method: 'POST', body: ticket });
    if (!stillAllowed.ok) return reply({ error: 'Nicht mehr freigegeben.' }, 403);
    return reply({ iceServers: payload.iceServers, expiresIn: TURN_TTL });
  } catch { return reply({ error: 'Fotoverbindung derzeit nicht verfügbar.' }, 503); }
}
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
    if (url.pathname === '/api/turn') {
      try { return await turnCredentials(request, env, url); } catch { return reply({ error: 'Fotoverbindung derzeit nicht verfügbar.' }, 503); }
    }
    const code = url.pathname.match(/^\/api\/lobby\/([A-HJ-NP-Z2-9]{10})$/)?.[1];
    if (!code || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' || request.headers.get('Origin') !== url.origin) return url.pathname.startsWith('/api/') ? deny() : env.ASSETS.fetch(request);
    const role = url.searchParams.get('role');
    if (role !== 'HOST' && role !== 'GUEST') return deny();
    // v2 requires separate RTC photo and game channels. Older open tabs must
    // reload instead of waiting for controls that are no longer sent over WS.
    if (url.searchParams.get('protocol') !== '2') return rejectSocket('Diese Spielversion ist veraltet. Bitte die Seite auf beiden Geräten neu laden und eine neue Lobby erstellen.');
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
    const rule = rateRule(role, Math.max(0, Number(this.env.TURN_DAILY_LIMIT) || 0));
    const retry = await this.ctx.storage.transaction(async tx => {
      const value = await tx.get<Counter>(rule.key), next = consume(value, now, rule);
      if (!next) return Math.max(1, Math.ceil(((value?.start ?? now) + rule.window - now) / 1000));
      await tx.put(rule.key, next);
      // One expiry alarm when a counter is created, no alarm read per attempt.
      if (!value) await tx.setAlarm(now + rule.window * 2);
      return 0;
    });
    if (retry) return new Response(null, { status: 429, headers: { 'Retry-After': String(retry) } });
    return new Response(null, { status: 204 });
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}

/** One live room. Only SDP/ICE and approval; no photos or game controls. */
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
  private host(): WebSocket | undefined { return [...this.sockets.values()].find(ws => ws.readyState === 1 && this.member(ws)?.role === 'HOST'); }
  private guests(): WebSocket[] { return [...this.sockets.values()].filter(ws => ws.readyState === 1 && this.member(ws)?.role === 'GUEST'); }
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/turn-access' || path === '/turn-check') {
      const body = await request.json() as { id?: string; token?: string };
      const socket = body.id && this.sockets.get(body.id), member = socket && this.member(socket);
      if (!socket || socket.readyState !== 1 || !member || !member.approved || !member.accessToken || member.accessToken !== body.token || (member.role === 'GUEST' && !this.host())) return deny();
      if (path === '/turn-check') return new Response(null, { status: 204 });
      const now = Date.now();
      if (member.lastTurn && now - member.lastTurn < TURN_COOLDOWN_MS) return new Response(null, { status: 429 });
      socket.serializeAttachment({ ...member, lastTurn: now });
      const rule = rateRule('ROOM_TURN');
      const accepted = await this.ctx.storage.transaction(async tx => {
        const next = consume(await tx.get<Counter>(rule.key), now, rule);
        if (!next) return false;
        await tx.put(rule.key, next); return true;
      });
      return accepted ? reply({ rateKey: member.ip }) : new Response(null, { status: 429 });
    }
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
    const member: Member = { id: crypto.randomUUID(), role, approved: role === 'HOST', ip: url.searchParams.get('ip') || '', accessToken: crypto.randomUUID(), window: Date.now(), count: 0 };
    server.serializeAttachment(member); this.sockets.set(member.id, server);
    send(server, { type: 'welcome', id: member.id, accessToken: member.accessToken, ...(role === 'HOST' ? { hostToken } : {}) });
    if (role === 'GUEST') { const host = this.host()!; send(host, { type: 'peer-joined', id: member.id }); send(server, { type: 'peer-joined', id: this.member(host).id }); }
    else for (const guest of this.guests()) { const m = this.member(guest); guest.serializeAttachment({ ...m, approved: false }); send(server, { type: 'peer-joined', id: m.id }); send(guest, { type: 'peer-joined', id: member.id }); }
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > 32_768) { ws.close(1009, 'Zu groß'); return; }
    let self = this.member(ws);
    if (!self || this.sockets.get(self.id) !== ws || ws.readyState !== 1) return;
    const now = Date.now();
    self = now - self.window >= 60_000 ? { ...self, window: now, count: 1 } : { ...self, count: self.count + 1 };
    if (self.count > (self.role === 'HOST' ? 1200 : 160)) { ws.close(1008, 'Zu viele Nachrichten'); return; }
    ws.serializeAttachment(self);
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(message); } catch { return; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    if (raw.type !== 'route' || !IDENT.test(String(raw.to)) || !raw.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) return;
    const data = raw.data as Record<string, unknown>, kind = data.type;
    if (typeof kind !== 'string' || !['HOST', 'JOIN', 'APPROVED', 'DENIED', 'OFFER', 'ANSWER', 'ICE', 'RESTART', 'CHANNEL_READY'].includes(kind)) return;
    const target = this.sockets.get(String(raw.to)); if (!target) return;
    const dest = this.member(target); if (!dest || target.readyState !== 1) return;
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
    if (self.role === 'HOST') for (const guest of this.guests()) { const member = this.member(guest); try { guest.serializeAttachment({ ...member, approved: false }); } catch { /* concurrently closing socket */ } }
  }
  async alarm() { for (const ws of this.sockets.values()) ws.close(1000, 'Lobby abgelaufen'); this.sockets.clear(); await this.ctx.storage.deleteAll(); }
}
