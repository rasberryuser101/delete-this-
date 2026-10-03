/**
 * Kostenbremse: pure logic for the monthly TURN cost kill switch.
 * No Workers-only globals here, so vitest can import it directly.
 */
export const GB = 1_000_000_000; // Cloudflare bills decimal GB.
export const DEFAULT_STOP_GB = 950;
/** Never allow a stop above the 1,000 GB free tier, even if misconfigured. */
export const MAX_STOP_GB = 1000;
/** Consecutive failed hourly checks before the monitor reports "failing". */
export const FAILURE_ALERT_AFTER = 6;
export const PAUSE_MESSAGE = 'Das Spiel ist diesen Monat pausiert, weil das Kostenlimit erreicht ist. Ab dem 1. des nächsten Monats geht es automatisch weiter.';
export const MANUAL_MESSAGE = 'Das Spiel ist vom Betreiber vorübergehend abgeschaltet. Bitte später erneut versuchen.';
export const TURN_PAUSE_MESSAGE = 'Fotoverbindung über Relay ist diesen Monat pausiert (Kostenlimit erreicht). Direkte Verbindungen funktionieren weiterhin.';

export type GuardEnv = { KILL_SWITCH?: string; TURN_MONTHLY_STOP_GB?: string; CF_ANALYTICS_TOKEN?: string; CF_ACCOUNT_ID?: string };
export type Monitor = 'ok' | 'no-token' | 'failing' | 'pending';
/** Persisted in the RateGate Durable Object instance "cost-guard". */
export type GuardState = { month: string; paused: boolean; failures: number; monitor: Monitor; egressBytes?: number; checkedAt?: number };
export type CheckResult = { ok: true; egressBytes: number } | { ok: false; reason: 'no-token' | 'error' };
export type Verdict = { paused: boolean; reason: 'manual' | 'monthly-limit' | null };

/** Calendar month in UTC, e.g. "2026-10". */
export const monthKey = (now: number) => new Date(now).toISOString().slice(0, 7);
export const freshState = (now: number): GuardState => ({ month: monthKey(now), paused: false, failures: 0, monitor: 'pending' });

export function stopBytes(env: GuardEnv): number {
  const raw = env.TURN_MONTHLY_STOP_GB?.trim();
  const value = raw ? Number(raw) : NaN;
  const gb = Number.isFinite(value) && value > 0 ? Math.min(value, MAX_STOP_GB) : DEFAULT_STOP_GB;
  return gb * GB;
}
export const manualKill = (env: GuardEnv) => env.KILL_SWITCH?.trim() === '1';

/** What the game should do right now. A stored pause only applies to its own month. */
export function verdict(stored: GuardState | undefined, now: number, env: GuardEnv): Verdict {
  if (manualKill(env)) return { paused: true, reason: 'manual' };
  if (stored?.paused && stored.month === monthKey(now)) return { paused: true, reason: 'monthly-limit' };
  return { paused: false, reason: null };
}

/** Fold one hourly check into the stored state. Never un-pauses within the same month. */
export function nextState(prev: GuardState | undefined, now: number, result: CheckResult, env: GuardEnv): GuardState {
  const base = prev && prev.month === monthKey(now) ? prev : freshState(now);
  if (result.ok) {
    return { month: base.month, paused: base.paused || result.egressBytes >= stopBytes(env), failures: 0, monitor: 'ok', egressBytes: result.egressBytes, checkedAt: now };
  }
  if (result.reason === 'no-token') return { ...base, failures: 0, monitor: 'no-token', checkedAt: now };
  const failures = base.failures + 1;
  // Fail-open on analytics outages: keep the game running (TURN_DAILY_LIMIT
  // still caps credential issues); report "failing" after six hours in a row.
  return { ...base, failures, monitor: failures >= FAILURE_ALERT_AFTER ? 'failing' : base.monitor === 'no-token' ? 'pending' : base.monitor, checkedAt: now };
}

/** Status shown publicly: no usage numbers, no secrets. */
export function publicStatus(stored: GuardState | undefined, now: number, env: GuardEnv) {
  const v = verdict(stored, now, env);
  const sameMonth = stored && stored.month === monthKey(now);
  const monitor: Monitor = !env.CF_ANALYTICS_TOKEN ? 'no-token' : sameMonth ? stored.monitor : 'pending';
  return { paused: v.paused, reason: v.reason, monitor };
}

const ACCOUNT = /^[a-f\d]{32}$/;
/** Inclusive UTC date range from the 1st of the current month to today. */
export function monthDates(now: number) {
  const today = new Date(now).toISOString().slice(0, 10);
  return { dateFrom: `${today.slice(0, 7)}-01`, dateTo: today };
}
export function turnQuery(accountId: string, now: number): string {
  if (!ACCOUNT.test(accountId)) throw new Error('Invalid account id');
  const { dateFrom, dateTo } = monthDates(now);
  // Account-wide on purpose (no keyId filter): the free 1,000 GB are shared by
  // every TURN key and SFU app in the account.
  return `query { viewer { accounts(filter: { accountTag: "${accountId}" }) { callsTurnUsageAdaptiveGroups(limit: 100, filter: { date_geq: "${dateFrom}", date_leq: "${dateTo}" }) { sum { egressBytes } } } } }`;
}
/** Sums egress bytes; returns null for any unexpected shape or GraphQL error. */
export function parseEgress(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as { data?: { viewer?: { accounts?: { callsTurnUsageAdaptiveGroups?: { sum?: { egressBytes?: unknown } }[] }[] } }; errors?: unknown };
  if (Array.isArray(p.errors) && p.errors.length) return null;
  const accounts = p.data?.viewer?.accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1) return null;
  const groups = accounts[0]?.callsTurnUsageAdaptiveGroups;
  if (!Array.isArray(groups)) return null;
  let total = 0;
  for (const g of groups) { const v = Number(g?.sum?.egressBytes); if (!Number.isFinite(v) || v < 0) return null; total += v; }
  return total;
}

/** One GraphQL call. Never throws, never returns or logs the token. */
export async function checkTurnEgress(env: GuardEnv, now: number, fetcher: typeof fetch = fetch): Promise<CheckResult> {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) return { ok: false, reason: 'no-token' };
  try {
    const response = await fetcher('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: turnQuery(env.CF_ACCOUNT_ID.trim(), now) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { ok: false, reason: 'error' };
    const egressBytes = parseEgress(await response.json());
    return egressBytes === null ? { ok: false, reason: 'error' } : { ok: true, egressBytes };
  } catch { return { ok: false, reason: 'error' }; }
}
