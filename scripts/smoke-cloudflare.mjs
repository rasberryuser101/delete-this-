import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const origin = 'http://127.0.0.1:8899';
const bin = fileURLToPath(new URL('../node_modules/.bin/wrangler', import.meta.url));
const preload = fileURLToPath(new URL('./local-test-network.cjs', import.meta.url));
const stateDir = await mkdtemp(join(tmpdir(), 'delete-this-worker-'));
const worker = spawn(bin, ['dev', '--local', '--ip', '127.0.0.1', '--port', '8899', '--persist-to', stateDir, '--log-level', 'error'], { env: { ...process.env, NODE_OPTIONS: `--require=${preload}`, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
for (const pipe of [worker.stdout, worker.stderr]) pipe.on('data', data => { logs += data.toString(); });
const clients = [];
async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try { const response = await fetch(`${origin}/api/status`, { signal: AbortSignal.timeout(1000) }); if (response.ok) return response; } catch { /* starting */ }
    if (worker.exitCode !== null) throw new Error(`Worker beendet: ${logs.slice(-3000)}`);
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Worker nicht erreichbar: ${logs.slice(-3000)}`);
}
async function connect(code, role,ip='127.0.0.1') {
  const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/api/lobby/${code}?role=${role}`, { headers: { Origin: origin,'CF-Connecting-IP':ip } });
  clients.push(ws);
  const inbox = [];
  ws.on('message', data => inbox.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return { ws, inbox, async next(type) { for (let i = 0; i < 50; i++) { const idx = inbox.findIndex(m => m.type === type); if (idx >= 0) return inbox.splice(idx, 1)[0]; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error(`Missing ${type}: ${JSON.stringify(inbox)}`); } };
}
async function turn(code, member, overrides={}, ip='127.0.0.1', source=origin) {
  return fetch(`${origin}/api/turn`,{method:'POST',headers:{Origin:source,'Content-Type':'application/json','CF-Connecting-IP':ip},body:JSON.stringify({code,id:member.id,token:member.accessToken,...overrides})});
}
try {
  const status = await waitForServer(); assert.deepEqual(await status.json(), { turn: false });
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from(randomBytes(10), byte => alphabet[byte % alphabet.length]).join('');
  const otherCode = `${code.slice(0, 9)}${alphabet[(alphabet.indexOf(code[9]) + 1) % alphabet.length]}`;
  const host = await connect(code, 'HOST');
  const welcome = await host.next('welcome'); assert.equal(typeof welcome.hostToken, 'string');
  const guest = await connect(code, 'GUEST'); const joined = await guest.next('welcome');
  assert.equal((await turn(code,joined)).status,403,'Vor Freigabe kein Relay-Zugang');
  assert.equal((await host.next('peer-joined')).id, joined.id);
  assert.equal((await guest.next('peer-joined')).id, welcome.id);
  guest.ws.send('null'); guest.ws.send('[]'); guest.ws.send('not-json');
  guest.ws.send(JSON.stringify({ type: 'turn' }));
  guest.ws.send(JSON.stringify({ type: 'route', to: welcome.id, data: { type: 'CONTROL', requestId: 'x', message: { type: 'ready' } } }));
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(host.inbox.some(m => m.type === 'route'), false, 'Gast vor Freigabe darf keine Spielnachrichten schicken');
  host.ws.send(JSON.stringify({ type: 'route', to: joined.id, data: { type: 'HOST', id: 'host', publicKey: 'x', signature: 'x' } }));
  assert.equal((await guest.next('route')).data.type, 'HOST');
  guest.ws.send(JSON.stringify({ type: 'route', to: welcome.id, data: { type: 'JOIN', id: 'guest', role: 'PLAYER', name: 'A', publicKey: 'x', signature: 'x' } }));
  assert.equal((await host.next('route')).data.type, 'JOIN');
  host.ws.send(JSON.stringify({ type: 'route', to: joined.id, data: { type: 'APPROVED', id: 'guest', role: 'PLAYER' } }));
  assert.equal((await guest.next('route')).data.type, 'APPROVED');
  assert.equal((await turn(code,joined,{token:'00000000-0000-0000-0000-000000000000'})).status,403,'Code allein bzw. geratenes Ticket reicht nicht');
  assert.equal((await turn(otherCode,joined)).status,403,'Ticket ist an die Lobby gebunden');
  assert.equal((await turn(code,joined,{},'203.0.113.4')).status,403,'Ticket ist an die aktive Verbindung/IP gebunden');
  assert.equal((await turn(code,joined,{},'127.0.0.1','https://foreign.example')).status,404,'Fremde Webseiten erhalten keinen Zugang');
  const credentials=await turn(code,joined);assert.equal(credentials.status,200);assert.equal(credentials.headers.get('Cache-Control'),'no-store');
  assert.match(JSON.stringify((await credentials.json()).iceServers),/stun\.cloudflare\.com/);
  assert.equal((await turn(code,joined)).status,429,'Eine Verbindung kann keine Zugangsdaten im Kreis abrufen');
  guest.ws.send(JSON.stringify({type:'turn'}));
  for(const data of [{type:'CONTROL',requestId:'x',message:{type:'ready'}},{type:'ACK',requestId:'x',ok:true}])guest.ws.send(JSON.stringify({type:'route',to:welcome.id,data}));
  await new Promise(resolve=>setTimeout(resolve,120));assert.equal(host.inbox.some(m=>m.type==='route'),false,'Spielaktionen werden auch nach Freigabe nicht über die Lobby weitergeleitet');
  assert.equal(guest.inbox.some(m=>m.type==='turn'),false,'Keine Credential-Abfrage im Durable Object');
  guest.ws.send(JSON.stringify({ type: 'route', to: welcome.id, data: { type: 'CHANNEL_READY' } }));
  assert.equal((await host.next('route')).data.type, 'CHANNEL_READY');
  guest.ws.send(JSON.stringify({ type: 'route', to: welcome.id, data: { type: 'ICE', candidate: { candidate: 'candidate:1' } } }));
  assert.equal((await host.next('route')).data.type, 'ICE');
  const other = await connect(otherCode, 'HOST'); await other.next('welcome');
  other.ws.send(JSON.stringify({ type: 'route', to: joined.id, data: { type: 'CONTROL', requestId: 'x', message: { type: 'ready' } } }));
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(guest.inbox.some(m => m.type === 'route'), false, 'Lobbys bleiben voneinander getrennt');
  host.ws.send(JSON.stringify({ type: 'route', to: joined.id, data: { type: 'DENIED' } }));
  assert.equal((await guest.next('route')).data.type, 'DENIED');
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(guest.ws.readyState, WebSocket.CLOSED, 'Entfernte Gäste verlieren die Serververbindung');
  assert.equal((await turn(code,joined)).status,403,'Entfernte Gäste verlieren auch den Credential-Zugang');
  const retry = await connect(code, 'GUEST'); const retryWelcome = await retry.next('welcome');
  host.ws.send(JSON.stringify({ type: 'route', to: retryWelcome.id, data: { type: 'APPROVED', id: 'guest', role: 'PLAYER' } }));
  assert.equal((await retry.next('route')).data.type, 'APPROVED', 'Neue Anfrage bleibt nach Ablehnung möglich');
  for(let i=0;i<161;i++)retry.ws.send('null');
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(retry.ws.readyState, WebSocket.CLOSED, 'Auch ungültige Nachrichten zählen zum Spam-Limit');
  const crowd=[];
  // Separate fixture IP: this capacity test must not consume the IP budget of
  // the independent rate-limit test below. Real Cloudflare sets this header.
  for(let i=0;i<20;i++){const player=await connect(code,'GUEST','198.51.100.42');await player.next('welcome');crowd.push(player);}
  assert.equal(crowd.length,20,'Der gemeinsame Bildschirm kann 20 Gäste erreichen');
  for(const player of crowd)player.ws.close();
  await new Promise(resolve=>setTimeout(resolve,120));
  const unusedCode = Array.from(randomBytes(10), byte => alphabet[byte % alphabet.length]).join('');
  const missing = await connect(unusedCode, 'GUEST');
  assert.match((await missing.next('error')).message, /Lobby nicht gefunden/);
  // Two host attempts above plus eight = the configured hourly limit.
  for (let i = 0; i < 8; i++) {
    const extra = await connect(Array.from(randomBytes(10), byte => alphabet[byte % alphabet.length]).join(''), 'HOST');
    await extra.next('welcome'); extra.ws.close();
  }
  const denied = await connect(unusedCode, 'HOST');
  assert.match((await denied.next('error')).message, /Schutzpause.*60 Minuten/);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(denied.ws.readyState, WebSocket.CLOSED, 'Abgelehnter Socket wird sofort geschlossen');
  assert.equal(denied.inbox.some(m => m.type === 'welcome'), false, 'Rate-Limit darf keinen Lobbyzugang erteilen');
  const stillMissing = await connect(unusedCode, 'GUEST');
  assert.match((await stillMissing.next('error')).message, /Lobby nicht gefunden/, 'Abgelehnter Host hat keine Lobby erstellt');
  console.log('Cloudflare Worker: 20 Gäste, erneuter Beitritt, Freigabeentzug, Spam-Limits, HTTP-TURN mit Lobby-/Token-/IP-/Origin-Prüfung, keine Spielaktionen im Signalling und Isolation geprüft.');
} finally {
  for (const ws of clients) ws.close();
  worker.kill('SIGTERM');
  await new Promise(resolve => worker.exitCode !== null ? resolve() : worker.once('exit', resolve));
  await rm(stateDir, { recursive: true, force: true });
}
