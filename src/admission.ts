export const APPROVAL_MS = 60_000;
export const MAX_PENDING_REQUESTS = 24;
export const MAX_JOIN_ATTEMPTS = 30;
export type JoinRequest = {id: string; name: string; check: string; role?: 'PLAYER'|'DISPLAY'};
export const peerCheck = (id: string) => id.slice(-8).toUpperCase();

/** The check must be compared with the friend's screen; a name is not an identity. */
export class AdmissionGate {
  private pending = new Map<string, {request: JoinRequest; resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>}>();
  private attempts: number[] = [];
  constructor(private changed: (requests: JoinRequest[]) => void) {}
  request(id: string, name: string, role: 'PLAYER'|'DISPLAY' = 'PLAYER', check = peerCheck(id)): Promise<void> {
    const now = Date.now();
    this.attempts = this.attempts.filter(t => now - t < 60_000);
    if (this.pending.has(id) || this.pending.size >= MAX_PENDING_REQUESTS || this.attempts.length >= MAX_JOIN_ATTEMPTS) return Promise.reject(new Error('Zu viele Anfragen. Bitte in einer Minute erneut versuchen.'));
    this.attempts.push(now);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.decide(id, false, 'Die Freigabe ist abgelaufen. Bitte erneut anfragen.'), APPROVAL_MS);
      this.pending.set(id, {request: {id, name, check, role}, resolve, reject, timer});
      this.emit();
    });
  }
  decide(id: string, accepted: boolean, reason = 'Der Host hat die Anfrage abgelehnt.'): void {
    const item = this.pending.get(id); if (!item) return;
    clearTimeout(item.timer); this.pending.delete(id);
    if (accepted) item.resolve();
    else item.reject(new Error(reason)); // Reject this attempt, not the device forever.
    this.emit();
  }
  clear(): void {
    for (const id of this.pending.keys()) this.decide(id, false, 'Lobby geschlossen.');
    this.attempts = [];
  }
  private emit() { this.changed([...this.pending.values()].map(item => item.request)); }
}
