import { afterEach, expect, it, vi } from 'vitest';
import { CloudflareLobby, diagnoseSocketFailure, HOST_CONNECTION_ERROR } from '../src/room';
import { makeIdentity } from '../src/identity';

afterEach(() => vi.unstubAllGlobals());

it('erkennt statische Altadressen ohne Lobby-Backend', async () => {
  vi.stubGlobal('location', { origin: 'https://old.example' });
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('<html>App</html>', { headers: { 'Content-Type': 'text/html' } }));
  vi.stubGlobal('fetch', fetch);
  expect(await diagnoseSocketFailure('HOST')).toContain('kein Lobby-Dienst');
  expect(String(fetch.mock.calls[0]?.[0])).toBe('https://old.example/api/status');
});

it('meldet beim Host niemals irreführend eine nicht gefundene Lobby', async () => {
  vi.stubGlobal('location', { origin: 'https://game.example' });
  vi.stubGlobal('fetch', async () => new Response('{"turn":true}', { headers: { 'Content-Type': 'application/json' } }));
  expect(await diagnoseSocketFailure('HOST')).toBe(HOST_CONNECTION_ERROR);
  vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
  expect(await diagnoseSocketFailure('HOST')).toBe(HOST_CONNECTION_ERROR);
});

it('erhält die Schutzpause trotz sofortigem Schließen des WebSockets', async () => {
  vi.stubGlobal('location', { origin: 'https://game.example' });
  const message = 'Die Schutzpause für neue Lobbys ist aktiv. Bitte in etwa 12 Minuten erneut versuchen.';
  class DeniedSocket {
    readyState = 1;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    constructor() {
      queueMicrotask(() => {
        this.onmessage?.({ data: JSON.stringify({ type: 'error', message }) });
        this.readyState = 3; this.onclose?.();
      });
    }
  }
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('WebSocket', DeniedSocket);
  const lobby = new CloudflareLobby({ code: 'ABCDEFGH23', role: 'HOST' }, await makeIdentity('host'));
  await expect(lobby.start()).rejects.toThrow(message);
  expect(fetch).not.toHaveBeenCalled();
});
