import { describe, expect, it, vi } from 'vitest';
import { checkTurnEgress, DEFAULT_STOP_GB, FAILURE_ALERT_AFTER, GB, monthDates, monthKey, nextState, parseEgress, publicStatus, stopBytes, turnQuery, verdict, type GuardState } from '../worker/costGuard';

const OCT = Date.UTC(2026, 9, 15, 12), NOV = Date.UTC(2026, 10, 1, 0, 17);
const env = { CF_ANALYTICS_TOKEN: 'secret-token', CF_ACCOUNT_ID: '1d9ff15d990a099917629e78579650c6' };
const graph = (bytes: unknown[]) => ({ data: { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: bytes.map(egressBytes => ({ sum: { egressBytes } })) }] } }, errors: null });

describe('Kostenbremse', () => {
  it('nutzt 950 GB als Standard und kappt Fehlkonfigurationen bei der 1.000-GB-Freimenge', () => {
    expect(stopBytes({})).toBe(DEFAULT_STOP_GB * GB);
    expect(stopBytes({ TURN_MONTHLY_STOP_GB: '100' })).toBe(100 * GB);
    expect(stopBytes({ TURN_MONTHLY_STOP_GB: '5000' })).toBe(1000 * GB);
    for (const bad of ['', '0', '-3', 'abc']) expect(stopBytes({ TURN_MONTHLY_STOP_GB: bad })).toBe(950 * GB);
  });
  it('pausiert ab Erreichen der Schwelle und bleibt im selben Monat pausiert', () => {
    const below = nextState(undefined, OCT, { ok: true, egressBytes: 949 * GB }, env);
    expect(verdict(below, OCT, env)).toEqual({ paused: false, reason: null });
    const hit = nextState(below, OCT + 3_600_000, { ok: true, egressBytes: 950 * GB }, env);
    expect(verdict(hit, OCT + 3_600_000, env)).toEqual({ paused: true, reason: 'monthly-limit' });
    // A later, lower (lagging/corrected) number does not silently unpause.
    const later = nextState(hit, OCT + 7_200_000, { ok: true, egressBytes: 10 }, env);
    expect(later.paused).toBe(true);
    // Neither does an analytics failure.
    expect(nextState(hit, OCT + 7_200_000, { ok: false, reason: 'error' }, env).paused).toBe(true);
  });
  it('setzt sich mit dem neuen Kalendermonat (UTC) automatisch zurück', () => {
    const hit = nextState(undefined, OCT, { ok: true, egressBytes: 2000 * GB }, env);
    expect(verdict(hit, NOV, env).paused).toBe(false); // even before the next cron run
    expect(nextState(hit, NOV, { ok: true, egressBytes: 1 * GB }, env)).toMatchObject({ month: '2026-11', paused: false });
    expect(nextState(hit, NOV, { ok: false, reason: 'error' }, env)).toMatchObject({ month: '2026-11', paused: false, failures: 1 });
    expect(monthKey(Date.UTC(2026, 9, 31, 23, 59))).toBe('2026-10');
  });
  it('manueller KILL_SWITCH schaltet sofort alles ab, nur bei exakt "1"', () => {
    expect(verdict(undefined, OCT, { KILL_SWITCH: '1' })).toEqual({ paused: true, reason: 'manual' });
    expect(verdict(undefined, OCT, { KILL_SWITCH: ' 1 ' }).reason).toBe('manual');
    for (const off of [undefined, '', '0', 'true']) expect(verdict(undefined, OCT, { KILL_SWITCH: off }).paused).toBe(false);
    expect(publicStatus(undefined, OCT, { KILL_SWITCH: '1' })).toEqual({ paused: true, reason: 'manual', monitor: 'no-token' });
  });
  it('ohne Token: kein Absturz, kein Netzwerkaufruf, Spiel läuft, Zustand sichtbar', async () => {
    const fetcher = vi.fn();
    const result = await checkTurnEgress({ CF_ACCOUNT_ID: env.CF_ACCOUNT_ID }, OCT, fetcher as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, reason: 'no-token' });
    expect(fetcher).not.toHaveBeenCalled();
    const state = nextState(undefined, OCT, result, {});
    expect(state).toMatchObject({ paused: false, monitor: 'no-token', failures: 0 });
    expect(publicStatus(state, OCT, {})).toEqual({ paused: false, reason: null, monitor: 'no-token' });
  });
  it('wiederholte Abfragefehler pausieren nicht, sondern melden nach sechs Stunden "failing"', () => {
    let state: GuardState | undefined = nextState(undefined, OCT, { ok: true, egressBytes: 1 }, env);
    for (let i = 1; i < FAILURE_ALERT_AFTER; i++) { state = nextState(state, OCT + i * 3_600_000, { ok: false, reason: 'error' }, env); expect(state.monitor).toBe('ok'); }
    state = nextState(state, OCT + 6 * 3_600_000, { ok: false, reason: 'error' }, env);
    expect(state).toMatchObject({ paused: false, monitor: 'failing', failures: 6 });
    expect(nextState(state, OCT + 7 * 3_600_000, { ok: true, egressBytes: 2 }, env)).toMatchObject({ monitor: 'ok', failures: 0 });
  });
  it('fragt kontoweit TURN-Egress des laufenden UTC-Monats ab und gibt kein Token preis', async () => {
    expect(monthDates(Date.UTC(2026, 0, 1, 0, 30))).toEqual({ dateFrom: '2026-01-01', dateTo: '2026-01-01' });
    const query = turnQuery(env.CF_ACCOUNT_ID, OCT);
    expect(query).toContain('callsTurnUsageAdaptiveGroups'); expect(query).toContain('egressBytes');
    expect(query).toContain('date_geq: "2026-10-01"'); expect(query).toContain('date_leq: "2026-10-15"');
    expect(() => turnQuery('x"}) { evil', OCT)).toThrow();
    const fetcher = vi.fn(async () => new Response(JSON.stringify(graph([400 * GB, '551000000000']))));
    expect(await checkTurnEgress(env, OCT, fetcher as unknown as typeof fetch)).toEqual({ ok: true, egressBytes: 951 * GB });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.cloudflare.com/client/v4/graphql');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
    expect(String(init.body)).not.toContain('secret-token');
  });
  it('behandelt HTTP-, GraphQL- und Formatfehler als Fehlschlag statt als 0 GB', async () => {
    expect(parseEgress(graph([]))).toBe(0);
    for (const bad of [null, {}, { errors: [{ message: 'not authorized' }], data: null }, { data: { viewer: { accounts: [] } } }, graph(['x']), graph([-1])]) expect(parseEgress(bad)).toBeNull();
    for (const response of [new Response('nope', { status: 403 }), new Response('not json'), new Response(JSON.stringify({ errors: [{ message: 'x' }] }))])
      expect(await checkTurnEgress(env, OCT, (async () => response) as unknown as typeof fetch)).toEqual({ ok: false, reason: 'error' });
    expect(await checkTurnEgress(env, OCT, (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toEqual({ ok: false, reason: 'error' });
  });
  it('öffentlicher Status enthält keine Verbrauchszahlen', () => {
    const state = nextState(undefined, OCT, { ok: true, egressBytes: 123_456_789 }, env);
    const status = publicStatus(state, OCT, env);
    expect(status).toEqual({ paused: false, reason: null, monitor: 'ok' });
    expect(JSON.stringify(status)).not.toContain('123');
    expect(publicStatus(state, NOV, env).monitor).toBe('pending');
  });
});
