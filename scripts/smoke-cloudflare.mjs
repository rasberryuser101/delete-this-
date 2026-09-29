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
async function connect(code, role) {
  const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/api/lobby/${code}?role=${role}`, { headers: { Origin: origin } });
  clients.push(ws);
  const inbox = [];
  ws.on('message', data => inbox.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return { ws, inbox, async next(type) { for (let i = 0; i < 50; i++) { const idx = inbox.findIndex(m => m.type === type); if (idx >= 0) return inbox.splice(idx, 1)[0]; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error(`Missing ${type}: ${JSON.stringify(inbox)}`); } };
}
try {
  const status = await waitForServer(); assert.deepEqual(await status.json(), { turn: false });
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from(randomBytes(10), byte => alphabet[byte % alphabet.length]).join('');
  const otherCode = `${code.slice(0, 9)}${alphabet[(alphabet.indexOf(code[9]) + 1) % alphabet.length]}`;
  const host = await connect(code, 'HOST');
  const welcome = await host.next('welcome'); assert.equal(typeof welcome.hostToken, 'string');
  const guest = await connect(code, 'GUEST'); const joined = await guest.next('welcome');
  assert.equal((await host.next('peer-joined')).id, joined.id);
  assert.equal((await guest.next('peer-joined')).id, welcome.id);
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
  guest.ws.send(JSON.stringify({ type: 'turn' }));
  assert.match(JSON.stringify((await guest.next('turn')).iceServers), /stun\.cloudflare\.com/);
  guest.ws.send(JSON.stringify({ type: 'route', to: welcome.id, data: { type: 'CHANNEL_READY' } }));
  assert.equal((await host.next('route')).data.type, 'CHANNEL_READY');
  guest.ws.send(JSON.stringify({ type: 'route', to: welcome.id, data: { type: 'ICE', candidate: { candidate: 'candidate:1' } } }));
  assert.equal((await host.next('route')).data.type, 'ICE');
  const other = await connect(otherCode, 'HOST'); await other.next('welcome');
  other.ws.send(JSON.stringify({ type: 'route', to: joined.id, data: { type: 'CONTROL', requestId: 'x', message: { type: 'ready' } } }));
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(guest.inbox.some(m => m.type === 'route'), false, 'Lobbys bleiben voneinander getrennt');
  console.log('Cloudflare Worker: Lobby, Freigabe, TURN-Zugang und Isolation geprüft.');
} finally {
  for (const ws of clients) ws.close();
  worker.kill('SIGTERM');
  await new Promise(resolve => worker.exitCode !== null ? resolve() : worker.once('exit', resolve));
  await rm(stateDir, { recursive: true, force: true });
}
