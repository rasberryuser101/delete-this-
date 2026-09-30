export const TURN_TTL = 1800;
export const TURN_RENEW_MS = 20 * 60_000;
export const TURN_COOLDOWN_MS = 60_000;
export type Counter = { start: number; count: number };
export function rateRule(role: string, dailyLimit = 0) {
  if (role === 'GLOBAL_TURN') return { key: 'global-turn', max: dailyLimit, window: 86_400_000 };
  if (role === 'ROOM_TURN') return { key: 'room-turn', max: 180, window: 3_600_000 };
  if (role === 'HOST') return { key: 'host', max: 10, window: 3_600_000 };
  if (role === 'TURN') return { key: 'turn', max: 90, window: 3_600_000 };
  return { key: 'guest', max: 40, window: 3_600_000 };
}
export function consume(value: Counter | undefined, now: number, rule: ReturnType<typeof rateRule>): Counter | null {
  const current = !value || now - value.start >= rule.window ? { start: now, count: 0 } : value;
  return current.count >= rule.max ? null : { ...current, count: current.count + 1 };
}
